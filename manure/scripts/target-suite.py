#!/usr/bin/env python3
"""Manure target suite: discover every test, run it, fail on anything but a pass.

Without test names the run is full: every Python ``test_*.py`` module and every
Node ``*.test.mjs`` suite under manure/tests.
Test names select a diagnostic subset of Python cases. Any failure, error, skip,
expected failure or unexpected success, and an empty run, exit non-zero.
No PostgreSQL provisioning happens here: the calling runner (test-target.sh or
the manure-native check) supplies the owned provider and target executable.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / 'manure/tests'
NODE_TIMEOUT_SECONDS = 120
TAP_COUNTS = re.compile(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', re.MULTILINE)
TAP_TOP_LEVEL = re.compile(r'^# Subtest: (.+)$', re.MULTILINE)

# Preserve explicit tool/test-provider inputs, not ambient client/model/PG/proxy
# settings. A fresh HOME prevents libpq default ~/.pgpass or SDK config reads.
TOOL_ENV = {'PATH', 'PYTHONPATH', 'JAVA_HOME', 'POSTGRES_HOME',
    'MANURE_TEST_PROVISION_COMMAND', 'PONYGIRLS_OWNED_FIXTURE_ROOT', 'PONYGIRLS_TEST_PROVISION_SERVICE', 'PG_PROVIDER',
    'MANURE_TEST_SERVER_COMMAND_JSON', 'MANURE_TEST_ALLOW_CREATEDB', 'MANURE_TEST_JDBC_URL',
    'MANURE_TEST_JDBC_USER', 'MANURE_TEST_JDBC_PASSWORD_FILE', 'MANURE_POSIX_LIBRARY',
    'MANURE_PLAYWRIGHT_CORE_PATH', 'MANURE_CHROMIUM_BIN', 'MANURE_OPENSSL_BIN',
    'MANURE_MCP_SDK_PATH', 'MANURE_FIREFOX_BIN', 'MANURE_UX_ARTIFACTS',
    'MANURE_TEST_VIEWER_DIR', 'MANURE_VIEWER_ARTIFACTS', 'FONTCONFIG_FILE', 'FONTCONFIG_PATH',
    'LANG', 'LC_ALL', 'TZ', 'TMPDIR'}
# A full run provisions only through the least-privilege helper, never an admin URL.
ADMIN_DATABASE_ENV = ('MANURE_TEST_JDBC_URL', 'MANURE_TEST_JDBC_USER', 'MANURE_TEST_JDBC_PASSWORD_FILE',
    'MANURE_TEST_ALLOW_CREATEDB')


class ConfigurationError(ValueError):
    pass


def hermetic_environment(report, full):
    retained = {key: value for key, value in os.environ.items() if key in TOOL_ENV}
    if full:
        for key in ADMIN_DATABASE_ENV:
            retained.pop(key, None)
    home = report / 'runtime-home'
    home.mkdir(mode=0o700)
    retained.update(HOME=str(home), XDG_CONFIG_HOME=str(home / 'config'),
        XDG_CACHE_HOME=str(home / 'cache'), XDG_DATA_HOME=str(home / 'data'),
        PYTHONPATH=os.pathsep.join([str(ROOT / 'manure'), str(TESTS)] + ([retained['PYTHONPATH']] if retained.get('PYTHONPATH') else [])),
        LANG='C.UTF-8', LC_ALL='C.UTF-8', TZ='UTC')
    os.environ.clear()
    os.environ.update(retained)
    sys.path[:0] = [str(ROOT / 'manure'), str(TESTS)]


def full_run_prerequisite_errors():
    errors = []
    def executable(value):
        return bool(value and Path(value).is_absolute() and Path(value).is_file() and os.access(value, os.X_OK))
    def package(variable, name):
        value = os.environ.get(variable, '')
        try:
            if not Path(value).is_absolute() or json.loads((Path(value) / 'package.json').read_text()).get('name') != name:
                raise ValueError()
        except (OSError, ValueError):
            errors.append('required package: ' + variable)
    try:
        command = json.loads(os.environ.get('MANURE_TEST_SERVER_COMMAND_JSON', 'null'))
        if not isinstance(command, list) or not command or not all(isinstance(v, str) and v for v in command):
            raise ValueError()
    except ValueError:
        errors.append('required argv: MANURE_TEST_SERVER_COMMAND_JSON')
    if not executable(os.environ.get('MANURE_TEST_PROVISION_COMMAND')):
        errors.append('required absolute executable: MANURE_TEST_PROVISION_COMMAND')
    fixture_root = os.environ.get('PONYGIRLS_OWNED_FIXTURE_ROOT', '')
    if not Path(fixture_root).is_absolute() or not (Path(fixture_root) / 'provider.json').is_file():
        errors.append('required owned marker: PONYGIRLS_OWNED_FIXTURE_ROOT/provider.json')
    if os.environ.get('PONYGIRLS_TEST_PROVISION_SERVICE') != 'manure':
        errors.append('required service binding: PONYGIRLS_TEST_PROVISION_SERVICE=manure')
    provider = os.environ.get('PG_PROVIDER', '')
    if not Path(provider).is_absolute() or not Path(provider).is_file():
        errors.append('required absolute trusted code path: PG_PROVIDER')
    package('MANURE_PLAYWRIGHT_CORE_PATH', 'playwright-core')
    package('MANURE_MCP_SDK_PATH', '@modelcontextprotocol/sdk')
    if not executable(os.environ.get('MANURE_CHROMIUM_BIN')):
        errors.append('required pinned executable: MANURE_CHROMIUM_BIN')
    for command in ('psql', 'node', 'openssl'):
        if not shutil.which(command):
            errors.append('required command: ' + command)
    return errors


def run_node_suite(path, report):
    """Runs one Node test file; returns (cases, failed cases)."""
    suite = str(path.relative_to(ROOT))
    argv = ['node', '--test', '--test-reporter=tap', suite]
    try:
        process = subprocess.run(argv, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 text=True, timeout=NODE_TIMEOUT_SECONDS)
        output, status = process.stdout, process.returncode
    except subprocess.TimeoutExpired as timeout:
        output, status = (timeout.stdout or b'').decode(errors='replace'), None
    (report / ('node-' + path.name.removesuffix('.test.mjs') + '.log')).write_text(output)
    print(f'--- {" ".join(argv)} (exit {status})\n{output}', flush=True)
    counts = {key: int(value) for key, value in TAP_COUNTS.findall(output)}
    # Node reports a file that declares no test as one passing test named after the file.
    declares_tests = suite not in TAP_TOP_LEVEL.findall(output)
    cases = counts.get('tests', 0) if declares_tests else 0
    clean = status == 0 and cases > 0 and counts.get('pass') == cases and not any(
        counts.get(key) for key in ('fail', 'cancelled', 'skipped', 'todo'))
    return cases, 0 if clean else max(1, cases - counts.get('pass', 0))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--report', required=True, help='fresh directory for counts and logs')
    parser.add_argument('tests', nargs='*', help='diagnostic Python selection (module, class or case); default: full run')
    args = parser.parse_args(argv)
    full = not args.tests
    report = Path(args.report).resolve()
    report.mkdir(parents=True, exist_ok=True)
    if (report / 'counts.json').exists():
        raise ConfigurationError('report contains a previous run; choose a fresh directory')
    hermetic_environment(report, full)
    if full and (errors := full_run_prerequisite_errors()):
        raise ConfigurationError('; '.join(errors))
    loader = unittest.TestLoader()
    suite = (loader.discover(str(TESTS), pattern='test_*.py', top_level_dir=str(TESTS)) if full
             else loader.loadTestsFromNames(args.tests))
    if loader.errors:
        raise ConfigurationError('test discovery failed:\n' + '\n'.join(loader.errors))
    modules = len({test.id().split('.')[0] for test in iterate(suite)})
    result = unittest.TextTestRunner(verbosity=2, stream=sys.stdout).run(suite)
    counts = {'suites': modules,
              'cases': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
              'skipped': len(result.skipped), 'expectedFailures': len(result.expectedFailures),
              'unexpectedSuccesses': len(result.unexpectedSuccesses)}
    if full:
        for path in sorted(TESTS.rglob('*.test.mjs')):
            cases, failed = run_node_suite(path, report)
            counts['suites'] += 1
            counts['cases'] += cases
            counts['failures'] += failed
    (report / 'counts.json').write_text(json.dumps(counts, indent=2) + '\n')
    print(json.dumps(counts, sort_keys=True))
    passed = result.testsRun > 0 and all(value == 0 for key, value in counts.items() if key not in ('suites', 'cases'))
    return 0 if passed else 1


def iterate(suite):
    for child in suite:
        if isinstance(child, unittest.TestSuite):
            yield from iterate(child)
        else:
            yield child


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ConfigurationError, OSError) as error:
        print('manure target suite refused: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
