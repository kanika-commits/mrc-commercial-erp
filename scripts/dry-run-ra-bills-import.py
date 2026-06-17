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
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET


DEFAULT_WORKBOOK = "import-data/Final Work Orders - MRC _ GLC _ PI (3).xlsx"
DEFAULT_OUT_DIR = "reports/ra-bills-import"
SHEET_NAME = "RA Bills"
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
    return re.sub(
        r"(^_+|_+$)",
        "",
        re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()),
    )


def normalize_name(value):
    text = str(value or "").lower().replace("&", " and ")
    text = re.sub(r"\b(pvt|private)\b", "private", text)
    text = re.sub(r"\b(ltd|limited)\b", "limited", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return re.sub(r"\s+", " ", text)


def normalize_ra_number(value):
    raw = str(value or "").strip()
    if re.fullmatch(r"\d+\.0+", raw):
        return raw.split(".")[0]
    return raw


def csv_value(value):
    return "" if value is None else str(value)


def number_value(value):
    text = str(value or "").replace(",", "").strip()
    if not text or text.upper() in {"N/A", "NA", "-"}:
        return None
    number = None
    try:
        number = float(text)
    except ValueError:
        return None
    return round(number, 2)


def excel_date(value):
    text = str(value or "").strip()
    if not text or text in {"0", "0.0"}:
        return ""
    try:
        serial = float(text)
        if 1 <= serial <= 80000:
            return (datetime(1899, 12, 30) + timedelta(days=serial)).date().isoformat()
    except ValueError:
        pass
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return text
    return ""


def normalized_date(value):
    return excel_date(value) or str(value or "").strip()


def date_part(value):
    text = str(value or "").strip()
    match = re.match(r"^(\d{4}-\d{2}-\d{2})", text)
    return match.group(1) if match else ""


def read_shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    values = []
    for si in root.findall("main:si", NS):
        values.append("".join(t.text or "" for t in si.findall(".//main:t", NS)))
    return values


def read_workbook_sheet_paths(zf):
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    rel_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall("pkgrel:Relationship", NS)
    }
    paths = {}
    for sheet in workbook.findall("main:sheets/main:sheet", NS):
        rel_id = sheet.attrib.get(f"{{{NS['rel']}}}id")
        target = rel_map.get(rel_id, "")
        if target:
            paths[sheet.attrib["name"]] = "xl/" + target.lstrip("/")
    return paths


def column_index(cell_ref):
    letters = re.sub(r"[^A-Z]", "", cell_ref.upper())
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index - 1


def cell_text(cell, shared_strings):
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(t.text or "" for t in cell.findall(".//main:t", NS)).strip()
    value = cell.find("main:v", NS)
    if value is None or value.text is None:
        return ""
    raw = value.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw)].strip()
        except (ValueError, IndexError):
            return ""
    return raw.strip()


def read_sheet_rows(workbook_path):
    with zipfile.ZipFile(workbook_path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_paths = read_workbook_sheet_paths(zf)
        sheet_path = sheet_paths.get(SHEET_NAME)
        if not sheet_path:
            raise RuntimeError(f"{SHEET_NAME} sheet not found.")
        root = ET.fromstring(zf.read(sheet_path))
        rows = []
        for row_node in root.findall("main:sheetData/main:row", NS):
            row = []
            for cell in row_node.findall("main:c", NS):
                index = column_index(cell.attrib.get("r", "A1"))
                while len(row) <= index:
                    row.append("")
                row[index] = cell_text(cell, shared_strings)
            if any(str(cell).strip() for cell in row):
                rows.append(row)
        return rows


def extract_ra_rows(workbook_path):
    rows = read_sheet_rows(workbook_path)
    if not rows:
        return []
    headers = [normalize_header(cell) for cell in rows[0]]
    extracted = []
    for row_number, row in enumerate(rows[1:], start=2):
        item = {"source_row": row_number}
        for index, header in enumerate(headers):
            item[header] = str(row[index] if index < len(row) else "").strip()
        extracted.append(item)
    return extracted


def supabase_get(table, select):
    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise RuntimeError("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")

    rows = []
    offset = 0
    page_size = 1000
    while True:
        params = urllib.parse.urlencode(
            {"select": select, "limit": str(page_size), "offset": str(offset)}
        )
        url = f"{base_url.rstrip('/')}/rest/v1/{table}?{params}"
        request = urllib.request.Request(
            url,
            headers={
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(request) as response:
            page = json.loads(response.read().decode("utf-8"))
        rows.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return rows


def write_csv(path, rows, headers):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: csv_value(row.get(header)) for header in headers})


def build_indexes(work_orders, vendors, links, existing_ra_bills):
    work_orders_by_number = defaultdict(list)
    vendors_by_name = defaultdict(list)
    links_by_pair = set()
    existing_ra_keys = set()

    for work_order in work_orders:
        work_orders_by_number[str(work_order.get("wo_number") or "").strip()].append(work_order)
    for vendor in vendors:
        vendors_by_name[normalize_name(vendor.get("vendor_name"))].append(vendor)
    for link in links:
        links_by_pair.add((link.get("work_order_id"), link.get("vendor_id")))
    for bill in existing_ra_bills:
        existing_ra_keys.add(
            (
                bill.get("work_order_id"),
                normalize_ra_number(bill.get("ra_number")).strip().lower(),
            )
        )
    return work_orders_by_number, vendors_by_name, links_by_pair, existing_ra_keys


def build_reports(source_rows, work_orders, vendors, links, existing_ra_bills):
    work_orders_by_number, vendors_by_name, links_by_pair, existing_ra_keys = build_indexes(
        work_orders, vendors, links, existing_ra_bills
    )
    excel_key_counts = Counter()
    preprocessed = []

    for source in source_rows:
        wo_number = str(source.get("wo_number") or "").strip()
        ra_number = normalize_ra_number(source.get("ra_bill_no"))
        work_order_matches = work_orders_by_number.get(wo_number, [])
        work_order_id = work_order_matches[0]["id"] if len(work_order_matches) == 1 else ""
        key = (work_order_id or wo_number, ra_number.strip().lower())
        excel_key_counts[key] += 1
        preprocessed.append((source, wo_number, ra_number, key))

    report_rows = []
    ready_rows = []
    error_rows = []

    for source, wo_number, ra_number, excel_key in preprocessed:
        contractor_name = str(source.get("contractor_name") or "").strip()
        work_order_matches = work_orders_by_number.get(wo_number, [])
        vendor_matches = vendors_by_name.get(normalize_name(contractor_name), [])
        gross_amount = number_value(source.get("value_of_work_done"))
        security_amount = number_value(source.get("security"))
        gst_rate_raw = number_value(source.get("gst_rate"))
        gst_rate = gst_rate_raw * 100 if gst_rate_raw is not None and gst_rate_raw <= 1 else gst_rate_raw
        gst_amount = number_value(source.get("gst_amount"))
        net_amount = number_value(source.get("amount_payable"))
        ra_date = excel_date(source.get("ra_bill_date"))
        date_source = "ra_date"
        if not ra_date:
            date_source = "work_order.wo_date"
            if work_order:
                ra_date = normalized_date(work_order.get("wo_date"))
        if not ra_date and work_order:
            ra_date = date_part(work_order.get("created_at"))
            date_source = "work_order.created_at" if ra_date else date_source
        status = "Approved" if str(source.get("approved_remark") or "").strip() else "Approved"
        approval_status = "Approved"
        reasons = []

        work_order = work_order_matches[0] if len(work_order_matches) == 1 else None
        vendor = vendor_matches[0] if len(vendor_matches) == 1 else None

        if not wo_number:
            reasons.append("missing_work_order_number")
        elif len(work_order_matches) == 0:
            reasons.append("missing_work_order")
        elif len(work_order_matches) > 1:
            reasons.append("ambiguous_work_order")

        if not contractor_name:
            reasons.append("missing_vendor_name")
        elif len(vendor_matches) == 0:
            reasons.append("missing_vendor")
        elif len(vendor_matches) > 1:
            reasons.append("ambiguous_vendor")

        if not ra_number:
            reasons.append("missing_ra_number")
        if not ra_date:
            reasons.append("invalid_date")
        if gross_amount is None:
            reasons.append("invalid_amount")

        if work_order and vendor and (work_order["id"], vendor["id"]) not in links_by_pair:
            reasons.append("vendor_not_linked_to_wo")

        db_duplicate = False
        if work_order and (work_order["id"], ra_number.strip().lower()) in existing_ra_keys:
            db_duplicate = True
            reasons.append("duplicate_existing_ra_number")

        excel_duplicate = excel_key_counts[excel_key] > 1
        if excel_duplicate:
            reasons.append("duplicate_excel_ra_number")

        status_value = "ready" if not reasons else "error"
        row = {
            "source_row": source.get("source_row"),
            "wo_number": wo_number,
            "contractor_name": contractor_name,
            "organization_id": work_order.get("organization_id", "") if work_order else "",
            "work_order_id": work_order.get("id", "") if work_order else "",
            "vendor_id": vendor.get("id", "") if vendor else "",
            "matched_vendor_name": vendor.get("vendor_name", "") if vendor else "",
            "ra_number": ra_number,
            "ra_date": ra_date,
            "date_source": date_source,
            "gross_amount": gross_amount,
            "security_amount": security_amount if security_amount is not None else 0,
            "gst_rate": gst_rate if gst_rate is not None else 0,
            "gst_amount": gst_amount if gst_amount is not None else 0,
            "net_amount": net_amount if net_amount is not None else 0,
            "status": status,
            "approval_status": approval_status,
            "remarks": source.get("approved_remark", ""),
            "dry_run_status": status_value,
            "reason": "; ".join(dict.fromkeys(reasons)),
        }
        report_rows.append(row)

        if status_value == "ready":
            ready_rows.append(
                {
                    "organization_id": row["organization_id"],
                    "work_order_id": row["work_order_id"],
                    "vendor_id": row["vendor_id"],
                    "ra_number": row["ra_number"],
                    "ra_date": row["ra_date"],
                    "date_source": row["date_source"],
                    "gross_amount": row["gross_amount"],
                    "security_amount": row["security_amount"],
                    "gst_rate": row["gst_rate"],
                    "gst_amount": row["gst_amount"],
                    "net_amount": row["net_amount"],
                    "status": row["status"],
                    "approval_status": row["approval_status"],
                    "remarks": row["remarks"],
                }
            )
        else:
            error_rows.append(row)

    return report_rows, ready_rows, error_rows


def count_errors(error_rows):
    counts = {
        "missing_work_orders": 0,
        "missing_vendors": 0,
        "vendor_not_linked_to_wo": 0,
        "duplicate_ra_numbers": 0,
        "invalid_amount_date_rows": 0,
    }
    for row in error_rows:
        reason = row.get("reason", "")
        if "missing_work_order" in reason:
            counts["missing_work_orders"] += 1
        if "missing_vendor" in reason:
            counts["missing_vendors"] += 1
        if "vendor_not_linked_to_wo" in reason:
            counts["vendor_not_linked_to_wo"] += 1
        if "duplicate_" in reason:
            counts["duplicate_ra_numbers"] += 1
        if "invalid_amount" in reason or "invalid_date" in reason:
            counts["invalid_amount_date_rows"] += 1
    return counts


def parse_args():
    parser = argparse.ArgumentParser(description="Dry-run RA Bills import from workbook.")
    parser.add_argument("--source", default=DEFAULT_WORKBOOK, help="Path to source workbook.")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="Output report directory.")
    return parser.parse_args()


def main():
    args = parse_args()
    load_env()
    workbook_path = Path(args.source).resolve()
    if not workbook_path.exists():
        raise FileNotFoundError(f"Workbook not found: {workbook_path}")

    source_rows = extract_ra_rows(workbook_path)
    work_orders = supabase_get("work_orders", "id,organization_id,wo_number,wo_date,created_at")
    vendors = supabase_get("vendors", "id,vendor_name")
    links = supabase_get("work_order_vendors", "work_order_id,vendor_id")
    existing_ra_bills = supabase_get("ra_bills", "id,work_order_id,ra_number")
    report_rows, ready_rows, error_rows = build_reports(
        source_rows, work_orders, vendors, links, existing_ra_bills
    )

    out_dir = Path(args.out_dir).resolve()
    report_path = out_dir / "ra_bills_dry_run_report.csv"
    ready_path = out_dir / "ra_bills_sql_ready.csv"
    errors_path = out_dir / "ra_bills_errors.csv"
    report_headers = [
        "source_row",
        "wo_number",
        "contractor_name",
        "organization_id",
        "work_order_id",
        "vendor_id",
        "matched_vendor_name",
        "ra_number",
        "ra_date",
        "date_source",
        "gross_amount",
        "security_amount",
        "gst_rate",
        "gst_amount",
        "net_amount",
        "status",
        "approval_status",
        "remarks",
        "dry_run_status",
        "reason",
    ]
    ready_headers = [
        "organization_id",
        "work_order_id",
        "vendor_id",
        "ra_number",
        "ra_date",
        "date_source",
        "gross_amount",
        "security_amount",
        "gst_rate",
        "gst_amount",
        "net_amount",
        "status",
        "approval_status",
        "remarks",
    ]
    write_csv(report_path, report_rows, report_headers)
    write_csv(ready_path, ready_rows, ready_headers)
    write_csv(errors_path, error_rows, report_headers)

    error_counts = count_errors(error_rows)
    summary = {
        "workbook": str(workbook_path),
        "total_rows": len(source_rows),
        "ready_rows": len(ready_rows),
        **error_counts,
        "report_csv": str(report_path),
        "sql_ready_csv": str(ready_path),
        "errors_csv": str(errors_path),
    }
    print(json.dumps(summary, indent=2))
    print("Dry-run only. No RA Bills inserted and no documents imported.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
