import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileSyntax, fenceSyntax, highlightTokens, HIGHLIGHT_LIMIT } from '../src/syntax.js';
import { tokenLines } from '../src/tokens.js';

// Behavioral / Active / Blackbox / Atomic; file-name and info-string resolution against the bundled grammars.
const language = path => fileSyntax(path).language;
const format = path => fileSyntax(path).format;
const classed = (text, name) => highlightTokens(text, name).filter(token => token.cls);

test('source and configuration files resolve to a bundled grammar by extension', () => {
  const expected = {
    'a.py': 'py', 'a.pyi': 'python', 'a.c': 'c', 'a.h': 'h', 'a.cc': 'cc', 'a.cpp': 'cpp', 'a.cxx': 'cxx', 'a.hh': 'hh', 'a.hpp': 'hpp', 'A.java': 'java', 'a.kt': 'kt', 'a.kts': 'kts',
    'A.scala': 'scala', 'a.sc': 'scala', 'build.sbt': 'scala', 'a.go': 'go', 'a.rs': 'rs', 'a.rb': 'rb', 'a.js': 'js', 'a.mjs': 'mjs', 'a.cjs': 'cjs', 'a.jsx': 'jsx', 'a.ts': 'ts', 'a.tsx': 'tsx',
    'a.sh': 'sh', 'a.bash': 'bash', 'a.zsh': 'zsh', 'a.nix': 'nix', 'a.sql': 'sql', 'a.lua': 'lua', 'a.r': 'r', 'a.css': 'css', 'a.xml': 'xml', 'a.proto': 'protobuf', 'a.tex': 'latex',
    'a.yaml': 'yaml', 'a.yml': 'yml', 'a.toml': 'toml', 'a.ini': 'ini', 'a.cfg': 'ini', 'a.conf': 'ini', 'prod.env': 'ini', 'a.json': 'json', 'a.jsonl': 'json', 'a.ndjson': 'json',
    'a.swift': 'swift', 'a.cs': 'cs', 'a.php': 'php', 'a.hs': 'haskell', 'a.ex': 'elixir', 'a.erl': 'erlang', 'a.clj': 'clojure', 'a.ml': 'ocaml', 'a.dart': 'dart', 'a.groovy': 'groovy',
    'build.gradle': 'groovy', 'a.ps1': 'powershell', 'a.properties': 'properties', 'a.cmake': 'cmake', 'defs.bzl': 'python', 'a.graphql': 'graphql', 'a.scss': 'scss', 'a.mk': 'mk',
  };
  for (const [path, name] of Object.entries(expected)) assert.equal(language(`dir/${path}`), name, path);
  assert.equal(language('SHOUT.PY'), 'py', 'extensions are case-insensitive');
});

test('well-known file names resolve without an extension', () => {
  const expected = { Makefile: 'makefile', GNUmakefile: 'makefile', Dockerfile: 'dockerfile', 'Dockerfile.prod': 'dockerfile', Containerfile: 'dockerfile', 'CMakeLists.txt': 'cmake',
    BUILD: 'python', 'BUILD.bazel': 'python', WORKSPACE: 'python', 'MODULE.bazel': 'python', 'Cargo.lock': 'ini', 'flake.lock': 'json', Gemfile: 'ruby', Jenkinsfile: 'groovy',
    '.bashrc': 'bash', '.gitconfig': 'ini', '.editorconfig': 'ini', '.env': 'ini', 'nginx.conf': 'nginx' };
  for (const [name, grammar] of Object.entries(expected)) assert.equal(language(`repo/${name}`), grammar, name);
  for (const name of ['makefile', 'DOCKERFILE', 'cmakelists.txt']) assert.notEqual(language(name), null, `${name}: conventional names in any case`);
  for (const name of ['build', 'workspace', 'Build']) assert.equal(language(name), null, `${name}: only the Bazel spelling is a Bazel file`);
});

test('plain text, logs, unknown extensions and bare names get no grammar', () => {
  for (const path of ['notes.txt', 'NOTES.TEXT', 'run.log', 'out.stdout', 'data.csv', 'data.tsv', 'fix.diff', 'fix.patch', 'LICENSE', 'README', '.gitignore', 'archive.xyz', 'yarn.lock', 'a.m', 'weird.']) {
    assert.equal(language(path), null, path);
  }
});

test('structural formats: diff, JSON, JSON Lines and delimited tables', () => {
  const expected = { 'a.diff': 'diff', 'a.patch': 'diff', 'a.json': 'json', 'flake.lock': 'json', 'notebook.ipynb': 'json', 'a.jsonl': 'jsonl', 'a.ndjson': 'jsonl', 'a.csv': 'csv', 'a.tsv': 'tsv', 'a.py': 'text', 'a.txt': 'text', Makefile: 'text', 'a.yaml': 'text', 'a.json5': 'text' };
  for (const [path, name] of Object.entries(expected)) assert.equal(format(path), name, path);
});

test('fenced code blocks resolve by info string, including common short names', () => {
  const expected = { python: 'python', py: 'py', sh: 'sh', bash: 'bash', shell: 'shell', console: 'console', yaml: 'yaml', yml: 'yml', json: 'json', jsonl: 'json', scala: 'scala', sbt: 'scala', kotlin: 'kotlin', kt: 'kt',
    'c++': 'c++', cpp: 'cpp', go: 'go', golang: 'golang', rust: 'rust', rs: 'rs', ts: 'ts', typescript: 'typescript', js: 'js', nix: 'nix', sql: 'sql', toml: 'toml', dockerfile: 'dockerfile', docker: 'docker',
    xml: 'xml', html: 'html', Python: 'python', JSON: 'json' };
  for (const [info, name] of Object.entries(expected)) assert.deepEqual(fenceSyntax(info), { format: 'text', language: name }, info);
  for (const info of ['diff', 'patch', 'Diff']) assert.deepEqual(fenceSyntax(info), { format: 'diff', language: null }, info);
  for (const info of ['', 'text', 'txt', 'plaintext', 'plain', 'output', 'mermaid', 'unknown-language', 'csv']) assert.deepEqual(fenceSyntax(info), { format: 'text', language: null }, info);
});

test('every grammar name that file and fence resolution return is accepted by the highlighter', () => {
  const paths = ['a.py', 'a.h', 'a.hpp', 'a.kts', 'build.sbt', 'a.zsh', 'a.toml', 'a.conf', 'a.jsonl', 'a.ex', 'a.ml', 'a.ps1', 'a.proto', 'a.tex', 'defs.bzl', 'Makefile', 'Dockerfile.prod', 'CMakeLists.txt', 'BUILD', 'Cargo.lock', 'Gemfile', 'Jenkinsfile', '.bashrc', 'nginx.conf', 'a.groovy', 'a.dart', 'a.clj', 'a.erl', 'a.hs', 'a.properties', 'a.nix', 'A.scala'];
  for (const path of paths) assert.doesNotThrow(() => highlightTokens('x = 1\n', language(path)), path);
  for (const info of ['py', 'c++', 'golang', 'console', 'docker', 'html', 'sbt']) assert.doesNotThrow(() => highlightTokens('x = 1\n', fenceSyntax(info).language), info);
});

test('tokens carry the classes of their innermost scope and reproduce the text exactly', () => {
  const python = 'def load(path):\n    """Doc\n    string."""\n    return f"{path!r}: {1 + 2.5}"  # note\n';
  const tokens = highlightTokens(python, 'python');
  assert.equal(tokens.map(token => token.text).join(''), python);
  const by = cls => tokens.filter(token => token.cls === cls).map(token => token.text);
  assert.deepEqual(by('hljs-keyword'), ['def', 'return']);
  assert.deepEqual(by('hljs-title function_'), ['load']);
  assert.deepEqual(by('hljs-comment'), ['# note']);
  assert.ok(by('hljs-string').includes('"""Doc\n    string."""'), 'a multi-line string is one token');
  assert.ok(by('hljs-number').includes('2.5'), 'a number inside an interpolation is classed as a number, not as the string around it');
  assert.equal(tokenLines(tokens).length, 4);
  for (const [text, name, cls, word] of [['val x: Int = 1 // c\n', 'scala', 'hljs-keyword', 'val'], ['func main() {}\n', 'go', 'hljs-keyword', 'func'], ['fun f(): Int = 1\n', 'kotlin', 'hljs-keyword', 'fun'],
    ['#include <vector>\nint main() { return 0; }\n', 'cpp', 'hljs-keyword', 'return'], ['public class A {}\n', 'java', 'hljs-keyword', 'public'], ['if [ -f x ]; then echo hi; fi\n', 'bash', 'hljs-keyword', 'if'],
    ['key: value\n', 'yaml', 'hljs-attr', 'key:'], ['{"k": [1, true]}\n', 'json', 'hljs-attr', '"k"'], ['{ x = 1; }\n', 'nix', 'hljs-number', '1']]) {
    assert.ok(classed(text, name).some(token => token.cls === cls && token.text === word), `${name}: ${cls} ${word} in ${JSON.stringify(classed(text, name))}`);
    assert.equal(highlightTokens(text, name).map(token => token.text).join(''), text, name);
  }
});

test('markup in the highlighted text stays text', () => {
  const html = '<script>alert(1)</script> "<img src=x onerror=1>"\n';
  for (const name of ['xml', 'js', 'python']) {
    const tokens = highlightTokens(html, name);
    assert.equal(tokens.map(token => token.text).join(''), html, name);
    for (const token of tokens) assert.match(token.cls, /^(?:hljs-[a-z_]+(?: [a-z_]+)*)?$/, `class list ${JSON.stringify(token.cls)}`);
  }
});

test('the highlighting limit is 256 KiB of text', () => { assert.equal(HIGHLIGHT_LIMIT, 256 * 1024); });
