#!/usr/bin/env python3
"""Gate a test run on its JUnit XML.

Usage: junit-gate.py DIR [DIR...]
Reads every *.xml below the given directories. Exits 1 when they hold no test case or any failure, error or skipped
element (or a suite reports one in its attributes); otherwise prints the counts and writes them to DIR/counts.json
of the first DIR.
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

OUTCOMES = {"failure": "failures", "error": "errors", "skipped": "skipped"}
EXIT_REJECTED, EXIT_USAGE = 1, 2


def case_name(case: ET.Element) -> str:
    return f"{case.get('classname', '')}.{case.get('name', '')}"


def main(directories: list[str]) -> int:
    if not directories:
        print(__doc__, file=sys.stderr)
        return EXIT_USAGE
    roots = [ET.parse(report).getroot() for directory in directories for report in sorted(Path(directory).rglob("*.xml"))]
    suites = [suite for root in roots for suite in root.iter("testsuite")]
    cases = [case for root in roots for case in root.iter("testcase")]
    rejected = {outcome: [case_name(case) for case in cases if case.find(outcome) is not None] for outcome in OUTCOMES}
    counts = {"suites": len(suites), "cases": len(cases)} | {key: len(rejected[outcome]) for outcome, key in OUTCOMES.items()}
    # A suite can report an outcome (an aborted suite, for example) without a case element carrying it.
    suite_level = [suite.get("name", "") for suite in suites if any(int(suite.get(key, "0")) > 0 for key in OUTCOMES.values())]
    print(json.dumps(counts))
    problems = [f"{outcome}: {name}" for outcome, names in rejected.items() for name in names]
    problems += [f"suite reports a failure, error or skip: {name}" for name in suite_level]
    if not cases:
        problems.append(f"no test case in {len(roots)} JUnit XML files under {' '.join(directories)}")
    if problems:
        print("\n".join(["JUnit gate rejected the run:"] + problems), file=sys.stderr)
        return EXIT_REJECTED
    Path(directories[0], "counts.json").write_text(json.dumps(counts, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
