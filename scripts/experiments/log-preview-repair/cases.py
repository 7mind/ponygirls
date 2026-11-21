#!/usr/bin/env python3
"""Offline, SHA-pinned repair cases. See CASES.md before preparing or grading."""

import argparse
from collections import Counter
from dataclasses import dataclass
from difflib import SequenceMatcher
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tarfile
import tempfile

from sandbox import Unknown, execute

HERE = Path(__file__).resolve().parent
# Only this module and archives.json select paths. No paths or commands accepted
# from the model; no use of an unpacked cache, Git repository or package installer.
PINS = json.loads((HERE / 'archives.json').read_bytes())
FROZEN_SHA256 = '7169a0b0b9e73f34d51897212d2733dcb7f56fc700a0e1e3689abb1a03afe668'


@dataclass(frozen=True)
class Case:
    cache_name: str
    target: str
    tests: tuple[str, ...]
    other: str
    other_lines: int | None
    public_count: int
    public_red: dict
    edge_red: dict


CASES = {
    'case-a': Case('interpose', 'toolz/itertoolz.py',
                   ('toolz/tests/__init__.py', 'toolz/tests/test_itertoolz.py'),
                   'toolz/functoolz.py', 650, 51,
                   {('test_interpose_empty', 'StopIteration'): 1},
                   {('test_exhausted_one_shot', 'StopIteration'): 1}),
    'case-b': Case('numeric-range', 'more_itertools/more.py',
                   ('tests/__init__.py', 'tests/test_more.py'), 'more_itertools/recipes.py', 550, 32,
                   {('test_eq_above_maxsize', 'OverflowError'): 6,
                    ('test_hash_above_maxsize', 'OverflowError'): 3},
                   {('test_large_negative_domain', 'OverflowError'): 1,
                    ('test_large_dictionary_key', 'OverflowError'): 1,
                    ('test_large_different_sequences', 'OverflowError'): 1}),
    'case-c': Case('semver-index', 'src/semver/version.py',
                   ('tests/test_format.py', 'tests/test_index.py'), 'src/semver/_deprecated.py', None, 62,
                   {('test_version_accepts_index_protocol', 'AttributeError'): 1,
                    **{(f'test_invalid_version_index_type_{i:02}', 'AttributeError'): 1 for i in range(3)}},
                   {('test_optional_parts_and_stride', 'AttributeError'): 1,
                    ('test_negative_protocol_bound', 'TypeError'): 1,
                    ('test_integer_coercion_is_not_an_offset', 'AttributeError'): 1}),
}


class Invalid(ValueError):
    """Short controlled reason for a malformed submission; never contains its text."""


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(obj):
    return (json.dumps(obj, ensure_ascii=False, allow_nan=False, indent=2) + '\n').encode('utf-8')


def regular_bytes(path, bound):
    # Never block on a pipe or accidentally consume an unbounded artifact.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        info = os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode):
            raise OSError('not_regular_file')
        if info.st_size > bound:
            raise ValueError('oversized_file')
        data = f.read(bound + 1)
        if len(data) > bound:
            raise ValueError('file_grew')
        return data


def archive(cache, case, kind, *, package, tests):
    pin, = (p for p in PINS if p['id'] == case.cache_name and p['kind'] == kind)
    try:
        data = regular_bytes(cache / f'{case.cache_name}-{kind}.tgz', pin['bytes'])
    except (ValueError, OSError):
        raise Unknown('cache_file_unavailable_or_size_mismatch') from None
    if len(data) != pin['bytes'] or sha(data) != pin['sha256']:
        raise Unknown('archive_digest_mismatch')
    # Verify the SAME bytes we parse. extractfile() only on selected regular
    # files in a pinned archive: no filesystem extraction of tar paths or links.
    prefix = f"{pin['repo'].split('/')[-1]}-{pin['revision']}/"
    pkg = case.target.rsplit('/', 1)[0] + '/'
    result = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
        for member in tar:
            if not member.name.startswith(prefix):
                continue
            path = member.name[len(prefix):]
            prod = path.startswith(pkg) and path.endswith('.py') and 'tests' not in path.split('/')
            if not (package and (prod or path in ('LICENSE', 'LICENSE.txt')) or tests and path in case.tests):
                continue
            parts = PurePosixPath(path).parts
            if (not member.isfile() or '..' in parts or not parts or parts[0] == '/' or
                    str(PurePosixPath(path)) != path or path in result or member.size > 1 << 20):
                raise Unknown('invalid_archive_member')
            result[path] = tar.extractfile(member).read()
    if (tests and not all(f in result for f in case.tests) or
            package and not all(f in result for f in (case.target, case.other))):
        raise Unknown('missing_archive_member')
    return result


def patch(source, answer_file):
    def distinct(pairs):
        fields = dict(pairs)
        if len(fields) != len(pairs):
            raise ValueError('duplicate')
        return fields
    try:
        answer = json.loads(regular_bytes(answer_file, 64 * 1024).decode('utf-8'), object_pairs_hook=distinct)
    except OSError:
        raise Unknown('answer_unreadable') from None
    except (ValueError, RecursionError):
        raise Invalid('answer_not_bounded_utf8_json') from None
    if (not isinstance(answer, dict) or set(answer) != {'edits'} or
            not isinstance(answer['edits'], list) or not 1 <= len(answer['edits']) <= 8):
        raise Invalid('expected_one_to_eight_edits')
    out = source
    for edit in answer['edits']:
        if not isinstance(edit, dict) or set(edit) != {'old', 'new'}:
            raise Invalid('expected_old_and_new')
        old, new = edit['old'], edit['new']
        if not isinstance(old, str) or not isinstance(new, str) or not old.strip() or old == new:
            raise Invalid('empty_or_unchanged_anchor')
        try:
            if any('\0' in s or len(s.encode('utf-8')) > 4096 for s in (old, new)):
                raise Invalid('edit_size_or_nul')
        except UnicodeEncodeError:
            raise Invalid('invalid_unicode') from None
        i = out.find(old)
        if i < 0 or out.find(old, i + 1) >= 0:
            raise Invalid('anchor_not_unique_in_current_text')
        out = out[:i] + new + out[i + len(old):]
    if out == source:
        raise Invalid('no_net_change')
    return out.encode('utf-8')


def normalize(log):
    # Bounded transcript of **trusted pinned public tests on the broken parent**
    # only. Strip terminal styling, host-independent sandbox prefixes and time;
    # leave all test names, execution order, traceback frames and messages intact.
    text = log.decode('utf-8', 'strict')
    text = re.sub(r'\033\[[0-9;]*m', '', text)
    text = text.replace('"/project/', '"').replace('"/suite/', '"')
    text = re.sub(r'"/nix/store/[^/]+/lib/python\d+\.\d+/', '"<stdlib>/', text)
    return re.sub(r'(?m)^(Ran \d+ tests? in )\d+\.\d+s$', r'\1<elapsed>s', text)


def measurement(files, case_id, phase):
    rc, raw = execute(files, case_id, phase)
    marker = b'SUITE_RECEIPT '
    lines = raw.splitlines(keepends=True)
    if not lines or not lines[-1].startswith(marker) or raw.count(marker) != 1:
        raise Unknown('sandbox_or_driver_did_not_finish')
    try:
        row = json.loads(lines[-1][len(marker):])
        if not isinstance(row, dict):
            raise ValueError
        trace = b''.join(lines[:-1])
        if row.get('status') in ('resource', 'collection') and rc == 2:
            return row, trace
        keys = ('planned', 'ran', 'completed', 'passed', 'errors', 'failures', 'extras')
        if (row.get('status') != 'finished' or rc not in (0, 1) or
                not all(type(row.get(k)) is int and 0 <= row[k] <= 1024 for k in keys) or
                not isinstance(row.get('resource'), bool) or not isinstance(row.get('issues'), list)):
            raise ValueError
        issues = row['issues']
        if not all(isinstance(pair, list) and len(pair) == 2 and
                   all(isinstance(s, str) and len(s) <= 160 for s in pair) for pair in issues):
            raise ValueError
        n = CASES[case_id].public_count if phase == 'public' else 4
        if (row['planned'] != n or row['ran'] != n or row['completed'] != n or
                row['passed'] > n or len(issues) != row['errors'] + row['failures'] or
                not re.search(rb'(?m)^Ran ' + str(n).encode() + rb' tests in [0-9.]+s$', trace)):
            raise ValueError
        ok = row['passed'] == n and not (issues or row['extras'] or row['resource'])
        if ((rc == 0) != ok or ok and not trace.rstrip().endswith(b'\nOK') or
                not ok and b'\nFAILED (' not in trace and not row['extras']):
            raise ValueError
    except (ValueError, KeyError, TypeError, RecursionError):
        raise Unknown('incomplete_test_accounting') from None
    return row, trace


def control(row, red):
    if (row['status'] != 'finished' or row['resource'] or row['extras'] or
            Counter(map(tuple, row['issues'])) != red or
            row['passed'] != row['ran'] - len({name for name, _ in red})):
        raise Unknown('reference_behavior_did_not_reproduce')


def counts(row):
    return {k: row[k] for k in ('ran', 'completed', 'passed', 'errors', 'failures', 'extras')}


TASK = ('A CI run reported a regression in this checkout. Diagnose it from the historical test output, '
        'inspect the allowed production source, and repair the behavior without breaking existing uses. '
        'Change only {target}. Submit one JSON object {{"edits":[{{"old":"...","new":"..."}}]}}. '
        'Use 1–8 sequential exact replacements. Each old text must be nonblank and unique at that step; '
        'each string is at most 4096 UTF-8 bytes. Do not submit a shell command, file path, or Markdown.')


def reference_grade(cache, case_id, base, fixed):
    # Convert just the public target-file delta into bounded distinct anchors.
    # Exercise the exact answer-file parser and fresh-parent grade path used by
    # actual submissions. Neither the anchors nor the fixed source leave here.
    left, right = [s.decode('utf-8').splitlines(keepends=True) for s in (base, fixed)]
    edits = []
    for group in SequenceMatcher(None, left, right).get_grouped_opcodes(n=2):
        first, last = group[0], group[-1]
        edits.append(dict(old=''.join(left[first[1]:last[2]]), new=''.join(right[first[3]:last[4]])))
    with tempfile.TemporaryDirectory(prefix='preview-reference-') as temp:
        answer = Path(temp) / 'answer.json'
        answer.write_bytes(encoded(dict(edits=edits)))
        result = grade(cache, case_id, answer)
    if result['outcome'] != 'pass' or result['patchedSha256'] != sha(fixed):
        raise Unknown('target_only_reference_grade_failed')
    return result


def prepare(cache, out):
    out.mkdir(mode=0o700, exist_ok=False)
    operator = out / 'operator'
    operator.mkdir(mode=0o700)
    rows, proofs = [], {}
    for case_id, case in CASES.items():
        base = archive(cache, case, 'base', package=True, tests=False)
        tests = archive(cache, case, 'fixed', package=False, tests=True)
        before, raw = measurement(base | tests, case_id, 'public')
        # Retain the literal executed parent capture *before* running extra
        # heldouts or executing any fixed module. Neither receipt nor operator
        # files enter the historical log. There is no selected/error summary.
        (operator / f'{case_id}.before.log').write_bytes(raw)
        control(before, case.public_red)
        log = normalize(raw)
        edge, _ = measurement(base, case_id, 'heldout')
        control(edge, case.edge_red)
        fixed = archive(cache, case, 'fixed', package=True, tests=False)
        after, _ = measurement(fixed | tests, case_id, 'public')
        control(after, {})
        edge_after, _ = measurement(fixed, case_id, 'heldout')
        control(edge_after, {})
        # Both archives agree on every other production file. This isolates a
        # repair to the advertised target from incidental upstream changes.
        if (set(base) != set(fixed) or base[case.target] == fixed[case.target] or
                any(base[f] != fixed[f] for f in base if f != case.target)):
            raise Unknown('unexpected_reference_tree_delta')
        reference = reference_grade(cache, case_id, base[case.target], fixed[case.target])
        # Fresh captures after executing and discarding the reference patch.
        replay, raw_again = measurement(base | tests, case_id, 'public')
        control(replay, case.public_red)
        edge_replay, _ = measurement(base, case_id, 'heldout')
        control(edge_replay, case.edge_red)
        if normalize(raw_again) != log:
            raise Unknown('nondeterministic_parent_transcript')
        source = base[case.target].decode('utf-8')
        other = ''.join(base[case.other].decode('utf-8').splitlines(keepends=True)[:case.other_lines])
        if not (4096 <= len(log) <= 20000 and len(other) >= 4096 and len(log) + len(other) >= 18000):
            raise Unknown('history_shape_out_of_bounds')
        rows.append(dict(id=case_id, targetPath=case.target, task=TASK.format(target=case.target),
                         logText=log, nonLogText=other, sourceText=source))
        license_path, = (k for k in base if k.startswith('LICENSE'))
        (operator / f'{case_id}.LICENSE').write_bytes(base[license_path])
        proofs[case_id] = dict(
            publicParent=counts(before), publicFixed=counts(after), targetOnlyReferenceGrade=reference,
            parentAfterReference=dict(public=counts(replay), heldout=counts(edge_replay)),
            heldoutParent=counts(edge), heldoutFixed=counts(edge_after),
            beforeRawSha256=sha(raw), logSha256=sha(log.encode()), logChars=len(log),
            nonLogPath=case.other, nonLogLines=len(other.splitlines()),
            nonLogSha256=sha(other.encode()), nonLogChars=len(other), targetSha256=sha(base[case.target]),
            testFiles={k: sha(v) for k, v in tests.items()},
        )
    data = encoded(rows)
    if sha(data) != FROZEN_SHA256:
        raise Unknown('fixture_hash_mismatch')
    (operator / 'verification.json').write_bytes(encoded(proofs))
    (out / 'cases.json').write_bytes(data)
    return dict(status='prepared', cases=len(rows), sha256=sha(data))


def grade(cache, case_id, answer):
    case = CASES[case_id]
    base = archive(cache, case, 'base', package=True, tests=False)
    patched = base | {case.target: patch(base[case.target].decode('utf-8'), answer)}
    tests = archive(cache, case, 'fixed', package=False, tests=True)
    totals = dict(ran=0, passed=0, errors=0, failures=0, extras=0)
    incomplete, failed = {}, []
    for phase, test_files, ref in (('public', tests, case.public_red), ('heldout', {}, case.edge_red)):
        # Validate the pristine parent in the same runtime. A resource/host
        # failure blocks *this* phase, not the conclusion of another phase.
        try:
            parent, _ = measurement(base | test_files, case_id, phase)
            control(parent, ref)
            row, _ = measurement(patched | test_files, case_id, phase)
        except (Unknown, OSError) as exc:
            incomplete[phase] = 'local_io_error' if isinstance(exc, OSError) else str(exc)
            continue
        if row['status'] == 'finished':
            for k in totals:
                totals[k] += row[k]
        if row['status'] == 'resource' or row.get('resource'):
            incomplete[phase] = 'resource_limit'
        elif row['status'] == 'collection':
            incomplete[phase] = 'patch_prevented_test_collection'
            failed.append('patch_prevented_test_collection')
        elif row['passed'] != row['ran'] or row['extras'] or row['issues']:
            failed.append('behavioral_checks_failed')
    receipt = dict(**totals, patchedSha256=sha(patched[case.target]))
    if incomplete:
        receipt['incompletePhases'] = incomplete
    if failed:
        return dict(outcome='fail', reason=failed[0], **receipt)
    if incomplete:
        return dict(outcome='unknown', reason=next(iter(incomplete.values())), **receipt)
    return dict(outcome='pass', reason='all_checks_passed', **receipt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(required=True, dest='cmd')
    prep = sub.add_parser('prepare'); prep.add_argument('cache', type=Path); prep.add_argument('out', type=Path)
    gr = sub.add_parser('grade'); gr.add_argument('cache', type=Path); gr.add_argument('case_id', choices=CASES)
    gr.add_argument('answer', type=Path)
    args = parser.parse_args()
    try:
        result = (prepare(args.cache, args.out) if args.cmd == 'prepare' else
                  dict(caseId=args.case_id, **grade(args.cache, args.case_id, args.answer)))
    except (Invalid, Unknown, OSError) as exc:
        reason = 'local_io_error' if isinstance(exc, OSError) else str(exc)
        result = dict(outcome='invalid' if isinstance(exc, Invalid) else 'unknown', reason=reason)
        if args.cmd == 'grade':
            result['caseId'] = args.case_id
    print(json.dumps(result, separators=(',', ':')))
    # Grading results including unknown are structured; a failed preparation
    # cannot be mistaken for a usable fixture in shell pipelines.
    return int(args.cmd == 'prepare' and result.get('status') != 'prepared')


if __name__ == '__main__':
    sys.exit(main())
