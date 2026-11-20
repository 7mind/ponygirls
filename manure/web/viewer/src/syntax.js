// Which rendering a text file or a fenced code block gets: a structural format (diff, JSON, delimited table) and
// a highlight.js grammar. Names are resolved here, next to the grammars the bundle actually contains.
import { createLowlight, common } from 'lowlight';
import clojure from 'highlight.js/lib/languages/clojure';
import cmake from 'highlight.js/lib/languages/cmake';
import dart from 'highlight.js/lib/languages/dart';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import elixir from 'highlight.js/lib/languages/elixir';
import erlang from 'highlight.js/lib/languages/erlang';
import groovy from 'highlight.js/lib/languages/groovy';
import haskell from 'highlight.js/lib/languages/haskell';
import latex from 'highlight.js/lib/languages/latex';
import nginx from 'highlight.js/lib/languages/nginx';
import nix from 'highlight.js/lib/languages/nix';
import ocaml from 'highlight.js/lib/languages/ocaml';
import powershell from 'highlight.js/lib/languages/powershell';
import properties from 'highlight.js/lib/languages/properties';
import protobuf from 'highlight.js/lib/languages/protobuf';
import scala from 'highlight.js/lib/languages/scala';

const lowlight = createLowlight({ ...common, clojure, cmake, dart, dockerfile, elixir, erlang, groovy, haskell, latex, nginx, nix, ocaml, powershell, properties, protobuf, scala });

/** Text above this size is shown without highlighting: tokenising and one element per token grow with it. */
export const HIGHLIGHT_LIMIT = 256 * 1024;

export const FORMAT_TEXT = 'text';
export const FORMAT_DIFF = 'diff';
export const FORMAT_JSON = 'json';
export const FORMAT_JSON_LINES = 'jsonl';
export const FORMAT_CSV = 'csv';
export const FORMAT_TSV = 'tsv';

const EXTENSION_FORMAT = { diff: FORMAT_DIFF, patch: FORMAT_DIFF, json: FORMAT_JSON, ipynb: FORMAT_JSON, jsonl: FORMAT_JSON_LINES, ndjson: FORMAT_JSON_LINES, csv: FORMAT_CSV, tsv: FORMAT_TSV };
const NAME_FORMAT = { 'flake.lock': FORMAT_JSON };
// Extensions that are not themselves a grammar name or alias of highlight.js.
const EXTENSION_LANGUAGE = {
  jsonl: 'json', ndjson: 'json', ipynb: 'json', sbt: 'scala', sc: 'scala', conf: 'ini', cfg: 'ini', env: 'ini', gradle: 'groovy',
  bzl: 'python', bazel: 'python', star: 'python', pyi: 'python', hs: 'haskell', ex: 'elixir', exs: 'elixir', erl: 'erlang',
  clj: 'clojure', cljs: 'clojure', ml: 'ocaml', mli: 'ocaml', tex: 'latex', proto: 'protobuf', ps1: 'powershell', mm: 'objectivec',
};
const NAME_LANGUAGE = {
  makefile: 'makefile', gnumakefile: 'makefile', dockerfile: 'dockerfile', containerfile: 'dockerfile', 'cmakelists.txt': 'cmake',
  'flake.lock': 'json', 'cargo.lock': 'ini', 'poetry.lock': 'ini', 'uv.lock': 'ini', pipfile: 'ini',
  gemfile: 'ruby', rakefile: 'ruby', vagrantfile: 'ruby', jenkinsfile: 'groovy', 'nginx.conf': 'nginx',
  '.bashrc': 'bash', '.bash_profile': 'bash', '.profile': 'bash', '.zshrc': 'bash', '.gitconfig': 'ini', '.editorconfig': 'ini', '.npmrc': 'ini',
};
// Bazel files are recognised in their conventional spelling only: `build` is also an ordinary script name.
const EXACT_NAME_LANGUAGE = { BUILD: 'python', 'BUILD.bazel': 'python', WORKSPACE: 'python', 'WORKSPACE.bazel': 'python', 'MODULE.bazel': 'python' };
const DOCKERFILE_PREFIX = 'dockerfile.';
// highlight.js registers plain text as a grammar; it marks nothing.
const UNMARKED = new Set(['plaintext', 'text', 'txt']);

/** The grammar name or alias when the bundle has that grammar, otherwise null. */
function grammar(name) { return name && !UNMARKED.has(name) && lowlight.registered(name) ? name : null; }

/** `{format, language}` of a file by its name; `language` is null when no grammar applies. */
export function fileSyntax(path) {
  const written = path.split('/').at(-1);
  const name = written.toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const format = NAME_FORMAT[name] ?? EXTENSION_FORMAT[extension] ?? FORMAT_TEXT;
  const named = EXACT_NAME_LANGUAGE[written] ?? NAME_LANGUAGE[name] ?? (name.startsWith(DOCKERFILE_PREFIX) ? 'dockerfile' : EXTENSION_LANGUAGE[extension]);
  // A diff is coloured by its own line classification, not by a grammar.
  return { format, language: format === FORMAT_DIFF ? null : grammar(named ?? extension) };
}

/** `{format, language}` of a fenced code block by the first word of its info string. */
export function fenceSyntax(info) {
  const name = info.toLowerCase();
  if (EXTENSION_FORMAT[name] === FORMAT_DIFF) return { format: FORMAT_DIFF, language: null };
  return { format: FORMAT_TEXT, language: grammar(EXTENSION_LANGUAGE[name] ?? name) };
}

function flatten(node, cls, tokens) {
  if (node.type === 'text') tokens.push({ cls, text: node.value });
  else for (const child of node.children) flatten(child, node.type === 'element' ? node.properties.className.join(' ') : cls, tokens);
  return tokens;
}

/** Tokens of `text` under a grammar accepted by fileSyntax/fenceSyntax; each run has the classes of its innermost scope. */
export function highlightTokens(text, language) { return flatten(lowlight.highlight(language, text), '', []); }
