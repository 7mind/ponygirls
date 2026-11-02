#!/usr/bin/env python3
"""Inventory-bound foundation evidence, not Chronicle or native acceptance."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET

MODULES = {"losslessJson": "shared/lossless-json", "manureStorage": "manure/server"}


def module_counts(base: Path) -> dict:
    inventory = (base / "target/validation-inventory.txt").read_text().splitlines()
    if not inventory or any(not name for name in inventory) or len(set(inventory)) != len(inventory):
        raise ValueError(f"empty or duplicate module inventory: {base}")
    observed = {}
    for report in sorted((base / "target/test-reports").glob("*.xml")):
        suite = ET.parse(report).getroot()
        name = suite.attrib["name"]
        cases = list(suite.iter("testcase"))
        rejected = any(int(suite.attrib.get(key, "0")) != 0 for key in ["failures", "errors", "skipped"])
        rejected |= any(list(suite.iter(tag)) for tag in ["failure", "error", "skipped"])
        if name in observed or not cases or rejected or int(suite.attrib["tests"]) != len(cases):
            raise ValueError(f"incomplete, duplicate, failed or skipped foundation suite: {name}")
        observed[name] = len(cases)
    if set(inventory) != set(observed):
        raise ValueError(f"module inventory/report mismatch: {base}: expected={inventory}, observed={observed}")
    return {"suites": len(observed), "tests": sum(observed.values()), "failed": 0, "errors": 0, "skipped": 0,
            "suiteCounts": observed}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True, type=Path)
    options = parser.parse_args()
    modules = {name: module_counts(Path(base)) for name, base in MODULES.items()}
    evidence = {"schemaVersion": 1, "status": "passed", "scope": "complete-jvm-foundation-modules",
                "foundationSource": options.source, "modules": modules,
                "claimsChronicleValidation": False, "claimsNativeAcceptance": False}
    options.output.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence))


if __name__ == "__main__":
    main()
