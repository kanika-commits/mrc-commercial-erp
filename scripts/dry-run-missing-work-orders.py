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
from pathlib import Path
from xml.etree import ElementTree as ET


DEFAULT_WORKBOOK = "import-data/Final Work Orders - MRC _ GLC _ PI (3).xlsx"
DEFAULT_OUT_DIR = "reports/work-order-vendor-links"
SUMMARY_SHEET = "Summary"
TARGET_WO_NUMBERS = {
    "ESICBDH/MRC/196",
    "IIIT/MRC/169",
    "MRC/WO/R_Jammu/303",
}
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


def normalize_text(value):
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def normalize_code(value):
    return re.sub(r"[^A-Z0-9]+", "", str(value or "").upper())


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


def column_index(cell_ref):
    letters = re.sub(r"[^A-Z]", "", cell_ref.upper())
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
            index = column_index(cell.attrib.get("r", "A1"))
            while len(row) <= index:
                row.append("")
            row[index] = cell_text(cell, shared_strings)
        if any(str(cell).strip() for cell in row):
            rows.append(row)
    return rows


def combined_headers(rows, start_index, end_index):
    width = max(len(row) for row in rows[start_index : end_index + 1])
    headers = []
    for column in range(width):
        parts = []
        for row in rows[start_index : end_index + 1]:
            if column < len(row) and str(row[column]).strip():
                parts.append(normalize_header(row[column]))
        headers.append("_".join(parts))
    return headers


def find_summary_header(rows):
    for start in range(min(10, len(rows))):
        for end in range(start, min(start + 4, len(rows))):
            headers = combined_headers(rows, start, end)
            if any(header.endswith("wo_number") or header == "wo_number" for header in headers):
                return end, headers
    raise RuntimeError("Could not find Summary header row with WO Number.")


def find_column(headers, candidates):
    for index, header in enumerate(headers):
        if header in candidates:
            return index
    for index, header in enumerate(headers):
        if any(candidate in header for candidate in candidates):
            return index
    return -1


def extract_summary_targets(workbook_path):
    with zipfile.ZipFile(workbook_path) as zf:
        shared_strings = read_shared_strings(zf)
        sheet_paths = read_workbook_sheet_paths(zf)
        sheet_path = sheet_paths.get(SUMMARY_SHEET)
        if not sheet_path:
            raise RuntimeError("Summary sheet not found.")
        rows = read_sheet_rows(zf, sheet_path, shared_strings)
        header_row_index, headers = find_summary_header(rows)

    column_map = {
        "status": find_column(headers, {"status"}),
        "site_name": find_column(headers, {"site_name"}),
        "wo_number": find_column(headers, {"wo_number"}),
        "wo_type": find_column(headers, {"wo_type"}),
        "description": find_column(headers, {"description_of_work", "description"}),
        "contractor_name": find_column(headers, {"contractor_name"}),
        "wo_value": find_column(headers, {"wo_basic_value", "basic_value"}),
        "total_wo_value": find_column(headers, {"total_value_of_wo", "total_value"}),
    }

    records = []
    for row_number, row in enumerate(rows[header_row_index + 1 :], start=header_row_index + 2):
        wo_number_index = column_map["wo_number"]
        wo_number = str(row[wo_number_index] if wo_number_index < len(row) else "").strip()
        if wo_number not in TARGET_WO_NUMBERS:
            continue
        record = {"source_sheet": SUMMARY_SHEET, "source_row": row_number}
        for key, index in column_map.items():
            record[key] = str(row[index] if index >= 0 and index < len(row) else "").strip()
        records.append(record)
    return records, column_map


def supabase_get(table, select):
    base_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not base_url or not service_key:
        raise RuntimeError("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")

    params = urllib.parse.urlencode({"select": select})
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
        return json.loads(response.read().decode("utf-8"))


def company_code_from_wo(wo_number):
    parts = str(wo_number or "").split("/")
    if len(parts) >= 2 and parts[1].upper() == "WO":
        return "MRC"
    if len(parts) >= 2:
        return parts[1].upper()
    return ""


def site_code_from_wo(wo_number):
    parts = str(wo_number or "").split("/")
    return parts[0].upper() if parts else ""


def build_indexes(companies, sites):
    companies_by_code = {normalize_code(company.get("company_code")): company for company in companies}
    companies_by_name = {normalize_text(company.get("company_name")): company for company in companies}
    sites_by_code = {normalize_code(site.get("site_code")): site for site in sites}
    sites_by_name = {normalize_text(site.get("site_name")): site for site in sites}
    return companies_by_code, companies_by_name, sites_by_code, sites_by_name


def build_report(records, companies, sites):
    companies_by_code, companies_by_name, sites_by_code, sites_by_name = build_indexes(companies, sites)
    report_rows = []
    sql_rows = []

    for record in records:
        wo_number = record["wo_number"]
        company_code = company_code_from_wo(wo_number)
        site_code = site_code_from_wo(wo_number)
        company = companies_by_code.get(normalize_code(company_code)) or companies_by_name.get(normalize_text(company_code))
        site = sites_by_code.get(normalize_code(site_code)) or sites_by_name.get(normalize_text(record.get("site_name")))
        missing = []
        if not company:
            missing.append("company")
        if not site:
            missing.append("site")

        row = {
            "source_sheet": record["source_sheet"],
            "source_row": record["source_row"],
            "wo_number": wo_number,
            "summary_site_name": record.get("site_name", ""),
            "derived_company_code": company_code,
            "derived_site_code": site_code,
            "matched_company_id": company.get("id", "") if company else "",
            "matched_company_name": company.get("company_name", "") if company else "",
            "matched_company_code": company.get("company_code", "") if company else "",
            "matched_site_id": site.get("id", "") if site else "",
            "matched_site_name": site.get("site_name", "") if site else "",
            "matched_site_code": site.get("site_code", "") if site else "",
            "organization_id": company.get("organization_id", "") if company else "",
            "company_id": company.get("id", "") if company else "",
            "site_id": site.get("id", "") if site else "",
            "wo_date": "",
            "wo_type": record.get("wo_type", ""),
            "description": record.get("description", ""),
            "wo_value": record.get("wo_value", "") or record.get("total_wo_value", ""),
            "status": record.get("status", ""),
            "approval_status": "Approved",
            "contractor_name": record.get("contractor_name", ""),
            "match_status": "ready" if not missing else "missing_" + "_".join(missing),
            "reason": "" if not missing else "Missing " + " and ".join(missing) + " match.",
        }
        report_rows.append(row)
        if not missing:
            sql_rows.append(
                {
                    "organization_id": row["organization_id"],
                    "company_id": row["company_id"],
                    "site_id": row["site_id"],
                    "wo_number": row["wo_number"],
                    "wo_date": row["wo_date"],
                    "wo_type": row["wo_type"],
                    "description": row["description"],
                    "wo_value": row["wo_value"],
                    "status": row["status"],
                    "approval_status": row["approval_status"],
                    "contractor_name": row["contractor_name"],
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


def parse_args():
    parser = argparse.ArgumentParser(description="Dry-run missing Work Order rows from Summary sheet.")
    parser.add_argument("--source", default=DEFAULT_WORKBOOK, help="Path to source workbook.")
    parser.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="Report output directory.")
    return parser.parse_args()


def main():
    args = parse_args()
    load_env()

    workbook_path = Path(args.source).resolve()
    if not workbook_path.exists():
        raise FileNotFoundError(f"Workbook not found: {workbook_path}")

    records, column_map = extract_summary_targets(workbook_path)
    companies = supabase_get("companies", "id,organization_id,company_name,company_code,status")
    sites = supabase_get("sites", "id,site_name,site_code,status")
    report_rows, sql_rows = build_report(records, companies, sites)

    out_dir = Path(args.out_dir).resolve()
    report_path = out_dir / "missing_work_orders_dry_run_report.csv"
    sql_path = out_dir / "missing_work_orders_sql_ready.csv"
    report_headers = [
        "source_sheet",
        "source_row",
        "wo_number",
        "summary_site_name",
        "derived_company_code",
        "derived_site_code",
        "matched_company_id",
        "matched_company_name",
        "matched_company_code",
        "matched_site_id",
        "matched_site_name",
        "matched_site_code",
        "organization_id",
        "company_id",
        "site_id",
        "wo_date",
        "wo_type",
        "description",
        "wo_value",
        "status",
        "approval_status",
        "contractor_name",
        "match_status",
        "reason",
    ]
    sql_headers = [
        "organization_id",
        "company_id",
        "site_id",
        "wo_number",
        "wo_date",
        "wo_type",
        "description",
        "wo_value",
        "status",
        "approval_status",
        "contractor_name",
    ]
    write_csv(report_path, report_rows, report_headers)
    write_csv(sql_path, sql_rows, sql_headers)

    summary = {
        "workbook": str(workbook_path),
        "target_wo_numbers": sorted(TARGET_WO_NUMBERS),
        "summary_rows_found": len(records),
        "ready_rows": len(sql_rows),
        "missing_company_or_site": len(report_rows) - len(sql_rows),
        "column_map": column_map,
        "report_csv": str(report_path),
        "sql_ready_csv": str(sql_path),
    }
    print(json.dumps(summary, indent=2))
    print("Dry-run only. No Work Orders inserted.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
