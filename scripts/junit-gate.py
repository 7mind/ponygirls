#!/usr/bin/env python3
"""Gate a test run on its JUnit XML.

Usage: junit-gate.py --counts FILE DIR [DIR...]
Reads every *.xml below each DIR. Exits 1 when a DIR is missing or holds no test case, or when any report holds a
failure, error or skipped element anywhere (or a suite reports one in its attributes); otherwise prints the counts
over all DIRs and writes them to FILE.
"""
import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

OUTCOMES = {"failure": "failures", "error": "errors", "skipped": "skipped"}
EXIT_REJECTED = 1


def owner(element: ET.Element) -> str:
    if element.tag == "testcase":
        return f"{element.get('classname', '')}.{element.get('name', '')}"
    return f"{element.tag} {element.get('name', '')}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--counts", required=True, type=Path)
    parser.add_argument("directories", nargs="+", type=Path)
    arguments = parser.parse_args()
    problems, roots = [], []
    for directory in arguments.directories:
        found = [ET.parse(report).getroot() for report in sorted(directory.rglob("*.xml"))] if directory.is_dir() else []
        if not any(True for root in found for _ in root.iter("testcase")):
            problems.append(f"no test case under {directory}")
        roots += found
    suites = [suite for root in roots for suite in root.iter("testsuite")]
    cases = [case for root in roots for case in root.iter("testcase")]
    # Outcome elements count wherever they appear, including suite-level ones that no case carries.
    rejected = {outcome: [owner(parent) for root in roots for parent in root.iter() for child in parent if child.tag == outcome]
                for outcome in OUTCOMES}
    counts = {"suites": len(suites), "cases": len(cases)} | {key: len(rejected[outcome]) for outcome, key in OUTCOMES.items()}
    print(json.dumps(counts))
    problems += [f"{outcome}: {name}" for outcome, names in rejected.items() for name in names]
    problems += [f"suite reports a failure, error or skip: {suite.get('name', '')}" for suite in suites
                 if any(int(suite.get(key, "0")) > 0 for key in OUTCOMES.values())]
    if problems:
        print("\n".join(["JUnit gate rejected the run:"] + problems), file=sys.stderr)
        return EXIT_REJECTED
    arguments.counts.write_text(json.dumps(counts, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
