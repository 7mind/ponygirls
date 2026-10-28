#!/usr/bin/env python3
"""Turn one complete unfiltered test run into fail-closed source validation evidence."""
import argparse
import json
from pathlib import Path
import xml.etree.ElementTree as ET


def report(inventory: Path, reports: Path, runtime_source: str, test_source: str) -> dict:
    expected = inventory.read_text().splitlines()
    if not expected or len(set(expected)) != len(expected):
        raise ValueError('empty or duplicate discovered test inventory')
    observed = {}
    for path in sorted(reports.glob('*.xml')):
        suite = ET.parse(path).getroot()
        name = suite.attrib['name']
        cases = list(suite.iter('testcase'))
        rejected = sum(int(suite.attrib.get(key, '0')) for key in ['failures', 'errors', 'skipped'])
        rejected += sum(len(list(suite.iter(tag))) for tag in ['failure', 'error', 'skipped'])
        if name in observed or not cases or rejected or int(suite.attrib['tests']) != len(cases):
            raise ValueError(f'incomplete, duplicate, failed or skipped test suite: {name}')
        observed[name] = len(cases)
    if set(expected) != set(observed):
        raise ValueError(f'discovered/reported test coverage mismatch: missing={set(expected)-set(observed)}, extra={set(observed)-set(expected)}')
    return {'schemaVersion': 1, 'status': 'passed', 'scope': 'full-unfiltered-postgres-protocol-concurrency',
            'runtimeSource': runtime_source, 'testSource': test_source,
            'tests': sum(observed.values()), 'suites': len(observed), 'failed': 0, 'errors': 0, 'skipped': 0,
            'suiteCounts': observed}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['inventory', 'reports', 'output']:
        parser.add_argument('--'+key, type=Path, required=True)
    for key in ['runtime-source', 'test-source']:
        parser.add_argument('--'+key, required=True)
    options = parser.parse_args()
    value = report(options.inventory, options.reports, options.runtime_source, options.test_source)
    options.output.write_text(json.dumps(value, indent=2)+'\n')
    print(f"FULL_VALIDATION tests={value['tests']} suites={value['suites']} failed=0 errors=0 skipped=0")


if __name__ == '__main__':
    main()
