// Static census of the design tokens actually used by the Chronicle dashboard stylesheets (and the shared account CSS).
// usage: node token-census.mjs [output.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url)), src = join(web, 'src'), account = join(web, '../../shared/account-web/account.css');
const cssFiles = readdirSync(src).filter(name => name.endsWith('.css')).map(name => join(src, name));
const tsx = readdirSync(src).filter(name => name.endsWith('.tsx') || name.endsWith('.ts')).map(name => readFileSync(join(src, name), 'utf8')).join('\n');

const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '');
/** Flattens CSS into {selector, declarations, media, file} rules; handles one level of @media/@container nesting. */
function rules(file, text) {
  const out = [], source = strip(text);
  let depth = 0, buffer = '', stack = [];
  for (const char of source) {
    if (char === '{') { stack.push(buffer.trim()); buffer = ''; depth++; }
    else if (char === '}') {
      const head = stack.pop(); depth--;
      if (!/^@(media|container|supports)/.test(head ?? '') && head !== undefined && !head.startsWith('@')) {
        const media = stack.filter(item => item.startsWith('@media') || item.startsWith('@container'));
        out.push({ file, selector: head, body: buffer, media });
      }
      buffer = '';
    } else buffer += char;
  }
  return out;
}
const all = [...cssFiles, account].flatMap(file => rules(file, readFileSync(file, 'utf8')));
const declarations = all.flatMap(rule => rule.body.split(';').map(part => part.trim()).filter(Boolean).map(part => { const at = part.indexOf(':'); return { ...rule, prop: part.slice(0, at).trim().toLowerCase(), value: part.slice(at + 1).trim() }; }).filter(item => item.prop.length > 0));
const count = (items, key) => { const map = new Map(); for (const item of items) { const k = key(item); map.set(k, (map.get(k) ?? 0) + 1); } return [...map.entries()].sort((a, b) => b[1] - a[1]); };
const lengthTokens = value => value.replace(/var\([^)]*\)/g, ' ').match(/-?\d*\.?\d+(?:px|rem|em|%|vh|vw|dvh|ch)?/g) ?? [];
const isThemeFile = rule => rule.file.endsWith('theme.css') || rule.file === account;

const fontSize = declarations.filter(item => item.prop === 'font-size').map(item => item.value);
const spacingProps = /^(margin|padding)(-(top|right|bottom|left|inline|block)(-(start|end))?)?$|^(gap|row-gap|column-gap)$/;
const spacing = declarations.filter(item => spacingProps.test(item.prop)).flatMap(item => item.value.split(/\s+/).filter(token => token !== 'auto' && !/^(0|0px)$/.test(token) && /\d|var/.test(token)).map(token => ({ token, prop: item.prop })));
const radius = declarations.filter(item => /^border(-[a-z]+)*-radius$/.test(item.prop)).map(item => item.value);
const shadow = declarations.filter(item => item.prop === 'box-shadow').map(item => item.value);
const literalColour = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const colourDecls = declarations.filter(item => !item.prop.startsWith('--') || !isThemeFile(item)).flatMap(item => (item.value.match(literalColour) ?? []).map(value => ({ value: value.toLowerCase(), file: item.file, prop: item.prop })));
const themeDefs = declarations.filter(item => item.prop.startsWith('--') && isThemeFile(item));
const customDefs = declarations.filter(item => item.prop.startsWith('--'));
const used = declarations.flatMap(item => [...item.value.matchAll(/var\((--[\w-]+)/g)].map(match => match[1]));
const definedNames = new Set(customDefs.map(item => item.prop)), usedNames = new Set(used);
const classes = new Set(all.flatMap(rule => [...rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].map(match => match[1])));
const dead = [...classes].filter(name => !tsx.includes(name));
const zIndex = declarations.filter(item => item.prop === 'z-index').map(item => item.value);
const fontFamily = declarations.filter(item => item.prop === 'font-family' || (item.prop === 'font' && /\//.test(item.value))).map(item => item.value);
const breakpoints = all.flatMap(rule => rule.media).map(text => text.replace(/\s+/g, ' '));
const lineHeight = declarations.filter(item => item.prop === 'line-height').map(item => item.value);
const letterSpacing = declarations.filter(item => item.prop === 'letter-spacing').map(item => item.value);
const durations = declarations.filter(item => item.prop === 'transition' || item.prop === 'animation').map(item => item.value);
const important = declarations.filter(item => /!important/.test(item.value)).length;
const perFile = cssFiles.concat(account).map(file => ({ file: file.replace(web, ''), bytes: readFileSync(file).length, rules: all.filter(rule => rule.file === file).length }));
const sizeBuckets = values => {
  const px = values.map(value => { const m = /^(-?\d*\.?\d+)(px|rem|em)$/.exec(value); return m === null ? null : m[2] === 'px' ? +m[1] : +m[1] * (m[2] === 'rem' ? 14 : 14); }).filter(value => value !== null);
  return { distinct: new Set(px).size, values: [...new Set(px)].sort((a, b) => a - b) };
};
const lengths = tokens => count(tokens.map(token => ({ token })), item => item.token).map(([token, n]) => ({ token, n }));

const result = {
  generatedFrom: { cssFiles: perFile.length, declarations: declarations.length, rules: all.length },
  perFile,
  fontSizes: { occurrences: fontSize.length, distinctLiterals: new Set(fontSize).size, distinctPxEquivalent: sizeBuckets(fontSize), histogram: lengths(fontSize), usingVar: fontSize.filter(value => value.includes('var(')).length },
  spacing: { occurrences: spacing.length, distinctTokens: new Set(spacing.map(item => item.token)).size, distinctPxEquivalent: sizeBuckets(spacing.map(item => item.token)), usingSpaceVars: spacing.filter(item => item.token.includes('var(--space')).length, histogram: lengths(spacing.map(item => item.token)).slice(0, 60) },
  radii: { occurrences: radius.length, distinct: [...new Set(radius)].sort(), histogram: lengths(radius) },
  shadows: { occurrences: shadow.length, distinct: [...new Set(shadow)] },
  colours: { literalOccurrencesOutsideThemeTokens: colourDecls.length, distinctLiteralsOutsideThemeTokens: new Set(colourDecls.map(item => item.value)).size, byFile: count(colourDecls, item => item.file.replace(web, '')), literals: count(colourDecls, item => item.value).slice(0, 40) },
  customProperties: { definedInThemeFiles: new Set(themeDefs.map(item => item.prop)).size, definedAnywhere: definedNames.size, referencedViaVar: usedNames.size, definedButNeverReferenced: [...definedNames].filter(name => !usedNames.has(name)), referencedButUndefined: [...usedNames].filter(name => !definedNames.has(name)), accountCssOwnVariables: customDefs.filter(item => item.file === account).map(item => item.prop).filter((name, i, all) => all.indexOf(name) === i), lightValues: themeDefs.filter(item => item.selector === ':root' ).length, darkValues: themeDefs.filter(item => item.selector.includes('dark')).length },
  fontFamilies: [...new Set(fontFamily)],
  lineHeights: [...new Set(lineHeight)].sort(), letterSpacings: [...new Set(letterSpacing)].sort(),
  zIndex: [...new Set(zIndex)].sort((a, b) => Number(a) - Number(b)), breakpoints: count(breakpoints.map(text => ({ text })), item => item.text),
  transitions: [...new Set(durations)], importantDeclarations: important,
  unreferencedClassSelectors: { count: dead.length, ofTotal: classes.size, names: dead.sort(), caveat: 'substring search in src/*.ts(x); dynamic class names (e.g. state-${x}) can yield false positives' },
};
const output = process.argv[2];
if (output !== undefined) writeFileSync(output, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ fontSizeDistinct: result.fontSizes.distinctLiterals, fontSizePxDistinct: result.fontSizes.distinctPxEquivalent.distinct, spacingDistinct: result.spacing.distinctTokens, spacingPx: result.spacing.distinctPxEquivalent.distinct, radii: result.radii.distinct.length, shadows: result.shadows.distinct.length, colourLiterals: result.colours.distinctLiteralsOutsideThemeTokens, deadClasses: dead.length, classes: classes.size, important }, null, 1));
