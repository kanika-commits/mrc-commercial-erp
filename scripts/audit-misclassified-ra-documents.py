#!/usr/bin/env python3

import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path


OUT_PATH = "reports/document-audit/misclassified_ra_documents.csv"


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


def csv_value(value):
    return "" if value is None else str(value)


def write_csv(path, rows, headers):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({header: csv_value(row.get(header)) for header in headers})


def normalized_doc_number(value):
    raw = str(value or "").strip()
    if re.fullmatch(r"\d+\.0+", raw):
        return raw.split(".")[0]
    return raw


def compact(value):
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


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


def is_ra_document_name(file_name):
    text = str(file_name or "")
    has_work_order_marker = bool(
        re.search(r"\bWO\b", text, re.IGNORECASE)
        or re.search(r"\bWork\s*Order\b", text, re.IGNORECASE)
    )
    has_ra_marker = bool(
        re.search(r"\bRA\s*Bill\b", text, re.IGNORECASE)
        or re.search(r"R\.?\s*A\.?\s*[-_\s]*0*\d+", text, re.IGNORECASE)
        or re.search(r"\bR\.?\s*A\.?\b", text, re.IGNORECASE)
    )
    return has_ra_marker and not has_work_order_marker


def match_ra_bill(ra_bills, file_name):
    extracted = extract_ra_number_from_filename(file_name)
    if not extracted:
        return None

    matches = [
        bill
        for bill in ra_bills
        if normalized_ra_number(bill.get("ra_number")) == extracted
    ]
    return matches[0] if len(matches) == 1 else None


def main():
    load_env()
    work_order_documents = supabase_get(
        "work_order_documents",
        "id,organization_id,work_order_id,file_name,file_url,file_path,uploaded_at",
    )
    work_orders = supabase_get("work_orders", "id,wo_number")
    ra_bills = supabase_get("ra_bills", "id,work_order_id,ra_number")

    work_order_by_id = {row.get("id"): row for row in work_orders}
    ra_bills_by_work_order = defaultdict(list)
    for bill in ra_bills:
        ra_bills_by_work_order[bill.get("work_order_id")].append(bill)

    rows = []
    for document in work_order_documents:
        file_name = document.get("file_name") or ""
        if not is_ra_document_name(file_name):
            continue

        work_order_id = document.get("work_order_id")
        work_order = work_order_by_id.get(work_order_id, {})
        matched_bill = match_ra_bill(ra_bills_by_work_order.get(work_order_id, []), file_name)

        rows.append(
            {
                "work_order_id": work_order_id,
                "work_order_number": work_order.get("wo_number", ""),
                "file_name": file_name,
                "file_url": document.get("file_url", ""),
                "matched_ra_bill_id": matched_bill.get("id", "") if matched_bill else "",
                "matched_ra_number": matched_bill.get("ra_number", "") if matched_bill else "",
            }
        )

    rows.sort(key=lambda row: (row["work_order_number"], row["file_name"]))
    write_csv(
        Path(OUT_PATH).resolve(),
        rows,
        [
            "work_order_id",
            "work_order_number",
            "file_name",
            "file_url",
            "matched_ra_bill_id",
            "matched_ra_number",
        ],
    )
    print(f"suspected misclassified RA documents: {len(rows)}")
    print(f"report: {Path(OUT_PATH).resolve()}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
