import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toHast } from 'mdast-util-to-hast';
import { raw } from 'hast-util-raw';
import { toHtml } from 'hast-util-to-html';

/** @typedef {{start:number, end:number, markdown:boolean}} SourceRange */
/** @typedef {{kind:'section'|'table', start:number, end:number}} MarkdownSource */

function visit(node, action) {
  action(node);
  if ('children' in node) for (const child of node.children) visit(child, action);
}
function depth(node) { return node.type === 'element' && /^h[1-6]$/.test(node.tagName) ? Number(node.tagName[1]) : 0; }

// Raw HTML in a quote/list has container prefixes removed. hast-util-raw's
// offsets advance through that stripped value, so map each physical line back.
function htmlLines(node, text) {
  const original = text.slice(node.position.start.offset, node.position.end.offset);
  const lines = value => value.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g).filter(Boolean);
  const sourceLines = lines(original);
  const valueLines = lines(node.value);
  if (sourceLines.length !== valueLines.length) throw new Error('HTML source line mapping is inconsistent.');
  let source = node.position.start.offset;
  let value = source;
  return valueLines.map((line, index) => {
    const content = line.trimStart();
    if (!sourceLines[index].endsWith(content)) throw new Error('HTML source content mapping is inconsistent.');
    const result = {start:value, end:value + line.length, content:value + line.length - content.length, source:source + sourceLines[index].length - content.length};
    source += sourceLines[index].length; value += line.length;
    return result;
  });
}

/** Render with original UTF-16 offsets. Returned HTML still requires sanitization. */
export function renderMarkdown(text) {
  // Match the existing GFM dialect: footnote-like syntax is a reference link,
  // not a generated footnote section with no original heading source.
  const dialect = {disable:{null:['gfmFootnoteDefinition','gfmFootnoteCall','gfmPotentialFootnoteCall']}};
  const ast = fromMarkdown(text, {extensions:[gfm(), dialect], mdastExtensions:[gfmFromMarkdown()]});
  const html = toHast(ast, {allowDangerousHtml:true});
  const generated = new Map();
  const htmlMaps = [];
  // Uploaded attributes cannot impersonate generated nodes during HTML repair.
  const nonce = [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16)).join('-');
  visit(html, node => {
    if (node.type === 'raw') htmlMaps.push(...htmlLines(node, text));
    if (node.type !== 'element') return;
    if (node.tagName === 'input') {
      const checked = node.properties.checked;
      node.tagName = 'span';
      node.properties = {role:'img', ariaLabel:checked ? 'Completed task' : 'Incomplete task'};
      node.children = [{type:'text', value:checked ? '☑' : '☐'}];
    }
    if (node.position) {
      const id = `${nonce}-${generated.size}`;
      generated.set(id, {start:node.position.start.offset, end:node.position.end.offset, markdown:true});
      node.properties.dataManureGenerated = id;
    }
  });
  htmlMaps.sort((a, b) => a.start - b.start);
  function originalOffset(offset, end) {
    let low = 0, high = htmlMaps.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (htmlMaps[middle].start < offset || (!end && htmlMaps[middle].start === offset)) low = middle + 1;
      else high = middle;
    }
    const line = htmlMaps[low - 1];
    return line && offset <= line.end ? line.source + Math.max(0, offset - line.content) : offset;
  }
  const tree = raw(html, {file:{value:text}});
  const ranges = new WeakMap();
  visit(tree, node => {
    let saved;
    if (node.type === 'element') {
      saved = generated.get(node.properties.dataManureGenerated);
      delete node.properties.dataManureGenerated;
      delete node.properties.dataManureSource;
    }
    if (saved) ranges.set(node, saved);
    else if (node.position && node.position.start && node.position.end) ranges.set(node, {start:originalOffset(node.position.start.offset, false), end:originalOffset(node.position.end.offset, true), markdown:false});
  });
  ranges.set(tree, {start:0, end:text.length, markdown:true});
  const lineEnd = end => end + (text.slice(end).match(/^(?:\r\n|\r|\n)/) || [''])[0].length;
  function blockStart(range) {
    const line = Math.max(text.lastIndexOf('\n', range.start - 1), text.lastIndexOf('\r', range.start - 1)) + 1;
    const prefix = text.slice(line, range.start);
    return range.markdown || /^(?:[\t >]|[-+*] |\d+[.)] )*$/.test(prefix) ? line : range.start;
  }
  function sourceEnd(node) {
    const range = ranges.get(node);
    if (range) return range.end;
    let end = 0;
    if ('children' in node) for (const child of node.children) end = Math.max(end, sourceEnd(child));
    return end;
  }
  /** @type {MarkdownSource[]} */
  const sources = [];
  function sections(parent, boundary) {
    if (!('children' in parent)) return;
    const ownRange = ranges.get(parent);
    let end = ownRange ? lineEnd(ownRange.end) : boundary;
    if (ownRange && !ownRange.markdown && parent.type === 'element') {
      end = boundary;
      let contentEnd = ownRange.start;
      for (const child of parent.children) contentEnd = Math.max(contentEnd, sourceEnd(child));
      const closing = text.slice(ownRange.start, ownRange.end).match(new RegExp(`</${parent.tagName}\\s*>$`, 'i'));
      // An inferred parent end may include a child's closing tag. Only trim a
      // closing tag outside all children; keep non-rendered definitions before it.
      if (closing && ownRange.end - closing[0].length >= contentEnd) {
        end = blockStart({start:ownRange.end - closing[0].length, end:ownRange.end, markdown:false});
      }
    }
    const starts = parent.children.map(node => ranges.get(node)).filter(Boolean).map(range => blockStart(range)).sort((a, b) => a - b);
    const stops = new WeakMap();
    const next = Array(7).fill(end);
    for (let index = parent.children.length - 1; index >= 0; index--) {
      const node = parent.children[index];
      const level = depth(node);
      if (!level) continue;
      stops.set(node, Math.min(...next.slice(1, level + 1)));
      const range = ranges.get(node);
      if (!range) throw new Error('Markdown section source is unavailable.');
      next[level] = blockStart(range);
    }
    for (let index = 0; index < parent.children.length; index++) {
      const node = parent.children[index];
      const range = ranges.get(node);
      const level = depth(node);
      if (level || (node.type === 'element' && node.tagName === 'table')) {
        if (!range || range.start < 0 || range.end > text.length || range.start >= range.end) throw new Error('Markdown source range is unavailable.');
        let stop = range.markdown ? lineEnd(range.end) : range.end;
        if (level) stop = stops.get(node);
        if (stop < range.end || stop > text.length) throw new Error('Markdown section boundary is inconsistent.');
        node.properties.dataManureSource = String(sources.length);
        sources.push({kind:level ? 'section' : 'table', start:blockStart(range), end:stop});
      }
      let boundary = end;
      if (range) {
        let low = 0, high = starts.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (starts[middle] < range.end) low = middle + 1; else high = middle;
        }
        if (low < starts.length) boundary = Math.min(end, starts[low]);
      }
      sections(node, boundary);
    }
  }
  sections(tree, text.length);
  return {html:toHtml(tree), sources};
}
