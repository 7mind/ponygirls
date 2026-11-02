#!/usr/bin/env python3
"""Fail-closed, inventory-bound JVM/static POSIX primitive acceptance receipt."""
import argparse
import hashlib
import json
from pathlib import Path
import re

SUMMARY = re.compile(r"PASS: ([1-9][0-9]*) filesystem contracts; no publish/recovery claim")
REJECTED = re.compile(
    r"^\s*(?:\[\s*)?(?:FAIL(?:ED|URE|URES)?|ERROR(?:S)?|SKIP(?:PED|S)?|IGNORE(?:D)?|ABORT(?:ED)?)\b"
    r"|^\s*(?:Exception in thread|Traceback|AssertionError|FATAL ERROR|WARNING in native method)", re.I)


def inventory(text: str) -> list[str]:
    lines = [line for line in text.splitlines() if line.strip()]
    cases = []
    declared = None
    for index, line in enumerate(lines):
        if REJECTED.search(line):
            raise ValueError(f"failure/skip marker in acceptance log: {line}")
        if not line.startswith('PASS:'):
            continue
        summary = SUMMARY.fullmatch(line)
        if summary:
            if declared is not None or index != len(lines) - 1:
                raise ValueError('summary must occur exactly once, at end of log')
            declared = int(summary[1])
        elif re.search(r'\bfilesystem[\s-]+contracts?\b', line, re.I) or not line.startswith('PASS: ') or not line[6:].strip() or line[6:] != line[6:].strip():
            raise ValueError(f'malformed acceptance summary/case: {line}')
        else:
            cases.append(line[6:])
    if declared is None or declared != len(cases) or len(set(cases)) != len(cases):
        raise ValueError('missing/invalid summary, count mismatch or duplicate acceptance cases')
    return sorted(cases)


def matching_inventory(jvm: str, native: str) -> list[str]:
    jvm_cases, native_cases = inventory(jvm), inventory(native)
    if jvm_cases != native_cases:
        raise ValueError('JVM/native acceptance inventories differ')
    return jvm_cases


def digest(path: Path) -> dict:
    return {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jvm', required=True, type=Path)
    parser.add_argument('--native', required=True, type=Path)
    parser.add_argument('--source', required=True)
    parser.add_argument('--toolchain', required=True)
    parser.add_argument('--artifact', required=True, type=Path, action='append')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    cases = matching_inventory(args.jvm.read_text(), args.native.read_text())
    receipt = {'schemaVersion': 1, 'status': 'passed', 'scope': 'jvm-shared-and-static-musl-posix-primitives',
               'acceptanceSource': args.source, 'validator': digest(Path(__file__).resolve()),
               'toolchain': args.toolchain, 'caseCountPerRuntime': len(cases), 'cases': cases,
               'failed': 0, 'errors': 0, 'skipped': 0,
               'runtimeLogs': {'jvm': digest(args.jvm), 'native': digest(args.native)},
               'artifacts': [digest(path) for path in args.artifact],
               'claimsCompleteServer': False, 'claimsPostgresMigration': False,
               'claimsPublishRecovery': False, 'claimsDeploymentAcceptance': False}
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
