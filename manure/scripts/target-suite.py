#!/usr/bin/env python3
"""Manure target suite: discover every test, run it, fail on anything but a pass.

Without test names the run is full: every Python ``test_*.py`` module and every
Node ``*.test.mjs`` suite under manure/tests. A full run is split into shards by
TestCase class (class fixtures are per class) and Node file, each shard a worker
process with its own report directory: ``--shards N`` (default: build cores or
CPUs, at most 8; 1 = one serial process), or ``--shard i/n`` to run one shard.
Test names select a diagnostic subset of Python cases. Any failure, error, skip,
expected failure or unexpected success, an empty run and an empty shard exit
non-zero.
No PostgreSQL provisioning happens here: the calling runner (test-target.sh or
the manure-native check) supplies the owned provider and target executable.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / 'manure/tests'
NODE_TIMEOUT_SECONDS = 120
TAP_COUNTS = re.compile(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', re.MULTILINE)
TAP_TOP_LEVEL = re.compile(r'^# Subtest: (.+)$', re.MULTILINE)
SHARD = re.compile(r'([1-9][0-9]*)/([1-9][0-9]*)')
MAX_DEFAULT_SHARDS = 8
NODE_UNIT = 'node:'
# Shard plan from per-class wall times of a serial native run (U20, load ~150 on
# 128 CPUs). An isolated class is longer than an even share of the run and gets a
# shard of its own while there are more shards than isolated classes.
ISOLATED_CLASSES = ('test_browser_viewers.ViewerBrowserTests',)  # ~134 s
# The next heaviest open the round-robin over the remaining shards, so they land apart.
SPREAD_CLASSES = ('test_browser_dashboard_ux.DashboardUXTests',  # ~77 s
                  'test_target_durability.TargetDurabilityTests',  # ~57 s
                  'test_browser_access_modes.DashboardAccessModeTests',  # ~42 s
                  'test_target_search.TargetSearchTests',  # ~35 s
                  'test_client_realserver.TestRealServer',  # ~35 s
                  'test_browser_dashboard.DashboardSiblingCase',  # ~32 s
                  'test_browser_dashboard.DashboardSeparateCase')  # ~29 s
FAILURE_COUNTS = ('failures', 'errors', 'skipped', 'expectedFailures', 'unexpectedSuccesses')

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


def test_class(test):
    return type(test).__module__ + '.' + type(test).__qualname__


def shard_plan(units, count):
    """Partitions the units (TestCase classes and Node files) into `count` shards."""
    named = ISOLATED_CLASSES + SPREAD_CLASSES
    if missing := [unit for unit in named if unit not in units]:
        raise ConfigurationError('shard plan names undiscovered test classes: ' + ', '.join(missing))
    isolated = ISOLATED_CLASSES[:count - 1]
    rotation = ([unit for unit in ISOLATED_CLASSES if unit not in isolated] + list(SPREAD_CLASSES)
                + sorted(unit for unit in units if unit not in named))
    shards = [[unit] for unit in isolated] + [[] for _ in range(count - len(isolated))]
    for index, unit in enumerate(rotation):
        shards[len(isolated) + index % (count - len(isolated))].append(unit)
    if sorted(unit for shard in shards for unit in shard) != sorted(units):
        raise ConfigurationError('shard plan does not partition the discovered tests')
    if count <= len(units) and not all(shards):
        raise ConfigurationError('shard plan leaves a shard empty')
    return shards


def passed(counts):
    return counts['cases'] > 0 and all(counts[key] == 0 for key in FAILURE_COUNTS)


def run_shards(report, count):
    """Runs every shard as its own worker process, then sums and checks the shard counts."""
    def run(index):
        directory = report / f'shard-{index}'
        directory.mkdir()
        argv = [sys.executable, str(Path(__file__).resolve()), '--report', str(directory), '--shard', f'{index}/{count}']
        started = time.monotonic()
        with (directory / 'run.log').open('w') as log:
            status = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT).returncode
        return status, time.monotonic() - started
    with ThreadPoolExecutor(max_workers=count) as pool:
        outcomes = list(pool.map(run, range(1, count + 1)))
    totals = dict.fromkeys(('suites', 'cases') + FAILURE_COUNTS, 0)
    clean = True
    for index, (status, seconds) in enumerate(outcomes, start=1):
        directory = report / f'shard-{index}'
        path = directory / 'counts.json'
        counts = json.loads(path.read_text()) if path.is_file() else None
        if counts is not None:
            for key in totals:
                totals[key] += counts[key]
        shard_clean = status == 0 and counts is not None and all(counts[key] == 0 for key in FAILURE_COUNTS)
        clean = clean and shard_clean
        if not shard_clean:
            print(f'--- shard {index}/{count} log ({directory / "run.log"})\n' + (directory / 'run.log').read_text(), flush=True)
        print(f'shard {index}/{count}: exit {status} in {seconds:.1f} s, ' + (json.dumps(counts, sort_keys=True) if counts is not None else 'no counts'), flush=True)
    (report / 'counts.json').write_text(json.dumps(totals, indent=2) + '\n')
    print('total: ' + json.dumps(totals, sort_keys=True))
    return 0 if clean and passed(totals) else 1


def default_shard_count():
    cores = int(os.environ.get('NIX_BUILD_CORES') or 0) or len(os.sched_getaffinity(0))
    return min(MAX_DEFAULT_SHARDS, cores)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--report', required=True, help='fresh directory for counts and logs')
    selection = parser.add_mutually_exclusive_group()
    selection.add_argument('--shards', type=int, help='worker processes for a full run (1: one serial process)')
    selection.add_argument('--shard', help='run shard i/n of a full run in this process')
    parser.add_argument('tests', nargs='*', help='diagnostic Python selection (module, class or case); default: full run')
    args = parser.parse_args(argv)
    full = not args.tests
    if not full and (args.shards is not None or args.shard is not None):
        raise ConfigurationError('test names select a diagnostic subset; they cannot be sharded')
    shard = SHARD.fullmatch(args.shard) if args.shard is not None else None
    if args.shard is not None and (shard is None or int(shard[1]) > int(shard[2])):
        raise ConfigurationError('--shard requires i/n with 1 <= i <= n')
    report = Path(args.report).resolve()
    report.mkdir(parents=True, exist_ok=True)
    if (report / 'counts.json').exists():
        raise ConfigurationError('report contains a previous run; choose a fresh directory')
    shards = args.shards if args.shards is not None else default_shard_count()
    if full and shard is None and shards != 1:
        if shards < 1:
            raise ConfigurationError('--shards requires a positive count')
        if errors := full_run_prerequisite_errors():
            raise ConfigurationError('; '.join(errors))
        return run_shards(report, shards)
    hermetic_environment(report, full)
    if full and (errors := full_run_prerequisite_errors()):
        raise ConfigurationError('; '.join(errors))
    loader = unittest.TestLoader()
    suite = (loader.discover(str(TESTS), pattern='test_*.py', top_level_dir=str(TESTS)) if full
             else loader.loadTestsFromNames(args.tests))
    if loader.errors:
        raise ConfigurationError('test discovery failed:\n' + '\n'.join(loader.errors))
    tests = list(iterate(suite))
    node_suites = sorted(TESTS.rglob('*.test.mjs')) if full else []
    selected = None
    if shard is not None:
        units = sorted({test_class(test) for test in tests} | {NODE_UNIT + str(path.relative_to(TESTS)) for path in node_suites})
        selected = set(shard_plan(units, int(shard[2]))[int(shard[1]) - 1])
        print(f'shard {shard[0]}: ' + ' '.join(sorted(selected)), flush=True)
        tests = [test for test in tests if test_class(test) in selected]
        node_suites = [path for path in node_suites if NODE_UNIT + str(path.relative_to(TESTS)) in selected]
    result = unittest.TextTestRunner(verbosity=2, stream=sys.stdout).run(unittest.TestSuite(tests))
    counts = {'suites': len({test_class(test) for test in tests}),
              'cases': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
              'skipped': len(result.skipped), 'expectedFailures': len(result.expectedFailures),
              'unexpectedSuccesses': len(result.unexpectedSuccesses)}
    for path in node_suites:
        cases, failed = run_node_suite(path, report)
        counts['suites'] += 1
        counts['cases'] += cases
        counts['failures'] += failed
    (report / 'counts.json').write_text(json.dumps(counts, indent=2) + '\n')
    print(json.dumps(counts, sort_keys=True))
    # shard_plan already refused an empty shard unless there are more shards than units.
    return 0 if passed(counts) or selected == set() else 1


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
