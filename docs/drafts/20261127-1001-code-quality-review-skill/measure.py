#!/usr/bin/env python3
"""Size manifest of hand-written code in a git work tree, one row per file: path, partition, role, lines, tokens, bytes.
  measure.py [--depth N] [--exclude RE] [--test RE] PATH... > manifest.tsv     baseline (run inside the work tree)
  measure.py --compare manifest.tsv > after.tsv                               same arguments as the baseline, plus deltas
Counts tracked and untracked files as they are on disk; skips ignored files, symbolic links and other formats."""
import argparse, ast, collections, json, os, re, subprocess, sys
KIND = {'.scala': 'c', '.java': 'c', '.kt': 'c', '.ts': 'c', '.tsx': 'c', '.js': 'c', '.mjs': 'c', '.cjs': 'c', '.jsx': 'c',
        '.c': 'c', '.h': 'c', '.cc': 'c', '.cpp': 'c', '.go': 'c', '.rs': 'c', '.cs': 'c', '.swift': 'c', '.css': 'c',
        '.py': 'p', '.sh': 's', '.bash': 's', '.zsh': 's', '.rb': 's', '.nix': 'n', '.sql': 'd'}
ONE_LINE = r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\''
MANY_LINES = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\''
STRING = {'c': r'"""(?:\\.|.)*?"""|`(?:\\.|[^`\\])*`|' + ONE_LINE, 'p': r'"""(?:\\.|.)*?"""|\'\'\'(?:\\.|.)*?\'\'\'|' + ONE_LINE,
          's': MANY_LINES, 'n': r"''.*?''|" + MANY_LINES, 'd': MANY_LINES}
COMMENT = {'c': r'//[^\n]*|/\*.*?\*/', 'p': r'\#[^\n]*', 's': r'(?<![^\s;])\#[^\n]*', 'n': r'\#[^\n]*|/\*.*?\*/', 'd': r'--[^\n]*|/\*.*?\*/'}
TOKEN = r'[A-Za-z_$][\w$]*|\d[\w.]*|[^\s\w]'
EXCLUDE = r'(^|/)(generated|vendor|third_party|node_modules|dist|build|target)/|\.min\.|\.lock$|-lock\.json$'
TEST = r'(^|/)(tests?(-[a-z]+)?|__tests__|specs?|e2e|fixtures)/|[._-](test|spec)\.|(Test|Suite|Spec)\.[a-z]+$|(^|/)test_[^/]*$'

def docstring_lines(text):
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        return set()
    owners = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
    firsts = (node.body[0] for node in ast.walk(tree) if isinstance(node, owners) and node.body)
    return {s.lineno - 1 for s in firsts if isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant) and isinstance(s.value.value, str)}

def measure(text, kind):
    docs = docstring_lines(text) if kind == 'p' else set()
    tokens, lines = 0, set()
    for m in re.finditer('(?P<s>%s)|(?P<c>%s)|(?P<t>%s)' % (STRING[kind], COMMENT[kind], TOKEN), text, re.S):
        first = text.count('\n', 0, m.start())
        if m.lastgroup == 'c' or (m.lastgroup == 's' and first in docs and not text[text.rfind('\n', 0, m.start()) + 1:m.start()].strip()):
            continue  # comments and docstrings count as nothing
        if m.lastgroup == 's':  # a string counts the tokens inside it and the non-blank lines it spans: embedded SQL is code
            tokens += len(re.findall(TOKEN, m.group()))
            lines.update(first + i for i, part in enumerate(m.group().split('\n')) if part.strip())
        else:
            tokens += 1
            lines.add(first)
    return len(lines), tokens

def manifest(paths, depth, exclude, test):
    listing = subprocess.run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--'] + paths,
                             check=True, capture_output=True, text=True).stdout
    for path in sorted(set(filter(None, listing.split('\0')))):
        kind = KIND.get(os.path.splitext(path)[1])
        if kind is None or re.search(exclude, path) or os.path.islink(path) or not os.path.isfile(path):
            continue  # other formats, excluded paths, symbolic links, files deleted from the work tree
        if '\t' in path or '\n' in path:
            sys.exit('measure.py: unsupported file name: %r' % path)
        with open(path, encoding='utf-8', errors='replace') as fh:
            text = fh.read()
        n_lines, n_tokens = measure(text, kind)
        yield path, '/'.join(path.split('/')[:depth]), 'test' if re.search(test, path) else 'prod', n_lines, n_tokens, len(text.encode())

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('paths', nargs='*'); ap.add_argument('--depth', type=int); ap.add_argument('--exclude'); ap.add_argument('--test')
ap.add_argument('--compare', metavar='BASELINE.tsv')
a = ap.parse_args()
given = {k: v for k, v in (('paths', a.paths), ('depth', a.depth), ('exclude', a.exclude), ('test', a.test)) if v}
old = {}
if a.compare:
    with open(a.compare, encoding='utf-8') as fh:
        args = json.loads(fh.readline()[1:])
        if any(args[k] != v for k, v in given.items()):
            sys.exit('measure.py: arguments differ from the baseline %s; pass none to reuse them' % json.dumps(args))
        old = {row[0]: row for row in (line.rstrip('\n').split('\t') for line in fh)}
else:
    args = {'paths': a.paths, 'depth': a.depth or 2, 'exclude': a.exclude or EXCLUDE, 'test': a.test or TEST}
    if not a.paths:
        ap.error('PATH... is required without --compare')
rows = {r[0]: r for r in manifest(args['paths'], args['depth'], args['exclude'], args['test'])}
print('#' + json.dumps(args))
for r in rows.values():
    print(*r, sep='\t')
total = collections.Counter()
for sign, table in ((1, rows), (-1, old)):
    for path, part, role, n_lines, n_tokens, n_bytes in table.values():
        for key in ((part, role), ('TOTAL', role)):
            for name, value in (('lines', n_lines), ('tokens', n_tokens)):
                total[key + (name, sign)] += int(value)
for path in sorted(set(rows) | set(old)) if a.compare else ():
    now, was = rows.get(path, (0,) * 6), old.get(path, (0,) * 6)
    if (int(now[3]), int(now[4])) != (int(was[3]), int(was[4])):
        state = 'added' if path not in old else 'removed' if path not in rows else 'changed'
        print('%-8s lines %+6d tokens %+7d  %s' % (state, int(now[3]) - int(was[3]), int(now[4]) - int(was[4]), path), file=sys.stderr)
for part, role in sorted({k[:2] for k in total}):
    cur = [total[(part, role, name, 1)] for name in ('lines', 'tokens')]
    delta = '  delta lines %+d tokens %+d' % tuple(c - total[(part, role, name, -1)] for c, name in zip(cur, ('lines', 'tokens'))) if a.compare else ''
    print('%-28s %-4s lines %7d tokens %8d%s' % (part, role, *cur, delta), file=sys.stderr)
