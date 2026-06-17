#!/usr/bin/env python3

import argparse
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path


DEFAULT_SOURCE = "import-data/drive_document_links.csv"
DEFAULT_OUT_DIR = "reports/drive-document-links"


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


def normalized_doc_number(value):
    raw = str(value or "").strip()
    if re.fullmatch(r"\d+\.0+", raw):
        return raw.split(".")[0]
    return raw


def compact(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def tokens(value):
    return [token for token in re.split(r"[^a-z0-9]+", str(value or "").lower()) if token]


def normalized_ra_number(value):
    raw = normalized_doc_number(value)
    match = re.search(r"(?:^|\b)r\.?\s*a\.?\s*[-_\s]*0*(\d+)(?:\b|$)", raw, re.IGNORECASE)
    if match:
        return str(int(match.group(1)))
    match = re.search(
        r"(?:^|\b)0*(\d+)(?:st|nd|rd|th)?\s*r\.?\s*a\.?(?:\b|$)",
        raw,
        re.IGNORECASE,
    )
    if match:
        return str(int(match.group(1)))
    if re.fullmatch(r"0*\d+", str(raw).strip()):
        return str(int(str(raw).strip()))
    return compact(raw)


def normalize_invoice_number(value):
    text = normalized_doc_number(value).upper().strip()
    text = re.sub(r"\.[A-Z0-9]{1,6}$", "", text)
    text = re.sub(r"[_\-\s]+", "/", text)
    text = re.sub(r"/+", "/", text)
    text = text.strip("/")
    return text


def compact_invoice_number(value):
    return re.sub(r"[^A-Z0-9]+", "", normalize_invoice_number(value))


def compact_filename_without_extension(file_name):
    stem = re.sub(r"\.[^.\\/]+$", "", str(file_name or ""))
    return re.sub(r"[^A-Za-z0-9]+", "", stem).upper()


def extract_ra_number_from_filename(file_name):
    text = str(file_name or "")
    if re.search(r"full\s*[_&and-]*\s*final", text, re.IGNORECASE):
        return "fullfinal"
    match = re.search(
        r"(?:^|[^A-Za-z0-9])R\.?\s*A\.?\s*[-_\s]*0*(\d+)(?:[^A-Za-z0-9]|$)",
        text,
        re.IGNORECASE,
    )
    if match:
        return str(int(match.group(1)))
    match = re.search(
        r"(?:^|[^A-Za-z0-9])0*(\d+)(?:st|nd|rd|th)?\s*R\.?\s*A\.?(?:[^A-Za-z0-9]|$)",
        text,
        re.IGNORECASE,
    )
    if match:
        return str(int(match.group(1)))
    match = re.search(
        r"^APPROVED[_\s-]+[A-Z0-9]+[_\s-]+(?:MRC|GLC|PI|MRCTS)[_\s-]+\d+[A-Z]?[_\s-]+0*(\d+)(?:[_\s-]|$)",
        text,
        re.IGNORECASE,
    )
    if match:
        return str(int(match.group(1)))
    return ""


def is_work_order_like(wo_number, folder_name):
    values = [str(wo_number or ""), str(folder_name or "")]
    for value in values:
        if re.search(r"(?:^|[/_.\-\s])(MRC|GLC|PI|MRCTS)(?:[/_.\-\s]|\d)", value, re.IGNORECASE) and re.search(r"\d", value):
            return True
    return False


def csv_value(value):
    return "" if value is None else str(value)


def read_csv(path):
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        rows = []
        for index, row in enumerate(reader, start=2):
            normalized = {"source_row": index}
            for key, value in row.items():
                normalized[normalize_header(key)] = str(value or "").strip()
            rows.append(normalized)
        return rows


def write_csv(path, rows, headers):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: csv_value(row.get(header)) for header in headers})


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


def optional_supabase_get(table, select):
    try:
        return supabase_get(table, select), True
    except Exception as error:
        message = str(error).lower()
        if "does not exist" in message or "404" in message:
            return [], False
        raise


def build_indexes(work_orders, vendors, links, ra_bills, invoices, debit_notes):
    work_orders_by_number = defaultdict(list)
    primary_vendor_by_work_order = {}
    vendors_by_id = {}
    ra_bills_by_work_order = defaultdict(list)
    invoices_by_work_order = defaultdict(list)
    debit_notes_by_work_order = defaultdict(list)

    for work_order in work_orders:
        work_orders_by_number[str(work_order.get("wo_number") or "").strip()].append(work_order)

    for vendor in vendors:
        vendors_by_id[vendor.get("id")] = vendor

    sorted_links = sorted(
        links,
        key=lambda link: (
            not bool(link.get("is_primary")),
            str(link.get("created_at") or ""),
            str(link.get("id") or ""),
        ),
    )
    for link in sorted_links:
        work_order_id = link.get("work_order_id")
        vendor_id = link.get("vendor_id")
        if work_order_id and vendor_id and work_order_id not in primary_vendor_by_work_order:
            primary_vendor_by_work_order[work_order_id] = vendors_by_id.get(vendor_id)

    for bill in ra_bills:
        ra_bills_by_work_order[bill.get("work_order_id")].append(bill)

    for invoice in invoices:
        invoices_by_work_order[invoice.get("work_order_id")].append(invoice)

    for note in debit_notes:
        debit_notes_by_work_order[note.get("work_order_id")].append(note)

    return (
        work_orders_by_number,
        primary_vendor_by_work_order,
        ra_bills_by_work_order,
        invoices_by_work_order,
        debit_notes_by_work_order,
    )


def work_order_number_variants(value):
    raw = str(value or "").strip()
    variants = [raw]

    suffix_match = re.match(r"^(.+/\d+)/(R\d*|[A-Z]\d*)$", raw, re.IGNORECASE)
    if suffix_match:
        variants.append(f"{suffix_match.group(1)}-{suffix_match.group(2)}")

    missing_slash_match = re.match(r"^(.+/(?:MRC|GLC|PI|MRCTS))(\d+[A-Z]?)$", raw, re.IGNORECASE)
    if missing_slash_match:
        variants.append(f"{missing_slash_match.group(1)}/{missing_slash_match.group(2)}")

    unique = []
    seen = set()
    for variant in variants:
        if variant and variant not in seen:
            unique.append(variant)
            seen.add(variant)
    return unique


def find_work_order(work_orders_by_number, wo_number):
    matches = []
    matched_variant = ""
    for variant in work_order_number_variants(wo_number):
        variant_matches = work_orders_by_number.get(variant, [])
        if variant_matches:
            matches = variant_matches
            matched_variant = variant
            break
    if len(matches) == 1:
        return matches[0], matches, matched_variant
    return None, matches, matched_variant


def numeric_int(value):
    try:
        return int(str(value).lstrip("0") or "0")
    except ValueError:
        return None


def number_matches_filename(number, file_name, mode):
    raw = normalized_doc_number(number)
    if not raw:
        return False

    raw_compact = compact(raw)
    file_compact = compact(file_name)
    file_tokens = tokens(file_name)

    if raw_compact and raw_compact in file_compact and not raw_compact.isdigit():
        return True

    if raw_compact and raw_compact in file_tokens:
        return True

    if raw_compact.isdigit():
        number_int = numeric_int(raw_compact)
        if number_int is None:
            return False
        numeric_tokens = [token for token in file_tokens if token.isdigit()]
        if any(numeric_int(token) == number_int for token in numeric_tokens):
            return True

        padded = f"{number_int:03d}"
        if mode == "ra_bill":
            return f"ra{padded}" in file_compact or f"ra{number_int}" in file_compact
        return False

    return False


def match_by_document_number(records, field_name, file_name, mode):
    matches = [
        record
        for record in records
        if number_matches_filename(record.get(field_name), file_name, mode)
    ]
    unique = []
    seen = set()
    for match in matches:
        if match.get("id") not in seen:
            unique.append(match)
            seen.add(match.get("id"))
    if len(unique) == 1:
        return unique[0], ""
    if len(unique) > 1:
        return None, f"ambiguous_{mode}"
    return None, f"unmatched_{mode}"


def candidate_numbers(records, field_name):
    return " | ".join(
        str(record.get(field_name) or "")
        for record in records
        if str(record.get(field_name) or "").strip()
    )


def match_ra_bill(records, file_name):
    extracted = extract_ra_number_from_filename(file_name)
    if not extracted:
        return None, "unmatched_ra_bill", extracted

    matches = [
        record
        for record in records
        if normalized_ra_number(record.get("ra_number")) == extracted
    ]

    if len(matches) == 1:
        return matches[0], "", extracted
    if len(matches) > 1:
        return None, "ambiguous_ra_bill", extracted
    return None, "unmatched_ra_bill", extracted


def invoice_candidates_from_filename(file_name, wo_number):
    file_tokens = tokens(re.sub(r"\.[^.\\/]+$", "", str(file_name or "")))
    wo_tokens = tokens(wo_number)
    candidates = []

    start = -1
    for index in range(0, max(len(file_tokens) - len(wo_tokens) + 1, 0)):
        if file_tokens[index : index + len(wo_tokens)] == wo_tokens:
            start = index + len(wo_tokens)
            break

    remaining = file_tokens[start:] if start >= 0 else file_tokens
    if remaining:
        if len(remaining) >= 2 and remaining[0] == remaining[1]:
            candidates.append(remaining[0])
        if len(remaining) >= 3 and remaining[0].isdigit() and remaining[1].isdigit():
            candidates.append("/".join(remaining[:3]))
        candidates.append(remaining[0])

    return [candidate for candidate in dict.fromkeys(candidates) if candidate]


def match_invoice(records, file_name, wo_number):
    file_compact = compact_filename_without_extension(file_name)
    matches = []
    extracted_candidates = invoice_candidates_from_filename(file_name, wo_number)
    extracted_compacts = {compact_invoice_number(candidate) for candidate in extracted_candidates}

    for record in records:
        invoice_number = record.get("invoice_number")
        normalized = normalize_invoice_number(invoice_number)
        compacted = compact_invoice_number(invoice_number)
        if not compacted:
            continue

        if extracted_compacts and compacted in extracted_compacts:
            matches.append(record)
            continue

        numeric = re.fullmatch(r"0*\d+", compacted)
        if numeric and not extracted_compacts:
            needle = str(int(compacted))
            file_tokens = tokens(file_name)
            if any(token.isdigit() and str(int(token)) == needle for token in file_tokens):
                matches.append(record)
        elif not extracted_compacts and compacted in file_compact:
            matches.append(record)
        elif not extracted_compacts and normalized and normalized.replace("/", "") in file_compact:
            matches.append(record)

    unique = []
    seen = set()
    for match in matches:
        if match.get("id") not in seen:
            unique.append(match)
            seen.add(match.get("id"))

    extracted = ""
    if len(unique) == 1:
        extracted = unique[0].get("invoice_number") or ""
        return unique[0], "", extracted
    if len(unique) > 1:
        return None, "ambiguous_invoice", " | ".join(extracted_candidates)
    return None, "unmatched_invoice", " | ".join(extracted_candidates)


def vendor_document_type(file_name):
    text = str(file_name or "").lower()
    if "pan" in text:
        return "PAN"
    if "gst" in text:
        return "GST_CERTIFICATE"
    if "aadhaar" in text or "aadhar" in text or "cin" in text:
        return "AADHAAR_CIN"
    if "bank" in text or "cheque" in text:
        return "BANK_PROOF"
    if "msme" in text:
        return "MSME_CERTIFICATE"
    return "ADDITIONAL_DOCUMENT"


def base_ready_row(source, organization_id, parent_id_field, parent_id, document_type):
    return {
        "organization_id": organization_id,
        parent_id_field: parent_id,
        "document_type": document_type,
        "file_name": source.get("file_name"),
        "file_url": source.get("file_url"),
        "file_id": source.get("file_id"),
        "mime_type": source.get("mime_type"),
        "uploaded_at": source.get("updated_at") or source.get("created_at"),
    }


def build_reports(source_rows, work_orders, vendors, links, ra_bills, invoices, debit_notes, debit_note_documents_exists):
    (
        work_orders_by_number,
        primary_vendor_by_work_order,
        ra_bills_by_work_order,
        invoices_by_work_order,
        debit_notes_by_work_order,
    ) = build_indexes(work_orders, vendors, links, ra_bills, invoices, debit_notes)

    report_rows = []
    error_rows = []
    ready = {
        "work_order": [],
        "ra_bill": [],
        "invoice": [],
        "vendor": [],
        "debit_note": [],
    }

    for source in source_rows:
        category = str(source.get("category") or "").strip().lower()
        wo_number = str(source.get("wo_number_normalized") or "").strip()
        file_name = source.get("file_name")
        reasons = []
        target_table = ""
        parent_id = ""
        parent_id_field = ""
        organization_id = ""
        document_type = category
        extracted_document_number = ""
        candidate_documents = ""
        ignored_non_work_order_folder = False

        work_order, work_order_matches, matched_wo_number = find_work_order(
            work_orders_by_number, wo_number
        )

        if not wo_number:
            reasons.append("missing_work_order_number")
        elif len(work_order_matches) == 0:
            if is_work_order_like(wo_number, source.get("wo_folder_name")):
                reasons.append("unmatched_work_order")
            else:
                ignored_non_work_order_folder = True
                reasons.append("ignored_non_work_order_folder")
        elif len(work_order_matches) > 1:
            reasons.append("ambiguous_work_order")

        if work_order:
            organization_id = work_order.get("organization_id", "")

        if not source.get("file_id") or not source.get("file_url"):
            reasons.append("missing_file_link")

        if category == "work_order":
            target_table = "work_order_files"
            parent_id_field = "work_order_id"
            parent_id = work_order.get("id", "") if work_order else ""
            document_type = "work_order"
        elif category == "vendor":
            target_table = "vendor_documents"
            parent_id_field = "vendor_id"
            vendor = primary_vendor_by_work_order.get(work_order.get("id")) if work_order else None
            if vendor:
                parent_id = vendor.get("id", "")
                document_type = vendor_document_type(file_name)
            elif work_order:
                reasons.append("unmatched_vendor")
        elif category == "ra_bill":
            target_table = "ra_bill_documents"
            parent_id_field = "ra_bill_id"
            if work_order:
                candidates = ra_bills_by_work_order.get(work_order.get("id"), [])
                candidate_documents = candidate_numbers(candidates, "ra_number")
                match, error, extracted_document_number = match_ra_bill(candidates, file_name)
                if match:
                    parent_id = match.get("id", "")
                    document_type = "RA Bill"
                else:
                    reasons.append(error)
        elif category == "invoice":
            target_table = "invoice_documents"
            parent_id_field = "invoice_id"
            if work_order:
                candidates = invoices_by_work_order.get(work_order.get("id"), [])
                candidate_documents = candidate_numbers(candidates, "invoice_number")
                match, error, extracted_document_number = match_invoice(
                    candidates, file_name, matched_wo_number or wo_number
                )
                if match:
                    parent_id = match.get("id", "")
                    document_type = "Invoice"
                else:
                    reasons.append(error)
        elif category == "debit_note":
            target_table = "debit_note_documents"
            parent_id_field = "debit_note_id"
            if not debit_note_documents_exists:
                reasons.append("unsupported_debit_note")
            elif work_order:
                match, error = match_by_document_number(
                    debit_notes_by_work_order.get(work_order.get("id"), []),
                    "debit_note_number",
                    file_name,
                    "debit_note",
                )
                if match:
                    parent_id = match.get("id", "")
                    document_type = "Debit Note"
                else:
                    reasons.append(error)
        else:
            target_table = category
            reasons.append("unsupported_category")

        status = "ignored" if ignored_non_work_order_folder else ("ready" if not reasons and parent_id else "error")
        if status == "ready":
            ready_row = base_ready_row(
                source,
                organization_id,
                parent_id_field,
                parent_id,
                document_type,
            )
            ready[category].append(ready_row)
        elif status == "error":
            if not parent_id and "unsupported" not in "; ".join(reasons):
                if category in {"ra_bill", "invoice", "vendor", "debit_note", "work_order"}:
                    reasons.append(f"missing_parent_{category}")

        report_row = {
            "source_row": source.get("source_row"),
            "wo_folder_name": source.get("wo_folder_name"),
            "wo_number_normalized": wo_number,
            "matched_wo_number": matched_wo_number,
            "category": category,
            "subfolder_name": source.get("subfolder_name"),
            "file_name": file_name,
            "file_id": source.get("file_id"),
            "file_url": source.get("file_url"),
            "mime_type": source.get("mime_type"),
            "created_at": source.get("created_at"),
            "updated_at": source.get("updated_at"),
            "target_table": target_table,
            "organization_id": organization_id,
            "parent_id_field": parent_id_field,
            "parent_record_id": parent_id,
            "document_type": document_type,
            "extracted_document_number": extracted_document_number,
            "candidate_documents": candidate_documents,
            "dry_run_status": status,
            "reason": "; ".join(dict.fromkeys(reasons)),
        }
        report_rows.append(report_row)
        if status == "error":
            error_rows.append(report_row)

    return report_rows, ready, error_rows


def count_summary(report_rows, ready, error_rows):
    counts = {
        "total_rows": len(report_rows),
        "ready_work_order_files": len(ready["work_order"]),
        "ready_ra_bill_files": len(ready["ra_bill"]),
        "ready_invoice_files": len(ready["invoice"]),
        "ready_vendor_files": len(ready["vendor"]),
        "ignored_non_work_order_folders": 0,
        "unsupported_debit_note_files": 0,
        "unmatched_work_orders": 0,
        "unmatched_ra_bills": 0,
        "unmatched_invoices": 0,
        "unmatched_vendors": 0,
    }
    for row in report_rows:
        if "ignored_non_work_order_folder" in row.get("reason", ""):
            counts["ignored_non_work_order_folders"] += 1
    for row in error_rows:
        reason = row.get("reason", "")
        if "unsupported_debit_note" in reason:
            counts["unsupported_debit_note_files"] += 1
        if "unmatched_work_order" in reason:
            counts["unmatched_work_orders"] += 1
        if "unmatched_ra_bill" in reason:
            counts["unmatched_ra_bills"] += 1
        if "unmatched_invoice" in reason:
            counts["unmatched_invoices"] += 1
        if "unmatched_vendor" in reason:
            counts["unmatched_vendors"] += 1
    return counts


def parse_args():
    parser = argparse.ArgumentParser(
        description="Dry-run historical Google Drive document link import."
    )
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="Path to Drive link CSV.")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="Output report directory.")
    return parser.parse_args()


def main():
    args = parse_args()
    load_env()

    source_path = Path(args.source).resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Source CSV not found: {source_path}")

    source_rows = read_csv(source_path)
    work_orders = supabase_get("work_orders", "id,organization_id,wo_number")
    vendors = supabase_get("vendors", "id,vendor_name")
    links = supabase_get("work_order_vendors", "id,work_order_id,vendor_id,is_primary,created_at")
    ra_bills = supabase_get("ra_bills", "id,organization_id,work_order_id,ra_number")
    invoices = supabase_get("invoices", "id,organization_id,work_order_id,invoice_number")
    debit_notes = supabase_get("debit_notes", "id,organization_id,work_order_id,debit_note_number")
    _, debit_note_documents_exists = optional_supabase_get("debit_note_documents", "id")

    report_rows, ready, error_rows = build_reports(
        source_rows,
        work_orders,
        vendors,
        links,
        ra_bills,
        invoices,
        debit_notes,
        debit_note_documents_exists,
    )

    out_dir = Path(args.out_dir).resolve()
    report_path = out_dir / "document_links_dry_run_report.csv"
    errors_path = out_dir / "document_links_errors.csv"
    work_order_path = out_dir / "work_order_files_sql_ready.csv"
    ra_bill_path = out_dir / "ra_bill_documents_sql_ready.csv"
    invoice_path = out_dir / "invoice_documents_sql_ready.csv"
    vendor_path = out_dir / "vendor_documents_sql_ready.csv"

    report_headers = [
        "source_row",
        "wo_folder_name",
        "wo_number_normalized",
        "matched_wo_number",
        "category",
        "subfolder_name",
        "file_name",
        "file_id",
        "file_url",
        "mime_type",
        "created_at",
        "updated_at",
        "target_table",
        "organization_id",
        "parent_id_field",
        "parent_record_id",
        "document_type",
        "extracted_document_number",
        "candidate_documents",
        "dry_run_status",
        "reason",
    ]
    work_order_headers = [
        "organization_id",
        "work_order_id",
        "document_type",
        "file_name",
        "file_url",
        "file_id",
        "mime_type",
        "uploaded_at",
    ]
    ra_bill_headers = [
        "organization_id",
        "ra_bill_id",
        "document_type",
        "file_name",
        "file_url",
        "file_id",
        "mime_type",
        "uploaded_at",
    ]
    invoice_headers = [
        "organization_id",
        "invoice_id",
        "document_type",
        "file_name",
        "file_url",
        "file_id",
        "mime_type",
        "uploaded_at",
    ]
    vendor_headers = [
        "organization_id",
        "vendor_id",
        "document_type",
        "file_name",
        "file_url",
        "file_id",
        "mime_type",
        "uploaded_at",
    ]

    write_csv(report_path, report_rows, report_headers)
    write_csv(errors_path, error_rows, report_headers)
    write_csv(work_order_path, ready["work_order"], work_order_headers)
    write_csv(ra_bill_path, ready["ra_bill"], ra_bill_headers)
    write_csv(invoice_path, ready["invoice"], invoice_headers)
    write_csv(vendor_path, ready["vendor"], vendor_headers)

    counts = count_summary(report_rows, ready, error_rows)
    print("Drive document link dry-run complete")
    print(f"total rows: {counts['total_rows']}")
    print(f"ready work_order files: {counts['ready_work_order_files']}")
    print(f"ready RA Bill files: {counts['ready_ra_bill_files']}")
    print(f"ready invoice files: {counts['ready_invoice_files']}")
    print(f"ready vendor files: {counts['ready_vendor_files']}")
    print(f"ignored non-work-order folders: {counts['ignored_non_work_order_folders']}")
    print(f"unsupported debit note files: {counts['unsupported_debit_note_files']}")
    print(f"unmatched work orders: {counts['unmatched_work_orders']}")
    print(f"unmatched RA Bills: {counts['unmatched_ra_bills']}")
    print(f"unmatched invoices: {counts['unmatched_invoices']}")
    print(f"unmatched vendors: {counts['unmatched_vendors']}")
    print(f"report: {report_path}")
    print(f"errors: {errors_path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
