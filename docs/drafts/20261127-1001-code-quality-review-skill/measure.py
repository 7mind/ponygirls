#!/usr/bin/env python3
"""Size manifest of hand-written code in a git checkout: one row per file.
usage: measure.py [--depth N] [--exclude RE] [--test RE] [--compare OLD.tsv] PATH...   (run in the checkout)"""
import argparse, collections, os, re, subprocess, sys
LANG = {'.scala': 'c', '.java': 'c', '.kt': 'c', '.ts': 'c', '.tsx': 'c', '.js': 'c', '.mjs': 'c', '.cjs': 'c', '.jsx': 'c',
        '.c': 'c', '.h': 'c', '.cc': 'c', '.cpp': 'c', '.go': 'c', '.rs': 'c', '.cs': 'c', '.swift': 'c', '.css': 'c',
        '.py': 'h', '.sh': 'h', '.bash': 'h', '.rb': 'h', '.nix': 'h', '.sql': 'd'}
COMMENT = {'c': r'//[^\n]*|/\*.*?\*/', 'h': r'\#[^\n]*', 'd': r'--[^\n]*|/\*.*?\*/'}
STRING = r'"""(?:\\.|.)*?"""|\'\'\'(?:\\.|.)*?\'\'\'|"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|`(?:\\.|[^`\\])*`'
EXCLUDE = r'(^|/)(generated|vendor|third_party|node_modules|dist|build|target)/|\.min\.|\.lock$|-lock\.json$'
TEST = r'(^|/)(tests?(-[a-z]+)?|__tests__|specs?|e2e|fixtures)/|[._-](test|spec)\.|(Test|Suite|Spec)\.[a-z]+$|(^|/)test_[^/]*$'

def measure(text, kind):
    rx = re.compile('(?P<s>%s)|(?P<c>%s)|(?P<t>[A-Za-z_$][\\w$]*|\\d[\\w.]*|[^\\s\\w])' % (STRING, COMMENT[kind]), re.S)
    tokens, lines = 0, set()
    for m in rx.finditer(text):
        if m.lastgroup == 'c':
            continue
        first = text.count('\n', 0, m.start())
        if m.lastgroup == 's':  # a string counts its words and the non-blank lines it spans: embedded SQL/HTML is code
            body = m.group()
            if kind == 'h' and body[:3] in ('"""', "'''") and not text[text.rfind('\n', 0, m.start()) + 1:m.start()].strip():
                continue  # docstring
            tokens += max(1, len(body.split()))
            lines.update(first + i for i, part in enumerate(body.split('\n')) if part.strip())
        else:
            tokens += 1
            lines.add(first)
    return len(lines), tokens

def manifest(paths, depth, exclude, test):
    listing = subprocess.run(['git', 'ls-files', '-s', '-z', '--'] + paths, check=True, capture_output=True, text=True).stdout
    for entry in filter(None, listing.split('\0')):
        meta, path = entry.split('\t', 1)
        kind = LANG.get(os.path.splitext(path)[1])
        if meta.startswith('120000') or kind is None or re.search(exclude, path):  # symlinks, other formats, generated
            continue
        with open(path, encoding='utf-8', errors='replace') as fh:
            text = fh.read()
        n_lines, n_tokens = measure(text, kind)
        yield path, '/'.join(path.split('/')[:depth]), 'test' if re.search(test, path) else 'prod', n_lines, n_tokens, len(text.encode())

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('paths', nargs='+'); ap.add_argument('--depth', type=int, default=2)
ap.add_argument('--exclude', default=EXCLUDE); ap.add_argument('--test', default=TEST); ap.add_argument('--compare')
a = ap.parse_args()
rows = list(manifest(a.paths, a.depth, a.exclude, a.test))
for r in rows:
    print(*r, sep='\t')
total = collections.Counter()
for path, part, role, n_lines, n_tokens, n_bytes in rows:
    for key in ((part, role), ('TOTAL', role)):
        total[key + ('lines',)] += n_lines; total[key + ('tokens',)] += n_tokens; total[key + ('bytes',)] += n_bytes
old = collections.Counter()
if a.compare:
    for line in open(a.compare):
        path, part, role, n_lines, n_tokens, n_bytes = line.rstrip('\n').split('\t')
        for key in ((part, role), ('TOTAL', role)):
            old[key + ('lines',)] += int(n_lines); old[key + ('tokens',)] += int(n_tokens)
for part, role in sorted({k[:2] for k in total} | {k[:2] for k in old}):
    cur = [total[(part, role, m)] for m in ('lines', 'tokens', 'bytes')]
    delta = '  delta lines %+d tokens %+d' % (cur[0] - old[(part, role, 'lines')], cur[1] - old[(part, role, 'tokens')]) if a.compare else ''
    print('%-28s %-4s lines %7d tokens %8d bytes %9d%s' % (part, role, *cur, delta), file=sys.stderr)
