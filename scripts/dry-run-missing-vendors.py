#!/usr/bin/env python3

import argparse
import csv
import re
import sys
from pathlib import Path


DEFAULT_SOURCE = "reports/work-order-vendor-links/work_order_vendor_link_report.csv"
DEFAULT_OUTPUT = "reports/work-order-vendor-links/missing_vendors_to_create.csv"


def normalize_name(value):
    text = str(value or "").lower().replace("&", " and ")
    text = re.sub(r"\b(pvt|private)\b", "private", text)
    text = re.sub(r"\b(ltd|limited)\b", "limited", text)
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return re.sub(r"\s+", " ", text)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Create a dry-run CSV of missing vendors from the WO/vendor link report."
    )
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="Path to work_order_vendor_link_report.csv")
    parser.add_argument("--out", default=DEFAULT_OUTPUT, help="Path for missing_vendors_to_create.csv")
    return parser.parse_args()


def main():
    args = parse_args()
    source = Path(args.source).resolve()
    output = Path(args.out).resolve()

    if not source.exists():
        raise FileNotFoundError(f"Source report not found: {source}")

    missing_by_name = {}

    with source.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            if str(row.get("status", "")).strip() != "unmatched_vendor":
                continue
            vendor_name = str(row.get("contractor_name", "")).strip()
            organization_id = str(row.get("organization_id", "")).strip()
            key = normalize_name(vendor_name)

            if not vendor_name or not organization_id or not key:
                continue

            if key not in missing_by_name:
                missing_by_name[key] = {
                    "organization_id": organization_id,
                    "vendor_name": vendor_name,
                    "vendor_type": "Contractor",
                    "status": "active",
                }

    rows = sorted(missing_by_name.values(), key=lambda row: row["vendor_name"].lower())
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["organization_id", "vendor_name", "vendor_type", "status"],
        )
        writer.writeheader()
        writer.writerows(rows)

    print(f"Missing vendors to create: {len(rows)}")
    for row in rows:
        print(f"- {row['vendor_name']}")
    print(f"Wrote {output}")
    print("Dry-run only. No vendors inserted.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
