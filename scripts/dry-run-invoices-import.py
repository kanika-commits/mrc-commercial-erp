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
DEFAULT_OUT_DIR = "reports/invoices-import"
SHEET_NAME = "Invoices"
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


def normalize_doc_number(value):
    raw = str(value or "").strip()
    if re.fullmatch(r"\d+\.0+", raw):
        return raw.split(".")[0]
    return raw


def number_value(value):
    text = str(value or "").replace(",", "").strip()
    if not text or text.upper() in {"N/A", "NA", "-"}:
        return None
    try:
        return round(float(text), 2)
    except ValueError:
        return None


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


def csv_value(value):
    return "" if value is None else str(value)


def read_shared_strings(zf):
    if "xl/sharedStrings.xml" not in zf.namelist():
        return []
    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
    return [
        "".join(t.text or "" for t in si.findall(".//main:t", NS))
        for si in root.findall("main:si", NS)
    ]


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


def extract_invoice_rows(workbook_path):
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


def build_indexes(work_orders, vendors, links, ra_bills, invoices):
    work_orders_by_number = defaultdict(list)
    vendors_by_name = defaultdict(list)
    links_by_pair = set()
    ra_by_work_order_and_number = defaultdict(list)
    existing_invoice_keys = set()

    for work_order in work_orders:
        work_orders_by_number[str(work_order.get("wo_number") or "").strip()].append(work_order)
    for vendor in vendors:
        vendors_by_name[normalize_name(vendor.get("vendor_name"))].append(vendor)
    for link in links:
        links_by_pair.add((link.get("work_order_id"), link.get("vendor_id")))
    for bill in ra_bills:
        key = (
            bill.get("work_order_id"),
            normalize_doc_number(bill.get("ra_number")).strip().lower(),
        )
        ra_by_work_order_and_number[key].append(bill)
    for invoice in invoices:
        existing_invoice_keys.add(
            (
                invoice.get("organization_id"),
                invoice.get("vendor_id"),
                normalize_doc_number(invoice.get("invoice_number")).strip().lower(),
            )
        )

    return (
        work_orders_by_number,
        vendors_by_name,
        links_by_pair,
        ra_by_work_order_and_number,
        existing_invoice_keys,
    )


def source_ra_number(row):
    for key in ["ra_number", "ra_bill_no", "ra_bill_number", "ra_no"]:
        value = normalize_doc_number(row.get(key))
        if value:
            return value
    return ""


def build_reports(source_rows, work_orders, vendors, links, ra_bills, invoices):
    (
        work_orders_by_number,
        vendors_by_name,
        links_by_pair,
        ra_by_work_order_and_number,
        existing_invoice_keys,
    ) = build_indexes(work_orders, vendors, links, ra_bills, invoices)

    excel_key_counts = Counter()
    duplicate_correction_keys = set()
    correction_group_keys = set()
    preprocessed = []

    for source in source_rows:
        wo_number = str(source.get("wo_number") or "").strip()
        contractor_name = str(source.get("contractor_name") or "").strip()
        invoice_number = normalize_doc_number(source.get("invoice_number"))
        vendor_matches = vendors_by_name.get(normalize_name(contractor_name), [])
        vendor_id = vendor_matches[0]["id"] if len(vendor_matches) == 1 else contractor_name
        key = (vendor_id, invoice_number.strip().lower())
        excel_key_counts[key] += 1
        preprocessed.append((source, wo_number, contractor_name, invoice_number, key))

    grouped_sources = defaultdict(list)
    for source, wo_number, contractor_name, invoice_number, key in preprocessed:
        grouped_sources[key].append(source)

    for key, duplicate_sources in grouped_sources.items():
        if len(duplicate_sources) <= 1:
            continue
        has_claimed = any(
            "claimed" in str(item.get("itc_claimed") or "").strip().lower()
            for item in duplicate_sources
        )
        if not has_claimed:
            continue
        for item in duplicate_sources:
            itc_status = str(item.get("itc_claimed") or "").strip().lower()
            remarks = str(item.get("remarks") or "").strip().lower()
            if "rejected" in itc_status and "wrong date" in remarks:
                duplicate_correction_keys.add((key, item.get("source_row")))
                correction_group_keys.add(key)

    report_rows = []
    ready_rows = []
    error_rows = []

    for source, wo_number, contractor_name, invoice_number, excel_key in preprocessed:
        work_order_matches = work_orders_by_number.get(wo_number, [])
        vendor_matches = vendors_by_name.get(normalize_name(contractor_name), [])
        work_order = work_order_matches[0] if len(work_order_matches) == 1 else None
        vendor = vendor_matches[0] if len(vendor_matches) == 1 else None
        invoice_date = excel_date(source.get("invoice_date"))
        taxable_amount = number_value(source.get("basic_value"))
        gst_rate_raw = number_value(source.get("gst_rate"))
        gst_rate = gst_rate_raw * 100 if gst_rate_raw is not None and gst_rate_raw <= 1 else gst_rate_raw
        gst_amount = number_value(source.get("gst"))
        invoice_amount = number_value(source.get("total_amount"))
        itc_status = str(source.get("itc_claimed") or "Pending").strip() or "Pending"
        status = "Submitted"
        approval_status = "Approved"
        ra_number = source_ra_number(source)
        ra_bill_id = ""
        reasons = []

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

        if work_order and vendor and (work_order["id"], vendor["id"]) not in links_by_pair:
            reasons.append("vendor_not_linked_to_wo")

        if not invoice_number:
            reasons.append("missing_invoice_number")
        if not invoice_date:
            reasons.append("invalid_date")
        if taxable_amount is None or invoice_amount is None:
            reasons.append("invalid_amount")

        if work_order and vendor:
            invoice_key = (
                work_order.get("organization_id"),
                vendor["id"],
                invoice_number.strip().lower(),
            )
            if invoice_key in existing_invoice_keys:
                reasons.append("duplicate_existing_invoice")

        duplicate_rejected_correction = (
            excel_key,
            source.get("source_row"),
        ) in duplicate_correction_keys

        if duplicate_rejected_correction:
            reasons.append("duplicate_rejected_correction")
        elif excel_key_counts[excel_key] > 1 and excel_key not in correction_group_keys:
            reasons.append("duplicate_excel_invoice")

        if ra_number and work_order:
            matches = ra_by_work_order_and_number.get((work_order["id"], ra_number.strip().lower()), [])
            if len(matches) == 1:
                ra_bill_id = matches[0]["id"]
            elif len(matches) == 0:
                reasons.append("unmatched_ra_bill_reference")
            else:
                reasons.append("ambiguous_ra_bill_reference")

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
            "ra_bill_id": ra_bill_id,
            "invoice_number": invoice_number,
            "invoice_date": invoice_date,
            "taxable_amount": taxable_amount,
            "gst_rate": gst_rate if gst_rate is not None else 0,
            "gst_amount": gst_amount if gst_amount is not None else 0,
            "invoice_amount": invoice_amount,
            "status": status,
            "approval_status": approval_status,
            "itc_status": itc_status,
            "remarks": source.get("remarks", ""),
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
                    "ra_bill_id": row["ra_bill_id"],
                    "invoice_number": row["invoice_number"],
                    "invoice_date": row["invoice_date"],
                    "taxable_amount": row["taxable_amount"],
                    "gst_rate": row["gst_rate"],
                    "gst_amount": row["gst_amount"],
                    "invoice_amount": row["invoice_amount"],
                    "status": row["status"],
                    "approval_status": row["approval_status"],
                    "itc_status": row["itc_status"],
                    "remarks": row["remarks"],
                }
            )
        else:
            error_rows.append(row)

    return report_rows, ready_rows, error_rows


def count_errors(error_rows):
    counts = {
        "missing_wo": 0,
        "missing_vendor": 0,
        "vendor_not_linked_to_wo": 0,
        "missing_invalid_invoice_number": 0,
        "invalid_date": 0,
        "duplicate_invoices": 0,
        "unmatched_ra_bill_references": 0,
    }
    for row in error_rows:
        reason = row.get("reason", "")
        if "missing_work_order" in reason:
            counts["missing_wo"] += 1
        if "missing_vendor" in reason:
            counts["missing_vendor"] += 1
        if "vendor_not_linked_to_wo" in reason:
            counts["vendor_not_linked_to_wo"] += 1
        if "missing_invoice_number" in reason:
            counts["missing_invalid_invoice_number"] += 1
        if "invalid_date" in reason:
            counts["invalid_date"] += 1
        if "duplicate_" in reason:
            counts["duplicate_invoices"] += 1
        if "ra_bill_reference" in reason:
            counts["unmatched_ra_bill_references"] += 1
    return counts


def parse_args():
    parser = argparse.ArgumentParser(description="Dry-run Invoices import from workbook.")
    parser.add_argument("--source", default=DEFAULT_WORKBOOK, help="Path to source workbook.")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="Output report directory.")
    return parser.parse_args()


def main():
    args = parse_args()
    load_env()
    workbook_path = Path(args.source).resolve()
    if not workbook_path.exists():
        raise FileNotFoundError(f"Workbook not found: {workbook_path}")

    source_rows = extract_invoice_rows(workbook_path)
    work_orders = supabase_get("work_orders", "id,organization_id,wo_number")
    vendors = supabase_get("vendors", "id,vendor_name")
    links = supabase_get("work_order_vendors", "work_order_id,vendor_id")
    ra_bills = supabase_get("ra_bills", "id,work_order_id,ra_number")
    invoices = supabase_get("invoices", "id,organization_id,vendor_id,invoice_number")
    report_rows, ready_rows, error_rows = build_reports(
        source_rows, work_orders, vendors, links, ra_bills, invoices
    )

    out_dir = Path(args.out_dir).resolve()
    report_path = out_dir / "invoices_dry_run_report.csv"
    ready_path = out_dir / "invoices_sql_ready.csv"
    errors_path = out_dir / "invoices_errors.csv"
    report_headers = [
        "source_row",
        "wo_number",
        "contractor_name",
        "organization_id",
        "work_order_id",
        "vendor_id",
        "matched_vendor_name",
        "ra_number",
        "ra_bill_id",
        "invoice_number",
        "invoice_date",
        "taxable_amount",
        "gst_rate",
        "gst_amount",
        "invoice_amount",
        "status",
        "approval_status",
        "itc_status",
        "remarks",
        "dry_run_status",
        "reason",
    ]
    ready_headers = [
        "organization_id",
        "work_order_id",
        "vendor_id",
        "ra_bill_id",
        "invoice_number",
        "invoice_date",
        "taxable_amount",
        "gst_rate",
        "gst_amount",
        "invoice_amount",
        "status",
        "approval_status",
        "itc_status",
        "remarks",
    ]
    write_csv(report_path, report_rows, report_headers)
    write_csv(ready_path, ready_rows, ready_headers)
    write_csv(errors_path, error_rows, report_headers)

    summary = {
        "workbook": str(workbook_path),
        "total_rows": len(source_rows),
        "ready_rows": len(ready_rows),
        **count_errors(error_rows),
        "report_csv": str(report_path),
        "sql_ready_csv": str(ready_path),
        "errors_csv": str(errors_path),
    }
    print(json.dumps(summary, indent=2))
    print("Dry-run only. No Invoices inserted and no documents imported.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
