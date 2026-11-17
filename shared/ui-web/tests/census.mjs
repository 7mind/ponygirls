#!/usr/bin/env node
// Static design-system conformance check (spec §8 item 6).
//   node shared/ui-web/tests/census.mjs [file.css …]      (default: shared/ui-web/components.css)
// tokens.css is always checked for theme completeness; every given file is checked against it:
//   * every var(--x) is defined in tokens.css or in one of the given files;
//   * no colour literal (hex, colour functions, named colours);
//   * font-size is a size token of tokens.css (or inherit);
//   * margin / padding / gap use length tokens (0, auto and 1px hairlines excepted);
//   * border-radius uses radius tokens (0 and 50% excepted);
//   * box-shadow uses shadow/ring tokens; flat rings `[inset] 0 0 0 <w> var(--colour)` are border substitutes.
// Exit status 1 and one line per violation (file:line property: value — reason) when anything fails.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

const shown = file => { const path = relative(process.cwd(), file); return path.startsWith('..') ? file : path; };

const TOKENS_FILE = fileURLToPath(new URL('../tokens.css', import.meta.url));
const DEFAULT_FILES = [fileURLToPath(new URL('../components.css', import.meta.url))];
const LIGHT_SELECTOR = ':root';
const DARK_SELECTOR = ':root[data-theme="dark"]';
const APP_SELECTOR = /^:root\[data-app="([a-z]+)"\]$/;
const APP_DARK_SELECTOR = /^:root\[data-app="([a-z]+)"\]\[data-theme="dark"\]$/;
// Deliberately identical in both themes (scanners need black on white).
const THEME_INVARIANT = new Set(['--qr-fg', '--qr-bg']);
const SIZE_TOKEN_PREFIX = '--text-';
const RADIUS_TOKEN_PREFIX = '--radius-';
const SHADOW_TOKEN_PREFIXES = ['--shadow-', '--ring'];
const SPACING_PROPERTY = /^(margin|padding)(-(top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end))?$|^(row-|column-)?gap$/;
const RADIUS_PROPERTY = /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/;
const SPACING_KEYWORDS = new Set(['0', 'auto', '1px', 'inherit']);
const RADIUS_KEYWORDS = new Set(['0', '50%', 'inherit']);
const NAMED_COLOURS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));
const COLOUR_FUNCTION = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const HEX_COLOUR = /#[0-9a-f]{3,8}\b/i;

/** Splits a stylesheet into declarations with their enclosing selector chain and line numbers. */
function parse(text) {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
  const declarations = [], stack = [];
  let start = 0, depth = 0, quote = null;
  const lineAt = index => source.slice(0, index).split('\n').length;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote !== null) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth > 0 || (c !== '{' && c !== '}' && c !== ';')) continue;
    const segment = source.slice(start, i), offset = start + segment.search(/\S|$/);
    const trimmed = segment.trim();
    if (c === '{') stack.push(trimmed.replace(/\s+/g, ' '));
    else if (trimmed.length > 0 && !trimmed.startsWith('@')) {
      const colon = trimmed.indexOf(':');
      if (colon < 0) throw new Error(`unparsable declaration at line ${lineAt(offset)}: ${trimmed}`);
      declarations.push({ property: trimmed.slice(0, colon).trim().toLowerCase(), value: trimmed.slice(colon + 1).trim(), context: [...stack], line: lineAt(offset) });
    }
    if (c === '}') { if (stack.length === 0) throw new Error(`unbalanced "}" at line ${lineAt(i)}`); stack.pop(); }
    start = i + 1;
  }
  if (stack.length !== 0) throw new Error(`unclosed block: ${stack.at(-1)}`);
  return declarations;
}

const stripStrings = value => value.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""').replace(/url\([^)]*\)/gi, 'url()');
const references = value => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(match => match[1]);
function colourLiteral(value) {
  const plain = stripStrings(value).replace(/--[\w-]+/g, '');
  if (HEX_COLOUR.test(plain)) return plain.match(HEX_COLOUR)[0];
  if (COLOUR_FUNCTION.test(plain)) return plain.match(COLOUR_FUNCTION)[0];
  return plain.toLowerCase().split(/[^a-z]+/).find(word => NAMED_COLOURS.has(word)) ?? null;
}
// Splits on top-level whitespace and commas, keeping var()/calc() groups whole.
function terms(value) {
  const result = []; let current = '', depth = 0;
  for (const c of value) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth === 0 && (/\s/.test(c) || c === ',')) { if (current.length > 0) result.push(current); current = ''; if (c === ',') result.push(','); }
    else current += c;
  }
  if (current.length > 0) result.push(current);
  return result;
}
const tokenTerm = (term, accepts) => { const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(term); return match !== null && accepts(match[1]); };
// calc() over tokens and unitless factors only.
const tokenCalc = (term, accepts) => /^calc\(/.test(term) && /^[\s\d.+\-*/()]*$/.test(term.slice(4).replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, name) => accepts(name) ? '' : 'x'));

function loadTokens() {
  const declarations = parse(readFileSync(TOKENS_FILE, 'utf8'));
  const blocks = new Map();
  for (const declaration of declarations.filter(d => d.property.startsWith('--'))) {
    const selector = declaration.context.filter(entry => !entry.startsWith('@layer')).join(' ');
    if (!blocks.has(selector)) blocks.set(selector, new Map());
    blocks.get(selector).set(declaration.property, declaration);
  }
  const base = blocks.get(LIGHT_SELECTOR), dark = blocks.get(DARK_SELECTOR);
  if (base === undefined || dark === undefined) throw new Error(`${TOKENS_FILE} must define ${LIGHT_SELECTOR} and ${DARK_SELECTOR}`);
  const problems = [];
  const where = declaration => `${shown(TOKENS_FILE)}:${declaration.line}`;
  for (const [name, declaration] of base)
    if (colourLiteral(declaration.value) !== null && !THEME_INVARIANT.has(name) && !dark.has(name)) problems.push(`${where(declaration)} ${name} — colour token has no ${DARK_SELECTOR} value`);
  for (const [selector, block] of blocks) {
    for (const [name, declaration] of block) if (!base.has(name)) problems.push(`${where(declaration)} ${name} — defined only under ${selector}, not under ${LIGHT_SELECTOR}`);
    const app = APP_SELECTOR.exec(selector)?.[1];
    if (app === undefined) continue;
    const appDark = [...blocks].find(([other]) => APP_DARK_SELECTOR.exec(other)?.[1] === app)?.[1];
    if (appDark === undefined) { problems.push(`${shown(TOKENS_FILE)} ${selector} — no dark counterpart`); continue; }
    for (const name of new Set([...block.keys(), ...appDark.keys()])) if (!block.has(name) || !appDark.has(name)) problems.push(`${shown(TOKENS_FILE)} ${name} — app "${app}" overrides it in only one theme`);
  }
  for (const declaration of declarations) for (const name of references(declaration.value)) if (!base.has(name)) problems.push(`${where(declaration)} ${declaration.property} — var(${name}) is not defined`);
  return { names: base, problems };
}

function check(files, tokens) {
  const parsed = files.map(file => ({ file, declarations: parse(readFileSync(file, 'utf8')) }));
  const local = new Set(parsed.flatMap(({ declarations }) => declarations.filter(d => d.property.startsWith('--')).map(d => d.property)));
  const isLength = name => /^-?[\d.]+(px|em|rem)$/.test(tokens.names.get(name)?.value ?? '');
  const sizeToken = name => name.startsWith(SIZE_TOKEN_PREFIX) && isLength(name);
  const lengthToken = name => isLength(name);
  const radiusToken = name => name.startsWith(RADIUS_TOKEN_PREFIX) && tokens.names.has(name);
  const shadowToken = name => SHADOW_TOKEN_PREFIXES.some(prefix => name.startsWith(prefix)) && tokens.names.has(name);
  const colourToken = name => tokens.names.has(name) && colourLiteral(tokens.names.get(name).value) !== null;
  const problems = [];
  for (const { file, declarations } of parsed) for (const { property, value, line } of declarations) {
    const fail = reason => problems.push(`${shown(file)}:${line} ${property}: ${value} — ${reason}`);
    const bare = value.replace(/\s*!important$/, '');
    for (const name of references(value)) if (!tokens.names.has(name) && !local.has(name)) fail(`var(${name}) is not defined in tokens.css`);
    const colour = colourLiteral(value);
    if (colour !== null) fail(`colour literal ${colour}`);
    if (property === 'font-size' && bare !== 'inherit' && !tokenTerm(bare, sizeToken)) fail('font-size must be a type-scale token');
    if (property === 'font' && /\d(px|rem|em|pt|%)/.test(stripStrings(bare))) fail('font shorthand with a literal size');
    if (SPACING_PROPERTY.test(property))
      for (const term of terms(bare)) if (!SPACING_KEYWORDS.has(term) && !tokenTerm(term, lengthToken) && !tokenCalc(term, lengthToken)) fail(`spacing ${term} is not a space token`);
    if (RADIUS_PROPERTY.test(property))
      for (const term of terms(bare)) if (term !== '/' && !RADIUS_KEYWORDS.has(term) && !tokenTerm(term, radiusToken)) fail(`radius ${term} is not a radius token`);
    if (property === 'box-shadow' && bare !== 'none') {
      const layers = bare.split(/,(?![^(]*\))/).map(layer => layer.trim());
      for (const layer of layers) {
        const ring = /^(inset\s+)?0\s+0\s+0\s+[\d.]+px\s+(var\(\s*--[\w-]+\s*\))$/.exec(layer);
        if (!tokenTerm(layer, shadowToken) && !(ring !== null && tokenTerm(ring[2], colourToken))) fail(`shadow ${layer} is neither a shadow token nor a flat token-coloured ring`);
      }
    }
  }
  return problems;
}

const files = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_FILES;
const tokens = loadTokens();
const problems = [...new Set([...tokens.problems, ...check(files, tokens)])];
for (const problem of problems) console.log(problem);
console.log(`census: ${files.length} file(s) checked against tokens.css — ${problems.length} violation(s)`);
process.exitCode = problems.length === 0 ? 0 : 1;
