#!/usr/bin/env python3
"""Declared CURRENT test gate. Core/focused are diagnostics, never acceptance.

No PG/JNI provisioning occurs here. The owning runner supplies its disposable
provider/target executable. Full verifies every current module and exact case ID,
executes all Python + Node/codec checks, and refuses skips or invariant gaps.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import traceback
import unittest

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = Path('manure/tests/current-test-inventory.json')
LEGACY_IMPLEMENTATION_MODULES = {'test_catalogue','test_server_http_opt_in','test_server_lifecycle',
    'test_server_limits','test_server_path_mode','test_server_security','test_storage_durability'}


class InventoryError(ValueError):
    pass


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise InventoryError('duplicate inventory key: ' + key)
        result[key] = value
    return result


def read_registry(root=ROOT):
    return json.loads((root / REGISTRY).read_text(), object_pairs_hook=_unique_object)


def python_modules(root):
    directory = root / 'manure/tests'
    return {'.'.join(path.relative_to(directory).with_suffix('').parts): path
            for path in directory.rglob('test_*.py') if '__pycache__' not in path.parts}


def validate_registration(root, registry):
    if registry.get('schemaVersion') != 1 or registry.get('contract') != 'manure.api/1.0.0':
        raise InventoryError('unsupported inventory schema/current contract')
    entries = registry.get('pythonModules', [])
    names = [entry['module'] for entry in entries]
    if not names or len(names) != len(set(names)):
        raise InventoryError('empty or duplicate module registration')
    actual = python_modules(root)
    unknown, missing = sorted(set(actual) - set(names)), sorted(set(names) - set(actual))
    if unknown or missing:
        raise InventoryError(f'unregistered test modules={unknown}; missing registered modules={missing}')
    for entry in entries:
        if entry.get('classification') not in ('current', 'architecture-retired'):
            raise InventoryError('unknown module classification: ' + entry['module'])
        if str(actual[entry['module']].relative_to(root)) != entry.get('path'):
            raise InventoryError('module path mismatch: ' + entry['module'])
        if entry['classification'] == 'architecture-retired':
            if (entry.get('requirementsRetained') is not True or not entry.get('invariantGroups')
                    or not entry.get('retirementReason')):
                raise InventoryError('retired implementation must retain mapped requirements: ' + entry['module'])
            if entry['module'] not in LEGACY_IMPLEMENTATION_MODULES:
                raise InventoryError('CURRENT/new test module cannot be architecture-retired: ' + entry['module'])
        elif not entry.get('tests'):
            raise InventoryError('current module has no declared tests: ' + entry['module'])
    actual_node = {str(path.relative_to(root)) for path in (root/'manure/tests').rglob('*.test.mjs')}
    declared_node = [entry['path'] for entry in registry.get('nodeSuites', [])]
    if len(declared_node) != len(set(declared_node)) or set(declared_node) != actual_node:
        raise InventoryError('unregistered Node suites=' + str(sorted(actual_node-set(declared_node))) +
                             '; missing Node suites=' + str(sorted(set(declared_node)-actual_node)))
    for entry in registry.get('nodeSuites', []):
        if not entry.get('tests') or len(entry['tests']) != len(set(entry['tests'])):
            raise InventoryError('empty or duplicate Node case registration: ' + entry['id'])
    return entries


def case_ids(suite):
    if isinstance(suite, unittest.TestSuite):
        for child in suite:
            yield from case_ids(child)
    else:
        yield suite.id()


def validate_declared_ids(module, expected, discovered):
    if not expected or len(expected) != len(set(expected)) or len(discovered) != len(set(discovered)):
        raise InventoryError('empty or duplicate case inventory: ' + module)
    if sorted(expected) != sorted(discovered):
        raise InventoryError('declared case mismatch for ' + module + ': undeclared=' +
            str(sorted(set(discovered) - set(expected))) + '; missing=' + str(sorted(set(expected) - set(discovered))))


def discover_current(root, registry):
    entries = validate_registration(root, registry)
    sys.path[:0] = [str(root / 'manure'), str(root / 'manure/tests')]
    found = {}
    for entry in entries:
        if entry['classification'] != 'current':
            continue
        try:
            module = importlib.import_module(entry['module'])
        except Exception as error:
            raise InventoryError('current test import failed: ' + entry['module'] + ' (' + type(error).__name__ + ')') from error
        if Path(module.__file__).resolve() != (root / entry['path']).resolve():
            raise InventoryError('test import resolved outside declared source: ' + entry['module'])
        loader = unittest.TestLoader()
        suite = loader.loadTestsFromModule(module)
        if loader.errors:
            raise InventoryError('test discovery error: ' + entry['module'])
        ids = list(case_ids(suite))
        validate_declared_ids(entry['module'], entry['tests'], ids)
        found[entry['module']] = ids
    return found


def validate_mappings(root, registry, discovered):
    groups = registry.get('invariantGroups', [])
    identifiers = [group['id'] for group in groups]
    if not groups or len(identifiers) != len(set(identifiers)):
        raise InventoryError('empty or duplicate invariant groups')
    all_tests = {case for values in discovered.values() for case in values}
    gaps = []
    for group in groups:
        if not group.get('invariant') or not group.get('sourceRefs') or not group.get('targetRefs'):
            raise InventoryError('invariant lacks concrete source/target mapping: ' + group['id'])
        for ref in group['sourceRefs'] + group['targetRefs']:
            path = root / ref['path']
            if not path.is_file():
                raise InventoryError('missing mapped source: ' + ref['path'])
            if ref.get('testId') and ref['testId'] not in all_tests:
                raise InventoryError('mapped Python test is not current: ' + ref['testId'])
            if ref.get('marker') and ref['marker'] not in path.read_text():
                raise InventoryError('mapped test/symbol missing: ' + ref['path'] + ' :: ' + ref['marker'])
        for detail in group.get('openGaps', []):
            gaps.append({'group': group['id'], 'detail': detail})
    for entry in registry['pythonModules']:
        for identifier in entry.get('invariantGroups', []):
            if identifier not in identifiers:
                raise InventoryError('unmapped invariant group in ' + entry['module'])
    return gaps


def select_tests(registry, discovered, scope, focused=None):
    current = set(discovered)
    if scope == 'full':
        names = [entry['module'] for entry in registry['pythonModules'] if entry['classification'] == 'current']
    elif scope == 'core':
        names = registry['diagnosticCoreModules']
    else:
        names = focused
        if not isinstance(names, list) or not names or not all(isinstance(name, str) and re.fullmatch(r'test_[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+){0,2}', name) for name in names):
            raise InventoryError('focused diagnostic requires an explicit nonempty test-name array')
    selected = []
    for name in names:
        module = name.split('.')[0]
        if module not in current:
            raise InventoryError('selection is not a CURRENT test module: ' + name)
        matches = [case for case in discovered[module] if case == name or case.startswith(name + '.')]
        if not matches:
            raise InventoryError('selection has no declared current cases: ' + name)
        selected.extend(matches)
    if not selected or len(selected) != len(set(selected)):
        raise InventoryError('empty or duplicate selected case inventory')
    if scope == 'full' and sorted(selected) != sorted(case for values in discovered.values() for case in values):
        raise InventoryError('full selection omitted current tests')
    return names, selected


# Preserve explicit tool/test-provider inputs, not ambient client/model/PG/proxy
# settings. A fresh HOME prevents libpq default ~/.pgpass or SDK config reads.
TOOL_ENV = {'PATH', 'PYTHONPATH', 'JAVA_HOME', 'POSTGRES_HOME', 'MANURE_TEST_PG_BIN',
    'MANURE_TEST_PROVISION_COMMAND', 'PONYGIRLS_OWNED_FIXTURE_ROOT', 'PONYGIRLS_TEST_PROVISION_SERVICE', 'PG_PROVIDER',
    'MANURE_TEST_SERVER_COMMAND_JSON', 'MANURE_TEST_ALLOW_CREATEDB', 'MANURE_TEST_JDBC_URL',
    'MANURE_TEST_JDBC_USER', 'MANURE_TEST_JDBC_PASSWORD_FILE', 'MANURE_POSIX_LIBRARY',
    'MANURE_PLAYWRIGHT_CORE_PATH', 'MANURE_CHROMIUM_BIN', 'MANURE_OPENSSL_BIN',
    'MANURE_MCP_SDK_PATH', 'MANURE_FIREFOX_BIN', 'MANURE_UX_ARTIFACTS', 'MANURE_BASELINE_CLIENT',
    'MANURE_TEST_VIEWER_DIR', 'MANURE_VIEWER_ARTIFACTS',
    'MANURE_TARGET_DIAGNOSTIC_TESTS_JSON', 'FONTCONFIG_FILE', 'FONTCONFIG_PATH',
    'LANG', 'LC_ALL', 'TZ', 'TMPDIR'}


def hermetic_environment(root, report, scope=None):
    retained = {key: value for key, value in os.environ.items() if key in TOOL_ENV}
    if scope == 'full':
        for key in ('MANURE_TEST_JDBC_URL','MANURE_TEST_JDBC_USER','MANURE_TEST_JDBC_PASSWORD_FILE','MANURE_TEST_ALLOW_CREATEDB'):
            retained.pop(key, None)
    discarded = sorted(set(os.environ) - set(retained))
    home = report / 'runtime-home'
    home.mkdir(mode=0o700)
    retained.update(HOME=str(home), XDG_CONFIG_HOME=str(home / 'config'),
        XDG_CACHE_HOME=str(home / 'cache'), XDG_DATA_HOME=str(home / 'data'),
        PYTHONPATH=os.pathsep.join([str(root / 'manure'), str(root / 'manure/tests')] + ([retained['PYTHONPATH']] if retained.get('PYTHONPATH') else [])),
        LANG='C.UTF-8', LC_ALL='C.UTF-8', TZ='UTC')
    os.environ.clear()
    os.environ.update(retained)
    return discarded


def prerequisites(root, registry, selected, scope):
    required = set()
    for entry in registry['pythonModules']:
        matching = [case for case in selected if case.startswith(entry['module'] + '.')]
        if matching and not all(any(case.startswith(prefix) for prefix in entry.get('pureTestPrefixes', [])) for case in matching):
            required.update(entry.get('requires', []))
    if scope == 'full':
        required.add('node')
    errors = []
    def executable(value):
        return bool(value and Path(value).is_file() and os.access(value, os.X_OK))
    def package(variable, name):
        value = os.environ.get(variable, '')
        try:
            if not Path(value).is_absolute() or json.loads((Path(value) / 'package.json').read_text()).get('name') != name:
                raise ValueError()
        except (OSError, ValueError):
            errors.append('required package: ' + variable)
    if 'target' in required:
        try:
            command = json.loads(os.environ.get('MANURE_TEST_SERVER_COMMAND_JSON', 'null'))
            if not isinstance(command, list) or not command or not all(isinstance(v, str) and v for v in command):
                raise ValueError()
        except ValueError:
            errors.append('required argv: MANURE_TEST_SERVER_COMMAND_JSON')
        helper = os.environ.get('MANURE_TEST_PROVISION_COMMAND', '')
        if scope == 'full' or helper:
            if not Path(helper).is_absolute() or not executable(helper):
                errors.append('required absolute executable: MANURE_TEST_PROVISION_COMMAND')
            fixture_root = os.environ.get('PONYGIRLS_OWNED_FIXTURE_ROOT', '')
            if not Path(fixture_root).is_absolute() or not (Path(fixture_root)/'provider.json').is_file():
                errors.append('required owned marker: PONYGIRLS_OWNED_FIXTURE_ROOT/provider.json')
            if os.environ.get('PONYGIRLS_TEST_PROVISION_SERVICE') != 'manure':
                errors.append('required service binding: PONYGIRLS_TEST_PROVISION_SERVICE=manure')
            provider = os.environ.get('PG_PROVIDER', '')
            if not Path(provider).is_absolute() or not Path(provider).is_file():
                errors.append('required absolute trusted code path: PG_PROVIDER')
        else:
            for key in ('MANURE_TEST_JDBC_URL', 'MANURE_TEST_JDBC_USER', 'MANURE_TEST_JDBC_PASSWORD_FILE'):
                if not os.environ.get(key): errors.append('required diagnostic owned-provider setting: ' + key)
            if os.environ.get('MANURE_TEST_ALLOW_CREATEDB') != '1': errors.append('required diagnostic owned-provider opt-in: MANURE_TEST_ALLOW_CREATEDB=1')
        if not shutil.which('psql'): errors.append('required command: psql')
    if 'offline-postgres' in required:
        directory = os.environ.get('MANURE_TEST_PG_BIN')
        directory = Path(directory) if directory else Path(shutil.which('initdb') or '/missing').parent
        if any(not executable(directory / name) for name in ('initdb', 'pg_ctl', 'psql')):
            errors.append('required owned offline PostgreSQL binaries: MANURE_TEST_PG_BIN or PATH')
    if 'browser' in required:
        package('MANURE_PLAYWRIGHT_CORE_PATH', 'playwright-core')
        if not executable(os.environ.get('MANURE_CHROMIUM_BIN')): errors.append('required pinned executable: MANURE_CHROMIUM_BIN')
        if not executable(os.environ.get('MANURE_OPENSSL_BIN') or shutil.which('openssl')): errors.append('required command: openssl')
    if 'sdk' in required:
        package('MANURE_MCP_SDK_PATH', '@modelcontextprotocol/sdk')
    if required & {'node', 'browser', 'sdk'} and not shutil.which('node'):
        errors.append('required command: node')
    return sorted(required), errors


def fresh_report(path):
    path.mkdir(parents=True, exist_ok=True)
    protected = ['inventory.json', 'summary.json', 'outcomes.jsonl', 'prerequisites.json',
                 'runner-inputs.sha256', 'runtime-home']
    if any((path / name).exists() for name in protected):
        raise InventoryError('report contains previous runner evidence; choose a fresh directory')


def run_python(suite, expected, report, stream=None):
    class Result(unittest.TextTestResult):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.executed = []
        def startTest(self, test):
            self.executed.append(test.id())
            super().startTest(test)
        def record(self, test, status, error=None, parent=None, reason=None):
            entry = {'test': test.id(), 'status': status}
            if parent is not None: entry['parent'] = parent.id()
            if reason is not None: entry['reason'] = reason
            if error is not None: entry['detail'] = ''.join(traceback.format_exception(*error))
            with (report / 'outcomes.jsonl').open('a') as output:
                output.write(json.dumps(entry) + '\n'); output.flush(); os.fsync(output.fileno())
        def addSuccess(self, test): self.record(test, 'passed'); super().addSuccess(test)
        def addFailure(self, test, error): self.record(test, 'failed', error); super().addFailure(test, error)
        def addError(self, test, error): self.record(test, 'error', error); super().addError(test, error)
        def addSkip(self, test, reason): self.record(test, 'skipped', reason=reason); super().addSkip(test, reason)
        def addExpectedFailure(self, test, error): self.record(test, 'expected-failure', error); super().addExpectedFailure(test, error)
        def addUnexpectedSuccess(self, test): self.record(test, 'unexpected-success'); super().addUnexpectedSuccess(test)
        def addSubTest(self, test, subtest, error):
            if error is not None:
                status = 'failed' if issubclass(error[0], test.failureException) else 'error'
                self.record(subtest, status, error, test)
            super().addSubTest(test, subtest, error)
    result = unittest.TextTestRunner(verbosity=2, resultclass=Result, stream=stream).run(suite)
    summary = {'expected': len(expected), 'tests': result.testsRun, 'failures': len(result.failures),
        'errors': len(result.errors), 'skipped': len(result.skipped),
        'expectedFailures': len(result.expectedFailures), 'unexpectedSuccesses': len(result.unexpectedSuccesses),
        'inventoryMatches': sorted(expected) == sorted(result.executed)}
    summary['success'] = (bool(expected) and result.wasSuccessful() and not result.skipped
        and not result.expectedFailures and not result.unexpectedSuccesses and summary['inventoryMatches'])
    return summary


def run_external(root, entry, report, node=False):
    log = report / (entry['id'] + '.log')
    started = time.monotonic()
    try:
        with log.open('w') as output:
            process = subprocess.run(entry['argv'], cwd=root, stdout=output, stderr=subprocess.STDOUT,
                                     timeout=entry.get('timeoutSeconds', 120))
        status = process.returncode
        completion = 'completed'
    except subprocess.TimeoutExpired:
        status, completion = None, 'timed-out'
    text = log.read_text()
    result = {'id': entry['id'], 'exitStatus': status, 'completion': completion,
              'elapsedSeconds': time.monotonic() - started}
    if node:
        observed = re.findall(r'^# Subtest: (.+)$', text, re.MULTILINE)
        counts = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', text, re.MULTILINE)}
        result.update(tests=observed, counts=counts, inventoryMatches=sorted(observed) == sorted(entry['tests']))
        result['success'] = (status == 0 and result['inventoryMatches'] and counts.get('tests') == len(entry['tests'])
            and counts.get('pass') == len(entry['tests']) and all(counts.get(k) == 0 for k in ('fail','cancelled','skipped','todo')))
    else:
        result['success'] = status == 0 and all(line in text.splitlines() for line in entry['requiredOutputLines'])
    return result


def release_acceptance(scope, current_success, gaps):
    return scope == 'full' and current_success and not gaps


def gate_exit_status(scope, current_success, gaps):
    return 0 if (release_acceptance(scope, current_success, gaps) if scope == 'full' else current_success) else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope', choices=['core','full','focused'])
    parser.add_argument('--report')
    parser.add_argument('--check-inventory', action='store_true', help='validate registration/IDs only; executes no test or acceptance gate')
    args = parser.parse_args(argv)
    if not args.check_inventory and (not args.scope or not args.report): parser.error('--scope and --report required for execution')
    report = Path(args.report).resolve() if args.report else None
    report_owned = False
    try:
        if report:
            fresh_report(report)
            report_owned = True
            discarded = hermetic_environment(ROOT, report, args.scope)
        else:
            # Inventory-only discovery does not need operator credentials either.
            import tempfile
            scratch = tempfile.TemporaryDirectory(prefix='manure-inventory-check-')
            discarded = hermetic_environment(ROOT, Path(scratch.name))
        registry = read_registry()
        discovered = discover_current(ROOT, registry)
        gaps = validate_mappings(ROOT, registry, discovered)
        if args.check_inventory:
            print(json.dumps({'classification':'inventory-validation-only','executed':False,'releaseAcceptance':False,
                'currentModules':len(discovered),'currentTests':sum(map(len,discovered.values())),
                'architectureRetiredModules':sum(e['classification']=='architecture-retired' for e in registry['pythonModules']),
                'openInvariantGaps':gaps}, sort_keys=True))
            return 0
        focused = json.loads(os.environ.get('MANURE_TARGET_DIAGNOSTIC_TESTS_JSON', 'null')) if args.scope == 'focused' else None
        names, expected = select_tests(registry, discovered, args.scope, focused)
        inventory = {'scope':args.scope,'diagnostic':args.scope!='full','modules':names,'tests':expected,
            'allCurrentModules':list(discovered),'allCurrentTests':sum(map(len,discovered.values())),
            'registrySha256':hashlib.sha256((ROOT/REGISTRY).read_bytes()).hexdigest(),
            'openInvariantGaps':gaps,'externalReleaseGates':registry['externalReleaseGates']}
        (report/'inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
        required, errors = prerequisites(ROOT, registry, expected, args.scope)
        (report/'prerequisites.json').write_text(json.dumps({'requiredGroups':required,'errors':errors,'discardedAmbientVariableNames':discarded},indent=2)+'\n')
        paths = [REGISTRY,Path('manure/scripts/target-suite.py')] + [Path(entry['path']) for entry in registry['pythonModules']]
        (report/'runner-inputs.sha256').write_text(''.join(hashlib.sha256((ROOT/path).read_bytes()).hexdigest()+'  '+str(path)+'\n' for path in sorted(paths)))
        if errors:
            summary = {'scope':args.scope,'classification':'prerequisite-failed','currentTestSuccess':False,
                       'releaseAcceptance':False,'tests':0,'expected':len(expected),'failures':0,'errors':0,'skipped':0,
                       'expectedFailures':0,'unexpectedSuccesses':0,'inventoryMatches':False,
                       'prerequisiteErrors':errors,'openInvariantGaps':gaps}
        else:
            loader = unittest.TestLoader()
            suite = loader.loadTestsFromNames(expected)
            if loader.errors: raise InventoryError('selected test loading failed')
            python = run_python(suite, expected, report)
            external = []
            if args.scope == 'full':
                external += [run_external(ROOT,entry,report,node=True) for entry in registry['nodeSuites']]
                external += [run_external(ROOT,entry,report) for entry in registry['codecChecks']]
            success = python['success'] and all(entry['success'] for entry in external)
            summary = {'scope':args.scope,'classification':'completed','diagnostic':args.scope!='full',**python,
                'currentTestSuccess':success,'releaseAcceptance':release_acceptance(args.scope,success,gaps),
                'openInvariantGaps':gaps,'externalChecks':external,
                'acceptanceScope':'CURRENT Python/Node/codec gate only; JVM/native gates are separately mandatory'}
        (report/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
        print(json.dumps(summary,sort_keys=True))
        return gate_exit_status(args.scope,summary['currentTestSuccess'],gaps)
    except (InventoryError, OSError, ValueError) as error:
        summary = {'classification':'inventory-or-configuration-invalid','currentTestSuccess':False,
                   'releaseAcceptance':False,'error':str(error)}
        if report_owned: (report/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
        print(json.dumps(summary,sort_keys=True),file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        summary={'classification':'interrupted','currentTestSuccess':False,'releaseAcceptance':False}
        if report_owned: (report/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
        return 130


if __name__ == '__main__':
    raise SystemExit(main())
