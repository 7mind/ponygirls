#!/usr/bin/env python3
"""Summarize complete full runs or explicitly selected fast runs without conflating their scope."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET


def inventory_names(inventory: Path) -> list[str]:
    names = inventory.read_text().splitlines()
    if not names or any(not name for name in names) or len(set(names)) != len(names):
        raise ValueError('empty or duplicate test inventory')
    return names


def observed_suites(reports: Path) -> dict:
    observed = {}
    for path in sorted(reports.glob('*.xml')):
        suite = ET.parse(path).getroot()
        name = suite.attrib['name']
        cases = list(suite.iter('testcase'))
        rejected = any(int(suite.attrib.get(key, '0')) != 0 for key in ['failures', 'errors', 'skipped'])
        rejected |= any(list(suite.iter(tag)) for tag in ['failure', 'error', 'skipped'])
        if name in observed or not cases or rejected or int(suite.attrib['tests']) != len(cases):
            raise ValueError(f'incomplete, duplicate, failed or skipped test suite: {name}')
        observed[name] = len(cases)
    return observed


def checked_counts(expected: list[str], observed: dict) -> dict:
    if set(expected) != set(observed):
        raise ValueError(f'discovered/selected/reported test coverage mismatch: missing={set(expected)-set(observed)}, extra={set(observed)-set(expected)}')
    return {'tests': sum(observed.values()), 'suites': len(observed), 'failed': 0, 'errors': 0, 'skipped': 0,
            'suiteCounts': observed}


def report(inventory: Path, reports: Path, runtime_source: str, test_source: str) -> dict:
    counts = checked_counts(inventory_names(inventory), observed_suites(reports))
    return {'schemaVersion': 1, 'status': 'passed', 'scope': 'full-unfiltered-postgres-protocol-concurrency',
            'runtimeSource': runtime_source, 'testSource': test_source, **counts}


def fast_report(inventory: Path, reports: Path, runtime_source: str, test_source: str, selected_suites: Path) -> dict:
    discovered = inventory_names(inventory)
    selected = inventory_names(selected_suites)
    if not set(selected) <= set(discovered):
        raise ValueError(f'unknown selected test suites: {set(selected)-set(discovered)}')
    counts = checked_counts(selected, observed_suites(reports))
    return {'schemaVersion': 2, 'status': 'passed', 'scope': 'fast-explicit-suite-subset',
            'runtimeSource': runtime_source, 'testSource': test_source,
            'selectedSuites': selected, 'discoveredSuites': len(discovered), **counts}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['inventory', 'reports', 'output']:
        parser.add_argument('--'+key, type=Path, required=True)
    for key in ['runtime-source', 'test-source']:
        parser.add_argument('--'+key, required=True)
    parser.add_argument('--selected-suites', type=Path, help='explicit fast subset; never a full-run claim')
    options = parser.parse_args()
    arguments = (options.inventory, options.reports, options.runtime_source, options.test_source)
    value = report(*arguments) if options.selected_suites is None else fast_report(*arguments, options.selected_suites)
    options.output.write_text(json.dumps(value, indent=2)+'\n')
    label = 'FULL_VALIDATION' if options.selected_suites is None else 'FAST_SUBSET_VALIDATION'
    print(f"{label} tests={value['tests']} suites={value['suites']} failed=0 errors=0 skipped=0")


if __name__ == '__main__':
    main()
