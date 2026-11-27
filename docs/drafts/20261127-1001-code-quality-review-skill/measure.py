#!/usr/bin/env python3
"""Size manifest of hand-written code in a git work tree, one row per file: path, partition, role, lines, tokens, bytes.
  measure.py [--depth N] [--exclude RE] [--test RE] PATH... > manifest.tsv     baseline (run at the root of the work tree)
  measure.py --compare manifest.tsv > after.tsv                               same arguments as the baseline, plus deltas
Counts tracked and untracked files as they are on disk; skips ignored files, symbolic links and other formats."""
import argparse, ast, bisect, collections, json, os, re, subprocess, sys
KIND = {'.scala': 'c', '.java': 'c', '.kt': 'c', '.ts': 'c', '.tsx': 'c', '.js': 'c', '.mjs': 'c', '.cjs': 'c', '.jsx': 'c',
        '.c': 'c', '.h': 'c', '.cc': 'c', '.cpp': 'c', '.go': 'c', '.rs': 'c', '.cs': 'c', '.swift': 'c', '.css': 'c',
        '.py': 'p', '.sh': 's', '.bash': 's', '.zsh': 's', '.nix': 'n', '.sql': 'd'}
ONE_LINE = r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\''
DOUBLE = r'"(?:\\.|[^"\\])*"'
STRING = {'c': r'"""(?:\\.|.)*?"""|`(?:\\.|[^`\\])*`|' + ONE_LINE, 'p': r'"""(?:\\.|.)*?"""|\'\'\'(?:\\.|.)*?\'\'\'|' + ONE_LINE,
          's': DOUBLE + r"|'[^']*'", 'n': r"''(?:'''|''\$|''\\.|(?!'').)*''|" + DOUBLE, 'd': r"'(?:''|[^'])*'|" + r'"[^"]*"'}
COMMENT = {'c': r'//[^\n]*|/\*.*?\*/', 'p': r'\#[^\n]*', 's': r'(?<![^\s;])\#[^\n]*', 'n': r'\#[^\n]*|/\*.*?\*/', 'd': r'--[^\n]*|/\*.*?\*/'}
TOKEN = r'[A-Za-z_$][\w$]*|\d[\w.]*|[^\s\w]'
EXCLUDE = r'(^|/)(generated|vendor|third_party|node_modules|dist|build|target)/|\.min\.|\.lock$|-lock\.json$'
TEST = r'(^|/)(tests?(-[a-z]+)?|__tests__|specs?|e2e|fixtures)/|[._-](test|spec)\.|(Test|Suite|Spec)\.[a-z]+$|(^|/)test_[^/]*$'

def docstring_spans(text, path):
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError):
        print('measure.py: %s: this interpreter cannot parse it; its docstrings count as code' % path, file=sys.stderr)
        return [], []
    rows = text.split('\n')
    starts = [0]
    for row in rows:
        starts.append(starts[-1] + len(row) + 1)
    at = lambda line, col: starts[line - 1] + len(rows[line - 1].encode()[:col].decode(errors='ignore'))
    owners = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
    firsts = (node.body[0] for node in ast.walk(tree) if isinstance(node, owners) and node.body)
    spans = sorted((at(s.lineno, s.col_offset), at(s.end_lineno, s.end_col_offset)) for s in firsts
                   if isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant) and isinstance(s.value.value, str))
    return [a for a, _ in spans], [b for _, b in spans]

def measure(text, kind, path):
    doc_from, doc_to = docstring_spans(text, path) if kind == 'p' else ([], [])
    tokens, lines = 0, set()
    for m in re.finditer('(?P<s>%s)|(?P<c>%s)|(?P<t>%s)' % (STRING[kind], COMMENT[kind], TOKEN), text, re.S):
        doc = bisect.bisect_right(doc_from, m.start()) - 1
        if m.lastgroup == 'c' or (doc >= 0 and m.start() < doc_to[doc]):
            continue  # comments and docstrings count as nothing
        first = text.count('\n', 0, m.start())
        if m.lastgroup == 's':  # a string counts the tokens inside it and the non-blank lines it spans: embedded SQL is code
            tokens += len(re.findall(TOKEN, m.group()))
            lines.update(first + i for i, part in enumerate(m.group().split('\n')) if part.strip())
        else:
            tokens += 1
            lines.add(first)
    return len(lines), tokens

def manifest(paths, depth, exclude, test):
    listing = subprocess.run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--'] + paths,
                             check=True, capture_output=True).stdout
    for path in sorted(os.fsdecode(raw) for raw in set(filter(None, listing.split(b'\0')))):
        kind = KIND.get(os.path.splitext(path)[1])
        if kind is None or (exclude and re.search(exclude, path)) or os.path.islink(path) or not os.path.isfile(path):
            continue  # other formats, excluded paths, symbolic links, files deleted from the work tree
        if not path.isprintable():
            sys.exit('measure.py: unsupported file name: %r' % path)
        with open(path, encoding='utf-8', errors='replace') as fh:
            text = fh.read()
        n_lines, n_tokens = measure(text, kind, path)
        role = 'test' if test and re.search(test, path) else 'prod'
        yield path, '/'.join(path.split('/')[:depth]), role, n_lines, n_tokens, len(text.encode())

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('paths', nargs='*'); ap.add_argument('--depth', type=int); ap.add_argument('--exclude'); ap.add_argument('--test')
ap.add_argument('--compare', metavar='BASELINE.tsv')
a = ap.parse_args()
if a.depth is not None and a.depth < 1:
    ap.error('--depth must be at least 1')
given = {k: v for k, v in (('paths', a.paths or None), ('depth', a.depth), ('exclude', a.exclude), ('test', a.test)) if v is not None}
old = {}
if a.compare:
    with open(a.compare, encoding='utf-8') as fh:
        head = fh.readline()
        if not head.startswith('#{'):
            sys.exit('measure.py: %s was not written by this version of the script; make the baseline again' % a.compare)
        args = json.loads(head[1:])
        if any(args[k] != v for k, v in given.items()):
            sys.exit('measure.py: arguments differ from the baseline %s; pass none to reuse them' % json.dumps(args))
        for line in fh:
            row = line.rstrip('\n').split('\t')
            if len(row) != 6:
                sys.exit('measure.py: malformed row in %s: %r' % (a.compare, line))
            old[row[0]] = row
else:
    if not a.paths:
        ap.error('PATH... is required without --compare')
    args = {'paths': a.paths, 'depth': 2, 'exclude': EXCLUDE, 'test': TEST, **given}
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
    now, was = rows.get(path), old.get(path)
    d_lines, d_tokens = ((int(now[i]) if now else 0) - (int(was[i]) if was else 0) for i in (3, 4))
    if now is None or was is None or d_lines or d_tokens:
        state = 'added' if was is None else 'removed' if now is None else 'changed'
        print('%-8s lines %+6d tokens %+7d  %s' % (state, d_lines, d_tokens, path), file=sys.stderr)
for part, role in sorted({k[:2] for k in total}):
    cur = [total[(part, role, name, 1)] for name in ('lines', 'tokens')]
    delta = '  delta lines %+d tokens %+d' % tuple(c - total[(part, role, name, -1)] for c, name in zip(cur, ('lines', 'tokens'))) if a.compare else ''
    print('%-28s %-4s lines %7d tokens %8d%s' % (part, role, *cur, delta), file=sys.stderr)
