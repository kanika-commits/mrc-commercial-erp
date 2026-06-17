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
DEFAULT_OUT_DIR = "reports/payments-import"
SHEET_NAME = "Payments"
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


def normalized_key(value):
    return normalize_doc_number(value).strip().lower()


def csv_value(value):
    return "" if value is None else str(value)


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


def extract_payment_rows(workbook_path):
    rows = read_sheet_rows(workbook_path)
    if not rows:
        return []
    headers = [normalize_header(cell) for cell in rows[0]]
    extracted = []
    for row_number, row in enumerate(rows[1:], start=2):
        item = {"source_row": row_number}
        for index, header in enumerate(headers):
            item[header] = str(row[index] if index < len(row) else "").strip()
        has_identity_data = any(
            str(item.get(key) or "").strip()
            for key in ["wo_number", "contractor_name", "payment_date"]
        )
        has_amount_data = any(
            (number_value(item.get(key)) or 0) > 0
            for key in [
                "total_payment",
                "payment_amount",
                "amount",
                "transferred_amount",
                "transferred",
            ]
        )
        has_main_data = has_identity_data or has_amount_data
        if not has_main_data:
            continue
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


def first_present(row, keys):
    for key in keys:
        value = str(row.get(key) or "").strip()
        if value:
            return value
    return ""


def is_active_status(value):
    return str(value or "active").strip().lower() in {"active", "enabled", "open", ""}


def find_mrc_bank_account(companies, bank_accounts):
    mrc_company_ids = {
        company.get("id")
        for company in companies
        if str(company.get("company_code") or "").strip().upper() == "MRC"
        or "mrc infracon" in normalize_name(company.get("company_name"))
    }
    candidates = [
        account
        for account in bank_accounts
        if account.get("company_id") in mrc_company_ids
        and is_active_status(account.get("status"))
    ]
    if not candidates:
        return None
    candidates.sort(
        key=lambda account: (
            not bool(account.get("is_default")),
            str(account.get("created_at") or ""),
            str(account.get("id") or ""),
        )
    )
    return candidates[0]


def build_indexes(work_orders, vendors, links, invoices, payments):
    work_orders_by_number = defaultdict(list)
    vendors_by_name = defaultdict(list)
    links_by_pair = set()
    invoices_by_key = defaultdict(list)
    existing_payment_numbers = set()
    existing_utrs_by_org = defaultdict(set)

    for work_order in work_orders:
        work_orders_by_number[str(work_order.get("wo_number") or "").strip()].append(work_order)
    for vendor in vendors:
        vendors_by_name[normalize_name(vendor.get("vendor_name"))].append(vendor)
    for link in links:
        links_by_pair.add((link.get("work_order_id"), link.get("vendor_id")))
    for invoice in invoices:
        invoices_by_key[
            (
                invoice.get("organization_id"),
                invoice.get("vendor_id"),
                normalized_key(invoice.get("invoice_number")),
            )
        ].append(invoice)
    for payment in payments:
        organization_id = payment.get("organization_id")
        payment_number = normalized_key(payment.get("payment_number"))
        utr_number = normalized_key(payment.get("utr_number"))
        if organization_id and payment_number:
            existing_payment_numbers.add((organization_id, payment_number))
        if organization_id and utr_number:
            existing_utrs_by_org[organization_id].add(utr_number)

    return (
        work_orders_by_number,
        vendors_by_name,
        links_by_pair,
        invoices_by_key,
        existing_payment_numbers,
        existing_utrs_by_org,
    )


def generate_payment_number(organization_id, existing_payment_numbers, generated_payment_numbers):
    sequence = 1
    while True:
        payment_number = f"HIST-PAY-{sequence:06d}"
        key = (organization_id, normalized_key(payment_number))
        if key not in existing_payment_numbers and key not in generated_payment_numbers:
            generated_payment_numbers.add(key)
            return payment_number
        sequence += 1


def source_invoice_number(row):
    return normalize_doc_number(
        first_present(row, ["invoice_number", "invoice_no", "invoice_reference"])
    )


def source_utr_number(row):
    return normalize_doc_number(
        first_present(row, ["utr_number", "utr_no", "utr", "reference_utr"])
    )


def source_reference_number(row):
    return normalize_doc_number(
        first_present(row, ["reference_number", "reference_no", "reference"])
    )


def build_reports(source_rows, work_orders, vendors, links, invoices, payments, companies, bank_accounts):
    (
        work_orders_by_number,
        vendors_by_name,
        links_by_pair,
        invoices_by_key,
        existing_payment_numbers,
        existing_utrs_by_org,
    ) = build_indexes(work_orders, vendors, links, invoices, payments)

    mrc_bank_account = find_mrc_bank_account(companies, bank_accounts)
    generated_payment_numbers = set()
    seen_utr_keys = set()
    report_rows = []
    ready_rows = []
    error_rows = []

    for source in source_rows:
        wo_number = str(source.get("wo_number") or "").strip()
        contractor_name = str(source.get("contractor_name") or "").strip()
        work_order_matches = work_orders_by_number.get(wo_number, [])
        vendor_matches = vendors_by_name.get(normalize_name(contractor_name), [])
        work_order = work_order_matches[0] if len(work_order_matches) == 1 else None
        vendor = vendor_matches[0] if len(vendor_matches) == 1 else None
        organization_id = work_order.get("organization_id", "") if work_order else ""
        invoice_number = source_invoice_number(source)
        utr_number = source_utr_number(source)
        reference_number = source_reference_number(source)
        payment_date = excel_date(source.get("payment_date"))
        total_payment = number_value(
            first_present(source, ["total_payment", "payment_amount", "amount"])
        )
        tds_amount = number_value(first_present(source, ["tds", "tds_amount", "tds_deducted"]))
        transferred_amount = number_value(
            first_present(source, ["transferred_amount", "transferred", "net_amount"])
        )
        reasons = []

        if tds_amount is None:
            tds_amount = 0
        if transferred_amount is None and total_payment is not None:
            transferred_amount = round(total_payment - tds_amount, 2)

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

        if not payment_date:
            reasons.append("invalid_date")
        if total_payment is None or total_payment <= 0:
            reasons.append("invalid_amount")
        if tds_amount < 0 or (total_payment is not None and tds_amount > total_payment):
            reasons.append("invalid_amount")
        if transferred_amount is None or transferred_amount < 0:
            reasons.append("invalid_amount")

        invoice_id = ""
        if invoice_number:
            if work_order and vendor:
                invoice_matches = invoices_by_key.get(
                    (organization_id, vendor["id"], normalized_key(invoice_number)),
                    [],
                )
                if len(invoice_matches) == 1:
                    invoice_id = invoice_matches[0]["id"]
                elif len(invoice_matches) == 0:
                    reasons.append("unmatched_invoice")
                else:
                    reasons.append("ambiguous_invoice")
            else:
                reasons.append("unmatched_invoice")

        if not mrc_bank_account:
            reasons.append("missing_mrc_bank_account")

        payment_number = (
            normalize_doc_number(first_present(source, ["payment_number", "payment_no"]))
            if organization_id
            else ""
        )
        if organization_id and not payment_number:
            payment_number = generate_payment_number(
                organization_id,
                existing_payment_numbers,
                generated_payment_numbers,
            )
        elif organization_id:
            payment_key = (organization_id, normalized_key(payment_number))
            if payment_key in existing_payment_numbers or payment_key in generated_payment_numbers:
                reasons.append("duplicate_payment_number")
            generated_payment_numbers.add(payment_key)

        if organization_id and utr_number:
            utr_key = (organization_id, normalized_key(utr_number))
            if (
                normalized_key(utr_number) in existing_utrs_by_org[organization_id]
                or utr_key in seen_utr_keys
            ):
                reasons.append("duplicate_utr")
            seen_utr_keys.add(utr_key)

        status_value = "ready" if not reasons else "error"
        row = {
            "source_row": source.get("source_row"),
            "wo_number": wo_number,
            "contractor_name": contractor_name,
            "organization_id": organization_id,
            "work_order_id": work_order.get("id", "") if work_order else "",
            "vendor_id": vendor.get("id", "") if vendor else "",
            "matched_vendor_name": vendor.get("vendor_name", "") if vendor else "",
            "invoice_number": invoice_number,
            "invoice_id": invoice_id,
            "payment_number": payment_number,
            "payment_date": payment_date,
            "total_payment": total_payment,
            "tds_amount": tds_amount,
            "transferred_amount": transferred_amount,
            "payment_type": source.get("payment_type") or "Work Order",
            "payment_mode": source.get("payment_mode") or "Bank Transfer",
            "utr_number": utr_number,
            "reference_number": reference_number,
            "company_bank_account_id": mrc_bank_account.get("id", "") if mrc_bank_account else "",
            "mrc_bank_account": (
                f"{mrc_bank_account.get('bank_name', '')} • ****{str(mrc_bank_account.get('account_number') or '')[-4:]}"
                if mrc_bank_account
                else ""
            ),
            "status": source.get("status") or "Completed",
            "remarks": source.get("remarks") or "",
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
                    "invoice_id": row["invoice_id"],
                    "payment_number": row["payment_number"],
                    "payment_date": row["payment_date"],
                    "total_payment": row["total_payment"],
                    "tds_amount": row["tds_amount"],
                    "transferred_amount": row["transferred_amount"],
                    "payment_type": row["payment_type"],
                    "payment_mode": row["payment_mode"],
                    "utr_number": row["utr_number"],
                    "reference_number": row["reference_number"],
                    "company_bank_account_id": row["company_bank_account_id"],
                    "status": row["status"],
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
        "missing_invalid_date": 0,
        "invalid_amount_rows": 0,
        "missing_mrc_bank_account": 0,
        "unmatched_invoices": 0,
        "duplicate_utrs": 0,
        "duplicate_payment_numbers": 0,
    }
    for row in error_rows:
        reason = row.get("reason", "")
        if "missing_work_order" in reason:
            counts["missing_wo"] += 1
        if "missing_vendor" in reason:
            counts["missing_vendor"] += 1
        if "vendor_not_linked_to_wo" in reason:
            counts["vendor_not_linked_to_wo"] += 1
        if "invalid_date" in reason:
            counts["missing_invalid_date"] += 1
        if "invalid_amount" in reason:
            counts["invalid_amount_rows"] += 1
        if "missing_mrc_bank_account" in reason:
            counts["missing_mrc_bank_account"] += 1
        if "invoice" in reason:
            counts["unmatched_invoices"] += 1
        if "duplicate_utr" in reason:
            counts["duplicate_utrs"] += 1
        if "duplicate_payment_number" in reason:
            counts["duplicate_payment_numbers"] += 1
    return counts


def parse_args():
    parser = argparse.ArgumentParser(description="Dry-run Payments import from workbook.")
    parser.add_argument("--source", default=DEFAULT_WORKBOOK, help="Path to source workbook.")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="Output report directory.")
    return parser.parse_args()


def main():
    args = parse_args()
    load_env()
    workbook_path = Path(args.source).resolve()
    if not workbook_path.exists():
        raise FileNotFoundError(f"Workbook not found: {workbook_path}")

    source_rows = extract_payment_rows(workbook_path)
    work_orders = supabase_get("work_orders", "id,organization_id,wo_number")
    vendors = supabase_get("vendors", "id,vendor_name")
    links = supabase_get("work_order_vendors", "work_order_id,vendor_id")
    invoices = supabase_get("invoices", "id,organization_id,vendor_id,invoice_number")
    payments = supabase_get("payments", "id,organization_id,payment_number,utr_number")
    companies = supabase_get("companies", "id,organization_id,company_code,company_name")
    bank_accounts = supabase_get(
        "company_bank_accounts",
        "id,organization_id,company_id,bank_name,account_number,is_default,status,created_at",
    )

    report_rows, ready_rows, error_rows = build_reports(
        source_rows,
        work_orders,
        vendors,
        links,
        invoices,
        payments,
        companies,
        bank_accounts,
    )

    out_dir = Path(args.out_dir).resolve()
    report_path = out_dir / "payments_dry_run_report.csv"
    ready_path = out_dir / "payments_sql_ready.csv"
    errors_path = out_dir / "payments_errors.csv"
    report_headers = [
        "source_row",
        "wo_number",
        "contractor_name",
        "organization_id",
        "work_order_id",
        "vendor_id",
        "matched_vendor_name",
        "invoice_number",
        "invoice_id",
        "payment_number",
        "payment_date",
        "total_payment",
        "tds_amount",
        "transferred_amount",
        "payment_type",
        "payment_mode",
        "utr_number",
        "reference_number",
        "company_bank_account_id",
        "mrc_bank_account",
        "status",
        "remarks",
        "dry_run_status",
        "reason",
    ]
    ready_headers = [
        "organization_id",
        "work_order_id",
        "vendor_id",
        "invoice_id",
        "payment_number",
        "payment_date",
        "total_payment",
        "tds_amount",
        "transferred_amount",
        "payment_type",
        "payment_mode",
        "utr_number",
        "reference_number",
        "company_bank_account_id",
        "status",
        "remarks",
    ]

    write_csv(report_path, report_rows, report_headers)
    write_csv(ready_path, ready_rows, ready_headers)
    write_csv(errors_path, error_rows, report_headers)

    counts = count_errors(error_rows)
    print("Payments import dry-run complete")
    print(f"total rows: {len(source_rows)}")
    print(f"ready rows: {len(ready_rows)}")
    print(f"missing WO/vendor: {counts['missing_wo']} / {counts['missing_vendor']}")
    print(f"vendor not linked to WO: {counts['vendor_not_linked_to_wo']}")
    print(f"missing/invalid date: {counts['missing_invalid_date']}")
    print(f"invalid amount rows: {counts['invalid_amount_rows']}")
    print(f"missing MRC bank account: {counts['missing_mrc_bank_account']}")
    print(f"unmatched invoices: {counts['unmatched_invoices']}")
    print(f"duplicate UTRs: {counts['duplicate_utrs']}")
    print(f"duplicate payment numbers: {counts['duplicate_payment_numbers']}")
    print(f"report: {report_path}")
    print(f"sql ready: {ready_path}")
    print(f"errors: {errors_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
