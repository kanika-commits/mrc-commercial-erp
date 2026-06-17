#!/usr/bin/env python3

import argparse
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET


DEFAULT_WORKBOOK = "Final Work Orders - MRC _ GLC _ PI (3).xlsx"
DEFAULT_OUT_DIR = "reports/work-order-vendor-links"
PRIMARY_SOURCE_SHEET = "Summary"
SUPPORTING_SOURCE_SHEETS = ["RA Bills", "Invoices", "Payments"]
VENDOR_ROLE = "Main Contractor"
NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pkgrel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def load_env():
    for name in [".env.local", ".env"]:
        path = Path(name)
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            match = re.match(r"\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$", line)
            if not match or match.group(1) in os.environ:
                continue
            os.environ[match.group(1)] = match.group(2).strip().strip("'\"")


def normalize_header(value):
    return re.sub(r"(^_+|_+$)", "", re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()))


def normalize_name(value):
    text = str(value or "").lower().replace("&", " and ")
    text = re.sub(r"\b(pvt|private)\b", "private", text)
    text = re.sub(r"\b(ltd|limited)\b", "limited", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return re.sub(r"\s+", " ", text)


def normalize_wo(value):
    return str(value or "").strip()


def csv_value(value):
    return "" if value is None else str(value)


def read_shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    values = []
    for si in root.findall("main:si", NS):
      texts = [node.text or "" for node in si.findall(".//main:t", NS)]
      values.append("".join(texts))
    return values


def read_workbook_sheet_paths(zf):
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("pkgrel:Relationship", NS)
    }
    sheet_paths = {}
    for sheet in workbook.findall("main:sheets/main:sheet", NS):
        name = sheet.attrib["name"]
        rel_id = sheet.attrib.get(f"{{{NS['rel']}}}id")
        target = rel_map.get(rel_id, "")
        if target:
            sheet_paths[name] = "xl/" + target.lstrip("/")
    return sheet_paths


def column_letters(cell_ref):
    return re.sub(r"[^A-Z]", "", cell_ref.upper())


def column_index(letters):
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index - 1


def cell_text(cell, shared_strings):
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(".//main:t", NS)).strip()
    value_node = cell.find("main:v", NS)
    if value_node is None or value_node.text is None:
        return ""
    raw = value_node.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw)].strip()
        except (ValueError, IndexError):
            return ""
    return raw.strip()


def read_sheet_rows(zf, sheet_path, shared_strings):
    root = ET.fromstring(zf.read(sheet_path))
    rows = []
    for row_node in root.findall("main:sheetData/main:row", NS):
        row = []
        for cell in row_node.findall("main:c", NS):
            index = column_index(column_letters(cell.attrib.get("r", "A1")))
            while len(row) <= index:
                row.append("")
            row[index] = cell_text(cell, shared_strings)
        if any(str(cell).strip() for cell in row):
            rows.append(row)
    return rows


def find_header_row(rows):
    wo_headers = {
        "wo_number",
        "work_order_number",
        "wo_no",
        "work_order_no",
        "wo",
        "wo_ref",
        "wo_reference",
        "wo_number_",
        "work_order",
        "work_order_ref",
        "work_order_reference",
        "work_order_number_",
    }
    contractor_headers = {
        "contractor_name",
        "contractor",
        "vendor_name",
        "vendor",
        "party_name",
        "party",
        "name_of_contractor",
        "contractor_vendor",
        "contractor_vendor_name",
        "vendor_contractor",
        "vendor_contractor_name",
        "agency",
        "agency_name",
    }
    header_rows = [[normalize_header(cell) for cell in row] for row in rows[:25]]

    for index, headers in enumerate(header_rows):
        wo_index = next((i for i, header in enumerate(headers) if header in wo_headers), -1)
        contractor_index = next(
            (i for i, header in enumerate(headers) if header in contractor_headers),
            -1,
        )
        if wo_index >= 0 and contractor_index >= 0:
            return index, wo_index, contractor_index

    for start_index, first_headers in enumerate(header_rows):
        for end_index in range(start_index + 1, min(start_index + 4, len(header_rows))):
            combined_width = max(len(first_headers), len(header_rows[end_index]))
            combined_headers = []
            for column_index_value in range(combined_width):
                column_headers = []
                for header_row in header_rows[start_index : end_index + 1]:
                    if column_index_value < len(header_row) and header_row[column_index_value]:
                        column_headers.append(header_row[column_index_value])
                combined_headers.append("_".join(column_headers))

            wo_index = next(
                (
                    i
                    for i, header in enumerate(combined_headers)
                    if header in wo_headers or header.endswith("_wo_number")
                ),
                -1,
            )
            contractor_index = next(
                (
                    i
                    for i, header in enumerate(combined_headers)
                    if header in contractor_headers
                    or header.endswith("_contractor_name")
                    or "contractor_name" in header
                ),
                -1,
            )
            if wo_index >= 0 and contractor_index >= 0:
                return end_index, wo_index, contractor_index
    return -1, -1, -1


def add_pair(pairs, sheet_name, row_number, wo_number, contractor_name, primary):
    key = (wo_number, normalize_name(contractor_name))
    if key not in pairs:
        pairs[key] = {
            "wo_number": wo_number,
            "contractor_name": contractor_name,
            "normalized_contractor_name": key[1],
            "source_sheets": set(),
            "source_rows": [],
            "primary_source_sheets": set(),
            "supporting_source_sheets": set(),
            "primary_source_rows": [],
            "supporting_source_rows": [],
        }
    pairs[key]["source_sheets"].add(sheet_name)
    pairs[key]["source_rows"].append(f"{sheet_name}:{row_number}")
    if primary:
        pairs[key]["primary_source_sheets"].add(sheet_name)
        pairs[key]["primary_source_rows"].append(str(row_number))
    else:
        pairs[key]["supporting_source_sheets"].add(sheet_name)
        pairs[key]["supporting_source_rows"].append(f"{sheet_name}:{row_number}")


def extract_sheet_pairs(zf, shared_strings, sheet_paths, sheet_name, pairs, invalid_rows, primary):
    sheet_path = sheet_paths.get(sheet_name)
    if not sheet_path:
        return {"rows": 0, "pairs": 0, "status": "missing_sheet"}

    rows = read_sheet_rows(zf, sheet_path, shared_strings)
    header_index, wo_index, contractor_index = find_header_row(rows)
    if header_index < 0:
        return {
            "rows": len(rows),
            "pairs": 0,
            "status": "missing_headers",
        }

    count = 0
    for row_number, row in enumerate(rows[header_index + 1 :], start=header_index + 2):
        wo_number = normalize_wo(row[wo_index] if wo_index < len(row) else "")
        contractor_name = str(row[contractor_index] if contractor_index < len(row) else "").strip()
        if not wo_number and not contractor_name:
            continue
        if not wo_number or not contractor_name:
            invalid_rows.append(
                {
                    "source_sheet": sheet_name,
                    "source_row": row_number,
                    "wo_number": wo_number,
                    "contractor_name": contractor_name,
                    "reason": "Missing WO Number or Contractor Name.",
                }
            )
            continue
        add_pair(pairs, sheet_name, row_number, wo_number, contractor_name, primary)
        count += 1

    return {
        "rows": len(rows),
        "pairs": count,
        "status": "ok",
    }


def extract_source_pairs(workbook_path):
    pairs = {}
    sheet_stats = {}
    invalid_rows = []

    with zipfile.ZipFile(workbook_path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_paths = read_workbook_sheet_paths(zf)
        sheet_stats[PRIMARY_SOURCE_SHEET] = extract_sheet_pairs(
            zf,
            shared_strings,
            sheet_paths,
            PRIMARY_SOURCE_SHEET,
            pairs,
            invalid_rows,
            primary=True,
        )
        for sheet_name in SUPPORTING_SOURCE_SHEETS:
            sheet_stats[sheet_name] = extract_sheet_pairs(
                zf,
                shared_strings,
                sheet_paths,
                sheet_name,
                pairs,
                invalid_rows,
                primary=False,
            )

    return list(pairs.values()), sheet_stats, invalid_rows


def supabase_get(table, select, extra_params=None):
    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise RuntimeError("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")

    all_rows = []
    offset = 0
    page_size = 1000
    while True:
        params = {"select": select, "limit": str(page_size), "offset": str(offset)}
        if extra_params:
            params.update(extra_params)
        url = f"{base_url.rstrip('/')}/rest/v1/{table}?{urllib.parse.urlencode(params)}"
        request = urllib.request.Request(
            url,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(request) as response:
            rows = json.loads(response.read().decode("utf-8"))
        all_rows.extend(rows)
        if len(rows) < page_size:
            break
        offset += page_size
    return all_rows


def build_report(pairs, work_orders, vendors, existing_links):
    work_orders_by_number = defaultdict(list)
    vendors_by_name = defaultdict(list)
    linked_work_order_ids = {row["work_order_id"] for row in existing_links if row.get("work_order_id")}

    for work_order in work_orders:
        work_orders_by_number[normalize_wo(work_order.get("wo_number"))].append(work_order)
    for vendor in vendors:
        vendors_by_name[normalize_name(vendor.get("vendor_name"))].append(vendor)

    report_rows = []
    sql_rows = []

    for pair in sorted(pairs, key=lambda item: (item["wo_number"], item["contractor_name"])):
        source_sheets = "; ".join(sorted(pair["source_sheets"]))
        source_rows = "; ".join(pair["source_rows"])
        primary_source_sheets = "; ".join(sorted(pair["primary_source_sheets"]))
        primary_source_rows = "; ".join(pair["primary_source_rows"])
        supporting_source_sheets = "; ".join(sorted(pair["supporting_source_sheets"]))
        supporting_source_rows = "; ".join(pair["supporting_source_rows"])
        work_order_matches = work_orders_by_number.get(pair["wo_number"], [])
        vendor_matches = vendors_by_name.get(pair["normalized_contractor_name"], [])
        base = {
            "source_sheets": source_sheets,
            "source_rows": source_rows,
            "primary_source_sheets": primary_source_sheets,
            "primary_source_rows": primary_source_rows,
            "supporting_source_sheets": supporting_source_sheets,
            "supporting_source_rows": supporting_source_rows,
            "wo_number": pair["wo_number"],
            "contractor_name": pair["contractor_name"],
            "organization_id": "",
            "work_order_id": "",
            "vendor_id": "",
            "matched_vendor_name": "",
            "vendor_role": VENDOR_ROLE,
            "is_primary": "true",
            "status": "",
            "reason": "",
        }

        if PRIMARY_SOURCE_SHEET not in pair["primary_source_sheets"]:
            report_rows.append(
                {
                    **base,
                    "status": "supporting_only",
                    "reason": "Pair was found only in supporting sheets, not Summary.",
                }
            )
            continue

        if len(work_order_matches) == 0:
            report_rows.append(
                {
                    **base,
                    "status": "unmatched_work_order",
                    "reason": "No work_orders row has this exact WO Number.",
                }
            )
            continue

        if len(work_order_matches) > 1:
            report_rows.append(
                {
                    **base,
                    "status": "ambiguous_work_order",
                    "reason": "Multiple work_orders rows have this exact WO Number.",
                }
            )
            continue

        work_order = work_order_matches[0]
        base["organization_id"] = work_order.get("organization_id", "")
        base["work_order_id"] = work_order.get("id", "")

        if len(vendor_matches) == 0:
            report_rows.append(
                {
                    **base,
                    "status": "unmatched_vendor",
                    "reason": "No vendors row has this exact normalized Contractor Name.",
                }
            )
            continue

        if len(vendor_matches) > 1:
            report_rows.append(
                {
                    **base,
                    "status": "ambiguous_vendor",
                    "reason": "Multiple vendors rows match this Contractor Name.",
                }
            )
            continue

        vendor = vendor_matches[0]
        row = {
            **base,
            "vendor_id": vendor.get("id", ""),
            "matched_vendor_name": vendor.get("vendor_name", ""),
        }

        if work_order.get("id") in linked_work_order_ids:
            report_rows.append(
                {
                    **row,
                    "status": "already_linked",
                    "reason": "Work Order already has a work_order_vendors row.",
                }
            )
            continue

        ready_row = {
            **row,
            "status": "ready",
            "reason": "Exact WO Number and exact normalized vendor name matched.",
        }
        report_rows.append(ready_row)
        sql_rows.append(
            {
                "organization_id": ready_row["organization_id"],
                "work_order_id": ready_row["work_order_id"],
                "vendor_id": ready_row["vendor_id"],
                "vendor_role": VENDOR_ROLE,
                "is_primary": "true",
            }
        )

    return report_rows, sql_rows


def write_csv(path, rows, headers):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: csv_value(row.get(header)) for header in headers})


def count_status(rows):
    counts = defaultdict(int)
    for row in rows:
        counts[row["status"]] += 1
    return dict(sorted(counts.items()))


def parse_args():
    parser = argparse.ArgumentParser(
        description="Dry-run Work Order to Vendor links from the commercial import workbook."
    )
    parser.add_argument("--source", default=DEFAULT_WORKBOOK, help="Path to source .xlsx workbook.")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="Directory for CSV reports.")
    return parser.parse_args()


def main():
    args = parse_args()
    load_env()

    workbook_path = Path(args.source).expanduser().resolve()
    if not workbook_path.exists():
        raise FileNotFoundError(f"Workbook not found: {workbook_path}")

    pairs, sheet_stats, invalid_rows = extract_source_pairs(workbook_path)

    work_orders = supabase_get("work_orders", "id,organization_id,wo_number")
    vendors = supabase_get("vendors", "id,vendor_name,status")
    existing_links = supabase_get("work_order_vendors", "id,work_order_id,vendor_id")

    report_rows, sql_rows = build_report(pairs, work_orders, vendors, existing_links)

    out_dir = Path(args.out_dir).resolve()
    report_path = out_dir / "work_order_vendor_link_report.csv"
    sql_ready_path = out_dir / "work_order_vendor_sql_ready.csv"
    invalid_path = out_dir / "work_order_vendor_invalid_source_rows.csv"

    report_headers = [
        "source_sheets",
        "source_rows",
        "primary_source_sheets",
        "primary_source_rows",
        "supporting_source_sheets",
        "supporting_source_rows",
        "wo_number",
        "contractor_name",
        "organization_id",
        "work_order_id",
        "vendor_id",
        "matched_vendor_name",
        "vendor_role",
        "is_primary",
        "status",
        "reason",
    ]
    sql_headers = [
        "organization_id",
        "work_order_id",
        "vendor_id",
        "vendor_role",
        "is_primary",
    ]
    invalid_headers = [
        "source_sheet",
        "source_row",
        "wo_number",
        "contractor_name",
        "reason",
    ]

    write_csv(report_path, report_rows, report_headers)
    write_csv(sql_ready_path, sql_rows, sql_headers)
    write_csv(invalid_path, invalid_rows, invalid_headers)

    summary = {
        "workbook": str(workbook_path),
        "sheet_stats": sheet_stats,
        "total_summary_wo_rows": sheet_stats.get(PRIMARY_SOURCE_SHEET, {}).get("pairs", 0),
        "unique_summary_wo_contractor_pairs": len(
            [
                pair
                for pair in pairs
                if PRIMARY_SOURCE_SHEET in pair["primary_source_sheets"]
            ]
        ),
        "unique_wo_contractor_pairs": len(pairs),
        "work_orders_loaded": len(work_orders),
        "vendors_loaded": len(vendors),
        "existing_work_order_vendor_links": len(existing_links),
        "status_counts": count_status(report_rows),
        "sql_ready_rows": len(sql_rows),
        "report_csv": str(report_path),
        "sql_ready_csv": str(sql_ready_path),
        "invalid_source_rows_csv": str(invalid_path),
    }

    print(json.dumps(summary, indent=2))
    print("Dry-run only. No rows inserted into work_order_vendors.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
