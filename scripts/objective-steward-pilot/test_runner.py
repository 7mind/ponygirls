#!/usr/bin/env python3
"""Blackbox-GoodCommunication regression: real frozen CLI + local dummy bridge.

Tests interruption accounting, NOT model quality. No live SDK/auth/network calls.
Explicit STEWARD_TEST_REPOSITORY and STEWARD_TEST_REVISION are mandatory;
the test never silently follows HEAD or discovers an unrelated checkout.
Generated evidence stays under STEWARD_TEST_ARTIFACTS (exclusive new directory).
"""
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
PREFIX = Path('scripts/objective-steward-pilot')

# A hand-written protocol dummy, not a semantic oracle. It only copies source
# IDs and claim revision refs from the first supplied synthetic input. Invocation
# two records its ownership and readiness, then waits without any provider call.
DUMMY = r'''#!__PYTHON__
import json
import os
from pathlib import Path
import sys
import time

home = Path(os.environ['STEWARD_DUMMY_HOME'])
count_path = home / 'dummy-count.txt'
ordinal = int(count_path.read_text()) + 1 if count_path.exists() else 1
count_path.write_text(str(ordinal))
request = json.load(sys.stdin)
args = dict(zip(sys.argv[2::2], sys.argv[3::2]))
if ordinal == 1:
    snapshot = request['input']
    refs = [row['id'] for row in snapshot['sources']][:1]
    response = {
        'objectives': [{'key': 'primary', 'text': 'Generic synthetic test account, not a quality judgment.',
                        'criteria': [], 'basis': 'inferred', 'sources': refs}],
        'notes': [],
        'assessments': [{'claim': {'id': row['id'], 'revision': row['revision']},
                         'verdict': 'inconclusive', 'reason': 'Generic protocol fixture; no semantic assessment.',
                         'sources': refs} for row in snapshot['claims']],
        'proposals': [],
    }
    print(json.dumps({'text': json.dumps(response), 'usage': None,
                      'provider': args['--provider'], 'model': args['--model'],
                      'thinking': args['--thinking']}), flush=True)
elif ordinal == 2:
    marker = {'pid': os.getpid(), 'ppid': os.getppid(), 'ordinal': ordinal, 'ready': True}
    temporary = home / 'second-ready.tmp'
    temporary.write_text(json.dumps(marker))
    temporary.rename(home / 'second-ready.json')
    time.sleep(60)
    sys.exit(75)
else:
    sys.exit(76)
'''


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, value):
    with path.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write('\n')


def exit_ready(pidfd, timeout):
    return bool(select.select([pidfd], [], [], timeout)[0])


class InterruptedAttemptInventory(unittest.TestCase):
    def test_admitted_interrupted_case_has_terminal_receipt_inventory_and_score_denominator(self):
        revision = os.environ.get('STEWARD_TEST_REVISION')
        configured_repository = os.environ.get('STEWARD_TEST_REPOSITORY')
        self.assertTrue(revision, 'Prerequisite: set STEWARD_TEST_REVISION to an explicit committed source revision')
        self.assertTrue(configured_repository, 'Prerequisite: set STEWARD_TEST_REPOSITORY to the source repository path')
        self.assertIsNotNone(shutil.which('nix'), 'Nix prerequisite unavailable: no nix executable')
        self.assertTrue(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'),
                        'Linux pidfd prerequisite unavailable for owned-child cleanup verification')
        repository = Path(configured_repository).resolve()
        artifacts = Path(os.environ.get('STEWARD_TEST_ARTIFACTS', str(ROOT / '.local/interrupt-repro-001'))).resolve()
        self.assertTrue(artifacts.is_relative_to(ROOT), 'Artifacts must stay inside the dedicated test worktree')
        artifacts.mkdir(parents=True, exist_ok=False)
        commit = subprocess.check_output(['git', '-C', str(repository), 'rev-parse', revision + '^{commit}'], text=True).strip()
        freeze_command = [sys.executable, str(repository / PREFIX / 'freeze.py'),
                          '--repository', str(repository), '--revision', revision]
        frozen_result = subprocess.run(freeze_command, capture_output=True, text=True, timeout=60)
        (artifacts / 'freeze.stdout').write_text(frozen_result.stdout)
        (artifacts / 'freeze.stderr').write_text(frozen_result.stderr)
        self.assertEqual(frozen_result.returncode, 0,
                         'Nix freeze prerequisite failed; inspect freeze.stderr (no evaluation claimed)')
        frozen = Path(frozen_result.stdout.strip())
        self.assertTrue(str(frozen).startswith('/nix/store/') and frozen.is_dir(), 'freeze did not yield an immutable Nix store directory')
        self.assertEqual(read_json(frozen / 'source-identity.json')['commit'], commit)
        dummy = artifacts / 'dummy-node'
        dummy.write_text(DUMMY.replace('__PYTHON__', sys.executable), encoding='utf-8')
        dummy.chmod(0o755)
        out = artifacts / 'evaluation'
        base = [sys.executable, '-B', str(frozen / 'run.py')]
        fixtures = ['--cases', str(frozen / 'fixtures/cases.json'), '--oracle', str(frozen / 'fixtures/oracle.json')]
        evaluate_command = [*base, 'evaluate', *fixtures, '--out', str(out), '--node', str(dummy),
                            '--sdk', 'synthetic-unused-sdk', '--provider', 'synthetic-dummy',
                            '--model', 'synthetic-no-model', '--thinking', 'off']
        environment = dict(os.environ, STEWARD_DUMMY_HOME=str(artifacts), PYTHONDONTWRITEBYTECODE='1')
        process = None
        child_fd = None
        marker = None
        cleanup_verified = False
        eval_exit = None
        readiness_seconds = None
        started = time.monotonic()
        try:
            with (artifacts / 'evaluate.stdout').open('xb') as stdout, (artifacts / 'evaluate.stderr').open('xb') as stderr:
                process = subprocess.Popen(evaluate_command, stdout=stdout, stderr=stderr, env=environment,
                                           cwd=str(artifacts), start_new_session=True)
                deadline = time.monotonic() + 15
                ready = artifacts / 'second-ready.json'
                while not ready.exists():
                    self.assertIsNone(process.poll(), 'evaluate exited before second dummy invocation became ready')
                    self.assertLess(time.monotonic(), deadline, 'second dummy readiness exceeded 15-second monotonic deadline')
                    time.sleep(0.02)
                readiness_seconds = time.monotonic() - started
                marker = read_json(ready)
                self.assertEqual(set(marker), {'pid', 'ppid', 'ordinal', 'ready'})
                self.assertIs(marker['ready'], True)
                self.assertEqual(marker['ordinal'], 2)
                self.assertEqual(marker['ppid'], process.pid, 'ready bridge is not a child of our owned evaluation')
                self.assertIs(type(marker['pid']), int)
                self.assertGreater(marker['pid'], 1)
                # Open a stable process handle before signaling; no PID-pattern
                # search, process-group signal, or unknown-process cleanup.
                child_fd = os.pidfd_open(marker['pid'], 0)
                stat = Path(f'/proc/{marker["pid"]}/stat').read_text()
                self.assertEqual(int(stat.rsplit(')', 1)[1].split()[1]), process.pid)
                self.assertEqual(int((artifacts / 'dummy-count.txt').read_text()), 2)
                first_id, second_id = read_json(out / 'manifest.json')['case_order'][:2]
                first = read_json(out / first_id / 'attempt.json')
                self.assertIs(first['published'], True, 'generic first response was not structurally accepted')
                process.send_signal(signal.SIGINT)  # Exactly once, owned eval PID only.
                eval_exit = process.wait(timeout=10)
                cleanup_verified = exit_ready(child_fd, 5)
        finally:
            # Failure-only cleanup remains limited to handles owned/verified above.
            if process is not None and process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            if child_fd is not None:
                if not exit_ready(child_fd, 0):
                    signal.pidfd_send_signal(child_fd, signal.SIGKILL)
                    exit_ready(child_fd, 5)
                os.close(child_fd)

        manifest = read_json(out / 'manifest.json')
        self.assertEqual(manifest['head'], commit)
        self.assertEqual(manifest['planned_cases'], 16)
        self.assertEqual(len(manifest['case_order']), 16)
        first_id, second_id = manifest['case_order'][:2]
        second_path = out / second_id / 'attempt.json'
        inventory_path = out / 'attempts.json'
        second = read_json(second_path) if second_path.exists() else None
        inventory = read_json(inventory_path) if inventory_path.exists() else None
        score_command = [*base, 'score', *fixtures, '--out', str(out)]
        with (artifacts / 'score.stdout').open('xb') as stdout, (artifacts / 'score.stderr').open('xb') as stderr:
            score_result = subprocess.run(score_command, stdout=stdout, stderr=stderr, env=environment,
                                          cwd=str(artifacts), timeout=15)
        score_path = out / 'score.json'
        score = read_json(score_path) if score_path.exists() else None
        evidence = {
            'scope': 'interruption accounting only; dummy structural response, no live model or semantic quality claim',
            'revision_requested': revision, 'commit': commit, 'frozen': str(frozen),
            'freeze_command': freeze_command, 'evaluate_command': evaluate_command, 'score_command': score_command,
            'owned_evaluate_pid': process.pid, 'ready_marker': marker, 'ready_seconds': readiness_seconds,
            'sigint_sent_to_owned_evaluate_once': True, 'evaluate_exit': eval_exit,
            'owned_second_bridge_exited': cleanup_verified,
            'first_completed_receipt': first['published'], 'second_terminal_receipt_exists': second is not None,
            'second_status': None if second is None else second.get('status'),
            'second_error': None if second is None else second.get('error'),
            'inventory_exists': inventory is not None, 'inventory_count': None if inventory is None else len(inventory),
            'score_exit': score_result.returncode, 'score_exists': score is not None,
            'score_planned': None if score is None else score.get('planned'),
            'score_attempted': None if score is None else score.get('attempted'),
            'score_status_counts': None if score is None else {
                status: sum(row['status'] == status for row in score['rows'])
                for status in ['published', 'interrupted', 'unattempted']},
            'expected': {'planned': 16, 'admitted': 2, 'completed': 1, 'interrupted': 1, 'unattempted': 14},
        }
        write_json(artifacts / 'evidence.json', evidence)
        print(json.dumps({key: evidence[key] for key in [
            'commit', 'frozen', 'evaluate_exit', 'owned_second_bridge_exited',
            'first_completed_receipt', 'second_terminal_receipt_exists', 'inventory_exists', 'inventory_count',
            'score_exit', 'score_planned', 'score_attempted', 'score_status_counts']}, sort_keys=True), flush=True)
        self.assertTrue(cleanup_verified, 'owned second bridge did not exit after evaluation cancellation')
        self.assertIsNotNone(second,
                             f'admitted {second_id} missing terminal interrupted attempt.json; '
                             f'inventory persisted={inventory is not None}; score exit={score_result.returncode}')
        self.assertIs(second['published'], False)
        self.assertTrue(second.get('status') == 'interrupted' or second.get('error') == 'interrupted',
                        'terminal receipt must explicitly identify the admitted attempt as interrupted')
        self.assertIsNotNone(inventory, 'attempts inventory missing after interruption')
        self.assertEqual(len(inventory), 2, 'admitted interrupted attempt was lost from denominator')
        self.assertEqual([row['case'] for row in inventory], [first_id, second_id])
        self.assertEqual(inventory[1], second, 'inventory does not bind the interrupted terminal receipt')
        self.assertEqual(score_result.returncode, 0, 'score must remain executable after interruption')
        self.assertIsNotNone(score)
        self.assertEqual(score['planned'], 16)
        self.assertEqual(score['attempted'], 2)
        self.assertEqual(len(score['rows']), 16)
        self.assertEqual(evidence['score_status_counts'], {'published': 1, 'interrupted': 1, 'unattempted': 14})
        self.assertEqual(score['rows'][0]['status'], 'published')
        self.assertEqual(score['rows'][1]['status'], 'interrupted')
        self.assertTrue(all(row['status'] == 'unattempted' for row in score['rows'][2:]))


if __name__ == '__main__':
    unittest.main()
