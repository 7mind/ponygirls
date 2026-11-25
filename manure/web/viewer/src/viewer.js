import { renderMarkdown } from './markdown.js';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { localUrl, artifactResourceUrl, markdownLinkUrl, boundedBytes, leadingBytes, lineRange, lineFragment, graphSource, diagramCount, TEXT_LIMIT, LINE_LIMIT } from './safety.js';
import { textLines, tokenLines } from './tokens.js';
import { diffLines } from './diff.js';
import { formatJson, formatJsonLines, JsonSyntaxError, JsonFormatLimitError } from './json.js';
import { parseCsv, parseCsvPart, numericColumns, CsvSyntaxError } from './csv.js';
import { hasAnsi, ansiTokens, escapeTokens } from './ansi.js';
import { parseAsciicast } from './asciicast.js';
import { fileSyntax, fenceSyntax, highlightTokens, HIGHLIGHT_LIMIT, FORMAT_DIFF, FORMAT_JSON, FORMAT_JSON_LINES, FORMAT_CSV, FORMAT_TSV } from './syntax.js';

const meta = document.querySelector('#manure-viewer').dataset;
const embedded = meta.embed === 'readme';
const content = document.querySelector('#content');
const status = document.querySelector('#status');
const raw = localUrl(meta.rawUrl);
const downloadUrl = localUrl(meta.downloadUrl) || '#';
const toolbar = document.querySelector('#viewer-meta');
const urls = new Set();
const ZOOM_STEP = 1.25;
const ZOOM_MIN = .1;
const ZOOM_MAX = 8;
const PERCENT = 100;
const CSS_PX_PER_PDF_POINT = 96 / 72;
const PDF_ZOOMS = [['width', 'Fit width'], ['page', 'Fit page'], ['1', '100 %'], ['1.5', '150 %']];
addEventListener('pagehide', () => { for (const url of urls) URL.revokeObjectURL(url); });
// Page chrome (icons for span[data-icon], toasts, theme menu, local times) belongs to the content shell's
// chrome.js; the viewer only emits placeholders and toast requests, and keeps working without it.
function iconSlot(name, ...classes) {
  const slot = document.createElement('span');
  slot.className = ['icon', ...classes].join(' ');
  slot.dataset.icon = name;
  slot.setAttribute('aria-hidden', 'true');
  return slot;
}
function toast(message) { document.dispatchEvent(new CustomEvent('manure:toast', { detail: message })); }
async function copyText(text, success) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard access is unavailable.');
  await navigator.clipboard.writeText(text);
  toast(success);
}
function element(tag, text, cls) { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; }
function errorText(error) { return error instanceof Error ? error.message : String(error); }
function button(label, action, cls = 'btn') { const el = element('button', label, cls); el.type = 'button'; el.addEventListener('click', action); return el; }
function iconButton(name, label, action) {
  const el = button('', action, 'btn btn-sm btn-icon');
  el.setAttribute('aria-label', label); el.title = label; el.append(iconSlot(name));
  return el;
}
const MINUS_SIGN = '\u2212';
function textButton(text, label, action) {
  const el = button(text, action, 'btn btn-sm btn-icon');
  el.setAttribute('aria-label', label); el.title = label;
  return el;
}
function downloadLink(cls) {
  const link = element('a', null, cls); link.href = downloadUrl; link.setAttribute('download', '');
  link.append(iconSlot('download', 'icon-sm'), document.createTextNode('Download original'));
  return link;
}
function tokenNodes(tokens) {
  const nodes = document.createDocumentFragment();
  for (const { cls, text } of tokens) nodes.append(cls ? element('span', text, cls) : text);
  return nodes;
}
function plainRows(text) { return textLines(text).map(line => [{ cls: '', text: line }]); }
/**
 * Lines of text, one block per row of tokens. The line number is generated content of an empty gutter link, so the
 * text of the element is exactly the text of the rows; `links` makes the numbers `#L<n>` links.
 */
function lineView(rows, classify, links, numbers) {
  const pre = element('pre', null, numbers ? 'raw' : 'raw no-lines');
  rows.forEach((tokens, index) => {
    const line = element('span', null, classify(index));
    if (numbers) {
      const number = element('a', null, 'ln'); number.setAttribute('aria-hidden', 'true');
      if (links) { number.href = `#L${index + 1}`; number.tabIndex = -1; }
      line.append(number);
    }
    line.append(tokenNodes(tokens));
    pre.append(line);
  });
  return pre;
}
function rawLines(text, classify) {
  const lines = textLines(text);
  return lineView(lines.map(line => [{ cls: '', text: line }]), index => classify(lines[index]), false, true);
}
/** Failure notice in place of a preview; the stored file is untouched and stays downloadable. */
function fail(error, target = content, source = null) {
  const notice = element('div', null, 'notice notice-danger'); notice.setAttribute('role', 'alert');
  const body = element('div');
  const diagramFailure = target.classList.contains('diagram') || (target === content && ['mermaid', 'graphviz'].includes(meta.kind));
  body.append(element('div', diagramFailure ? 'This diagram could not be rendered' : 'Preview unavailable', 'notice-title'),
    document.createTextNode(`${errorText(error)} The stored file is intact; only the preview failed.`));
  const parts = [notice];
  if (target === content) {
    const actions = element('div', null, 'notice-actions');
    actions.append(downloadLink('btn btn-sm btn-primary'));
    if (source !== null) {
      const view = rawLines(source, () => ''); view.setAttribute('aria-label', 'Raw source'); view.tabIndex = 0;
      const toggle = button('Hide raw source', () => {
        view.hidden = !view.hidden;
        toggle.textContent = view.hidden ? 'Show raw source' : 'Hide raw source';
      }, 'btn btn-sm');
      toggle.setAttribute('aria-controls', view.id = 'raw-source');
      actions.append(toggle);
      parts.push(view);
    }
    body.append(actions);
  }
  notice.append(iconSlot('alert'), body);
  target.replaceChildren(...parts);
}
/** Page toolbar in place of the plain meta line: tool controls left, file facts right. */
function tools(label, ...controls) {
  toolbar.classList.add('viewer-tools');
  toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', label);
  document.querySelector('#file-meta').classList.add('push');
  toolbar.prepend(...controls);
}
function segmented(label, options, select) {
  const group = element('div', null, 'segmented'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
  const buttons = options.map(([value, text]) => { const b = button(text, () => select(value), ''); b.dataset.value = value; return b; });
  group.append(...buttons);
  return { group, press: value => { for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === value)); } };
}
/** − / % / + and Fit | Actual size for one image; `fitHeight` applies any height limit of Fit. */
function zoomControls(img, fitHeight) {
  const percent = element('span', null, 'tool-value'); percent.setAttribute('aria-live', 'polite');
  const show = () => { if (img.naturalWidth) percent.textContent = `${Math.round(img.getBoundingClientRect().width / img.naturalWidth * PERCENT)} %`; };
  const width = value => { img.classList.remove('is-fit'); img.style.removeProperty('max-height'); img.style.setProperty('width', `${Math.max(1, value)}px`); show(); };
  const fit = () => { img.classList.add('is-fit'); img.style.removeProperty('width'); fitHeight(); show(); };
  const mode = segmented('Image size', [['fit', 'Fit'], ['actual', 'Actual size']], value => {
    mode.press(value);
    if (value === 'fit') fit(); else width(img.naturalWidth);
  });
  const zoom = factor => {
    const current = img.getBoundingClientRect().width / img.naturalWidth;
    mode.press(null);
    width(img.naturalWidth * Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current * factor)));
  };
  img.classList.add('is-fit');
  mode.press('fit');
  img.addEventListener('load', show);
  addEventListener('resize', () => { if (img.classList.contains('is-fit')) fitHeight(); show(); });
  return [textButton(MINUS_SIGN, 'Zoom out', () => zoom(1 / ZOOM_STEP)), percent, iconButton('plus', 'Zoom in', () => zoom(ZOOM_STEP)),
    element('span', null, 'vr'), mode.group];
}
function imageView(src, alt) {
  const stage = element('div', null, 'stage');
  const img = new Image(); img.alt = alt; img.src = src; img.className = 'stage-image';
  img.addEventListener('error', () => fail(new Error('The image could not be decoded.')));
  // Fit uses the height actually left under the sticky chrome, which wraps on narrow screens.
  const fitHeight = () => {
    const padding = parseFloat(getComputedStyle(stage).paddingTop) + parseFloat(getComputedStyle(stage).paddingBottom);
    img.style.setProperty('max-height', `${Math.max(1, innerHeight - toolbar.getBoundingClientRect().bottom - padding)}px`);
  };
  img.addEventListener('load', () => { document.querySelector('#file-facts').textContent = ` · ${img.naturalWidth} × ${img.naturalHeight}`; });
  tools('Image zoom', ...zoomControls(img, fitHeight));
  stage.append(img); content.append(stage);
  fitHeight();
  return img;
}
/** A diagram inside Markdown: fitted to the column, with hover/focus zoom tools; zoom extends the document, not a box. */
function inlineDiagram(src, alt, target) {
  const img = new Image(); img.alt = alt; img.src = src;
  img.addEventListener('error', () => fail(new Error('The diagram could not be decoded.'), target));
  const controls = element('div', null, 'diagram-tools');
  controls.setAttribute('role', 'toolbar'); controls.setAttribute('aria-label', 'Diagram zoom');
  controls.append(...zoomControls(img, () => {}));
  target.replaceChildren(controls, img);
  return img;
}
function svgImage(svg, target, alt, renderer) {
  if (svg.length > 8 * 1024 * 1024) throw new Error('Rendered diagram is too large.');
  const clean = DOMPurify.sanitize(svg, {USE_PROFILES:{svg:true, svgFilters:true}, FORBID_TAGS:['foreignObject','image','a','script','animate','set','animateTransform'], FORBID_ATTR:['href','xlink:href']});
  const url = URL.createObjectURL(new Blob([clean], {type:'image/svg+xml'})); urls.add(url);
  (target === content ? imageView(url, alt) : inlineDiagram(url, alt, target)).dataset.renderer = renderer;
}
function graphviz(text) {
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./graphviz-worker.js', import.meta.url), {type:'module'});
    const finish = (error, svg) => { clearTimeout(timer); worker.terminate(); error ? reject(new Error(error)) : resolve(svg); };
    const timer = setTimeout(() => finish('Diagram rendering exceeded the 10 second deadline.'), 10000);
    worker.onmessage = ({data}) => finish(data.error, data.svg);
    worker.onerror = () => finish('Graphviz worker failed.');
    worker.postMessage(text);
  });
}
// Mermaid colours follow the theme resolved at load; Graphviz output gets a light ground instead.
mermaid.initialize({startOnLoad:false, theme:document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default', securityLevel:'strict', htmlLabels:false, maxTextSize:50000, maxEdges:500, suppressErrorRendering:true, flowchart:{htmlLabels:false}, secure:['secure','securityLevel','htmlLabels','startOnLoad','maxTextSize','maxEdges','suppressErrorRendering','flowchart']});
let graphId = 0;
async function diagram(text, kind, target) {
  const source = graphSource(text);
  const renderer = ['dot','gv','graphviz'].includes(kind) ? 'graphviz' : 'mermaid';
  const svg = renderer === 'graphviz' ? await graphviz(source) : (await mermaid.render(`diagram-${++graphId}`, source)).svg;
  svgImage(svg,target,'Rendered diagram',renderer);
}
function sanitizedMarkdown(html) {
  // Rewrite in the inert sanitizer document, BEFORE creating any live image nodes.
  // Resolve against the original document URL, not the reserved viewer/raw route.
  const mount = raw.slice(0, raw.indexOf('/__manure/raw/'));
  const base = `${mount}/${meta.path.split('/').map(encodeURIComponent).join('/')}`;
  const mountPath = new URL(mount).pathname.replace(/\/$/, '');
  const purifier = DOMPurify(window);
  purifier.addHook('afterSanitizeAttributes', node => {
    for (const attr of ['src','href']) {
      if (!node.hasAttribute?.(attr)) continue;
      const value = node.getAttribute(attr);
      if (value.startsWith('#') && attr === 'href' && node.tagName !== 'A') continue;
      const url = node.tagName === 'A' && attr === 'href' ? markdownLinkUrl(value,base,mountPath) : artifactResourceUrl(value,base,mountPath);
      if (url) node.setAttribute(attr,url); else node.removeAttribute(attr);
    }
    if (node.tagName === 'A') node.setAttribute('rel','noopener noreferrer');
  });
  // data-icon is reserved for the page chrome's own icon placeholders.
  return purifier.sanitize(html, {USE_PROFILES:{html:true}, FORBID_TAGS:['style','iframe','object','embed','form','input','video','audio','source'], FORBID_ATTR:['style','srcset','background','data-icon']});
}
function markdownLinks(article) {
  const headings = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const counts = new Map();
  for (const node of [...document.querySelectorAll('[id]'), ...article.querySelectorAll('[id]')]) {
    counts.set(node.id, (counts.get(node.id) || 0) + 1);
  }
  const used = new Set(counts.keys());
  const suffixes = new Map();
  function assignId(node, slug) {
    let id = node.id;
    if (!id || counts.get(id) !== 1) {
      id = slug;
      let suffix = suffixes.get(slug) || 1;
      while (used.has(id)) id = `${slug}-${suffix++}`;
      suffixes.set(slug, suffix);
    }
    used.add(id);
    node.id = id;
  }
  for (const heading of headings) {
    const title = heading.textContent.trim();
    assignId(heading, title.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').trim().replace(/\s+/gu, '-') || 'section');
  }
  const tables = [...article.querySelectorAll('table')];
  tables.forEach((table, index) => assignId(table, `table-${index + 1}`));
  for (const heading of headings) {
    const title = heading.textContent.trim();
    const id = heading.id;
    const authoredLabel = heading.getAttribute('aria-label');
    const authoredReferences = heading.getAttribute('aria-labelledby');
    const references = authoredReferences ? authoredReferences.trim().split(/\s+/u).filter(reference => used.has(reference)) : [];
    if (references.includes(id) || (!references.length && !(authoredLabel && authoredLabel.trim()))) {
      const label = element('span');
      if (references.includes(id) && authoredLabel && authoredLabel.trim()) label.setAttribute('aria-label', authoredLabel);
      let labelId = `${id}-heading-text`;
      for (let suffix = 1; used.has(labelId); suffix++) labelId = `${id}-heading-text-${suffix}`;
      used.add(labelId);
      label.id = labelId;
      label.append(...heading.childNodes);
      heading.append(label);
      heading.setAttribute('aria-labelledby', references.length ? references.map(reference => reference === id ? labelId : reference).join(' ') : labelId);
    }
    const tools = element('span', null, 'heading-tools');
    const link = element('a', null, 'btn btn-sm btn-ghost btn-icon heading-anchor');
    link.href = `#${encodeURIComponent(id)}`;
    link.setAttribute('aria-label', `Link to section: ${title || 'Untitled section'}`);
    link.title = 'Link to this section';
    link.append(iconSlot('hash'));
    tools.append(link);
    heading.append(tools);
  }
  const scrollToFragment = () => {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (target && article.contains(target)) {
      const visibleTarget = target.tagName === 'TABLE' && target.parentElement.classList.contains('markdown-table') ? target.parentElement : target;
      visibleTarget.scrollIntoView();
    }
  };
  addEventListener('hashchange', scrollToFragment);
  return scrollToFragment;
}
function markdownSource(line) {
  if (/^ {0,3}(`{3,}|~{3,})/.test(line)) return 'source-code';
  if (/^ {0,3}#{1,6}(?:\s|$)/.test(line)) return 'source-heading';
  if (/^ {0,3}>/.test(line)) return 'source-quote';
  if (/^\s*(?:[-+*]|\d+[.)])\s/.test(line)) return 'source-list';
  return '';
}
function markdownRaw(text) {
  let fence = null;
  return rawLines(text, line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      return 'source-code';
    }
    if (marker) { fence = marker[1]; return 'source-code'; }
    return markdownSource(line);
  });
}
function bindCopy(copy, text, success, failure) {
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    try { await copyText(text, success); }
    catch { toast(failure); }
    finally { copy.disabled = false; }
  });
}
function rawCopy(text, success, failure) {
  const copy = document.querySelector('#copy-raw');
  copy.hidden = false; copy.disabled = false;
  bindCopy(copy, text, success, failure);
}
/** The bar's two-way switch between a rendered and a raw panel; returns select('rendered' | 'raw'). */
function viewModes(label, renderedLabel, rendered, raw) {
  const modes = document.querySelector('#view-mode');
  const buttons = [...modes.querySelectorAll('button')];
  modes.setAttribute('aria-label', label);
  buttons.find(b => b.dataset.mode === 'rendered').textContent = renderedLabel;
  const select = mode => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    rendered.hidden = mode !== 'rendered'; raw.hidden = mode !== 'raw';
  };
  for (const b of buttons) b.addEventListener('click', () => select(b.dataset.mode));
  modes.hidden = false;
  return select;
}
const SELECT_TEXT = 'Could not copy. Select the text and copy it instead.';
const SELECT_RAW = 'Could not copy. Select and copy the text in Raw instead.';
function lineCount(text) { return (text.match(/\n/g) || []).length + (text.endsWith('\n') || !text ? 0 : 1); }
/** 20,763: digit groups as the rest of the chrome writes numbers. */
function grouped(count) { return count.toLocaleString('en-US'); }
function counted(count, noun) { return `${grouped(count)} ${noun}${count === 1 ? '' : 's'}`; }
function markdownControls(text) {
  const preview = element('div', null, 'viewer-doc'); preview.id = 'markdown-preview';
  const source = markdownRaw(text); source.id = 'markdown-source'; source.classList.add('viewer-wide'); source.hidden = true;
  source.setAttribute('aria-label', 'Raw Markdown'); source.tabIndex = 0;
  content.append(preview, source);
  if (embedded) return preview;
  viewModes('Markdown view', 'Rendered', preview, source);
  rawCopy(text, 'Raw Markdown copied.', SELECT_RAW);
  return preview;
}
function copySourceButton(text, label, cls, success, failure) {
  const copy = element('button', null, `btn btn-sm btn-ghost ${cls}`); copy.type = 'button';
  copy.append(iconSlot('copy', 'icon-sm'), document.createTextNode('Copy'));
  copy.setAttribute('aria-label', label); copy.title = label;
  bindCopy(copy, text, success, failure);
  return copy;
}
function markdownCopyControls(article, sources, text) {
  for (const node of article.querySelectorAll('h1,h2,h3,h4,h5,h6,table')) {
    const marker = node.getAttribute('data-manure-source');
    const source = marker === null ? null : sources[Number(marker)];
    node.removeAttribute('data-manure-source');
    const table = node.tagName === 'TABLE';
    if (!source || source.kind !== (table ? 'table' : 'section')) throw new Error('Markdown copy source is unavailable.');
    const copy = copySourceButton(text.slice(source.start, source.end), `Copy ${table ? 'table' : 'section'} Markdown`, table ? 'copy-table' : 'copy-section', 'Raw Markdown copied.', SELECT_RAW);
    if (!table) { node.querySelector(':scope > .heading-tools').append(copy); continue; }
    const wrapper = element('div', null, 'markdown-table');
    const controls = element('div', null, 'table-controls');
    const link = element('a', null, 'btn btn-sm btn-ghost btn-icon table-anchor');
    link.href = `#${encodeURIComponent(node.id)}`;
    link.setAttribute('aria-label', `Link to table: ${node.caption ? node.caption.textContent.trim() : node.id}`);
    link.append(iconSlot('hash'));
    node.replaceWith(wrapper);
    controls.append(link, copy); wrapper.append(controls, node);
  }
}
/**
 * Fenced and indented code blocks: highlighted by the first word of the info string, a diff by its lines, each with
 * Copy above the block. One document highlights at most HIGHLIGHT_LIMIT characters; returns the number of blocks
 * with a known language that did not fit and stay plain.
 */
function markdownCode(article, diagrams) {
  let budget = HIGHLIGHT_LIMIT, plain = 0;
  for (const code of article.querySelectorAll('pre > code')) {
    // Raw HTML may put markup inside <code>; only blocks of plain text are code blocks of the document.
    if (diagrams.includes(code) || code.children.length) continue;
    const text = code.textContent;
    const info = code.className.match(/(?:^|\s)language-(\S+)/);
    const { format, language } = fenceSyntax(info ? info[1] : '');
    if (format === FORMAT_DIFF) {
      const lines = textLines(text);
      const { classes } = diffLines(lines);
      const blocks = document.createDocumentFragment();
      lines.forEach((line, index) => blocks.append(element('span', line, `line ${classes[index]}`.trim())));
      code.replaceChildren(blocks);
    } else if (language !== null && text.length <= budget) {
      budget -= text.length;
      code.replaceChildren(tokenNodes(highlightTokens(text, language)));
    } else if (language !== null) plain++;
    const block = code.parentElement;
    const wrapper = element('div', null, 'markdown-code');
    const controls = element('div', null, 'code-controls');
    controls.append(copySourceButton(text, 'Copy code', 'copy-code', 'Code copied.', SELECT_TEXT));
    block.replaceWith(wrapper);
    wrapper.append(controls, block);
  }
  return plain;
}
async function markdown(text, target) {
  const article = element('article',null,'markdown prose');
  const rendered = renderMarkdown(text);
  article.innerHTML = sanitizedMarkdown(rendered.html);
  const scrollToFragment = markdownLinks(article);
  markdownCopyControls(article, rendered.sources, text);
  const graphs = [...article.querySelectorAll('pre > code')].filter(code => /language-(mermaid|mmd|dot|gv|graphviz)\b/.test(code.className));
  diagramCount(graphs.length);
  const plainBlocks = markdownCode(article, graphs);
  target.append(article);
  if (!embedded) document.querySelector('#meta-extra').textContent =
    `${counted(article.querySelectorAll('h1,h2,h3,h4,h5,h6').length, 'section')} · ${counted(lineCount(text), 'line')}` +
    (plainBlocks ? ` · ${counted(plainBlocks, 'code block')} not highlighted` : '');
  scrollToFragment();
  const deadline = Date.now() + 30000;
  for (const code of graphs) {
    const kind = code.className.match(/language-(mermaid|mmd|dot|gv|graphviz)\b/)[1];
    const target = element('figure',null,'diagram'); target.setAttribute('aria-label', `Diagram ${graphs.indexOf(code) + 1}`);
    code.parentElement.replaceWith(target);
    try {
      if (Date.now() >= deadline) throw new Error('Markdown diagram rendering exceeded the 30 second document deadline.');
      await diagram(code.textContent, kind, target);
    } catch (error) { fail(error,target); }
  }
  scrollToFragment();
}
const SIZE_STEP = 1024;
const SIZE_UNITS = ['KiB', 'MiB', 'GiB', 'TiB'];
/** The size wording of the server's meta line. */
function displaySize(bytes) {
  if (bytes < SIZE_STEP) return `${bytes} B`;
  let value = bytes / SIZE_STEP, unit = 0;
  while (value >= SIZE_STEP && unit < SIZE_UNITS.length - 1) { value /= SIZE_STEP; unit++; }
  return `${value.toFixed(1)} ${SIZE_UNITS[unit]}`;
}
const LIMIT_KIB = HIGHLIGHT_LIMIT / SIZE_STEP;
/** Persistent note above a text view: what the preview shows instead of the whole or the structured file. */
function viewNote(kind, icon, title, ...body) {
  const notice = element('div', null, `notice ${kind} view-note`); notice.setAttribute('role', 'status');
  const text = element('div'); text.append(element('div', title, 'notice-title'), ...body);
  notice.append(iconSlot(icon), text);
  return notice;
}
function lineLink(line, text) { const link = element('a', text); link.href = lineFragment(line, line); return link; }
/**
 * `#L12` and `#L12-L18` mark those lines in every view of the file's lines; `scroll` also reveals the views and
 * brings the first marked line into sight. A click on a number selects its line, a shift-click extends from the
 * line clicked before.
 */
function lineLinks(views, count, reveal) {
  let anchor = null;
  const mark = scroll => {
    const range = lineRange(location.hash, count);
    for (const view of views) {
      for (const line of view.querySelectorAll(':scope > .is-target')) line.classList.remove('is-target');
      // A rendered view can end before the file does (a last line of escape sequences only).
      if (range) for (let n = range.first; n <= Math.min(range.last, view.children.length); n++) view.children[n - 1].classList.add('is-target');
    }
    if (!scroll) return;
    // An address opened or typed is where the next shift-click extends from.
    anchor = range ? range.first : null;
    if (!range) return;
    reveal();
    const target = views.find(view => !view.hidden).querySelector(':scope > .is-target');
    if (target) target.scrollIntoView({ block: 'center' });
  };
  for (const view of views) view.addEventListener('click', event => {
    const link = event.target.closest('a.ln');
    // Modified clicks keep their browser meaning (open the link elsewhere).
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const number = Array.prototype.indexOf.call(view.children, link.parentElement) + 1;
    const extend = event.shiftKey && anchor !== null;
    history.replaceState(null, '', lineFragment(extend ? anchor : number, number));
    if (!extend) anchor = number;
    mark(false);
  });
  addEventListener('hashchange', () => mark(true));
  mark(true);
}
function metaExtra(...parts) {
  const extra = document.querySelector('#meta-extra');
  extra.replaceChildren();
  parts.forEach((part, index) => extra.append(...(index ? [' · '] : []), part));
}
/**
 * Records as a table in the document: first record as the header, numbers right-aligned, records numbered.
 * `partial` records are those of the leading part of a file: nothing is said about the rows beyond them.
 */
function dataTable(records, total, name, partial) {
  const view = element('div', null, 'data-view');
  const table = element('table', null, 'data-table'); table.setAttribute('aria-label', `${name} table`);
  const numeric = numericColumns(records);
  const cell = (tag, text, scope, cls) => { const el = element(tag, text, cls); if (scope) el.scope = scope; return el; };
  const row = (record, tag, scope, number) => {
    const tr = element('tr');
    tr.append(number, ...numeric.map((isNumber, column) => cell(tag, record[column], scope, isNumber ? 'num' : null)));
    return tr;
  };
  const corner = cell('th', null, 'col', 'row-n'); corner.append(element('span', 'Row', 'sr-only'));
  const head = element('thead'); head.append(row(records[0], 'th', 'col', corner));
  const body = element('tbody');
  for (let index = 1; index < records.length; index++) body.append(row(records[index], 'td', null, cell('th', String(index), 'row', 'row-n')));
  table.append(head, body); view.append(table);
  if (records.length < total) view.append(element('p', partial ? `First ${grouped(records.length - 1)} rows are shown as a table.`
    : `First ${grouped(records.length - 1)} of ${grouped(total - 1)} rows are shown as a table. Raw has every line.`, 'data-foot'));
  return view;
}
/**
 * A text file: numbered, linkable lines of the stored text, highlighted by its grammar; a diff by its lines; and a
 * second, rendered view where the format has one (formatted JSON, a table, a log with its colours).
 */
function textFile(fetched, source) {
  const { format, language } = fileSyntax(meta.path);
  const rows = value => language !== null && value.length <= HIGHLIGHT_LIMIT ? tokenLines(highlightTokens(value, language)) : plainRows(value);
  // The shown part: the fetched bytes (the first TEXT_LIMIT of a larger file), and of those at most LINE_LIMIT lines.
  const fetchedLines = textLines(fetched);
  const lineCut = fetchedLines.length > LINE_LIMIT;
  const lines = lineCut ? fetchedLines.slice(0, LINE_LIMIT) : fetchedLines;
  const text = lineCut ? lines.join('') : fetched;
  // What is derived from a part is worded as a part (a table of the first rows) or withheld when it would describe
  // the whole file (a formatted JSON value, validity, totals).
  const partial = source.truncated || lineCut;
  const sourceView = (lineRows, classify, label) => {
    const view = lineView(lineRows, classify, true, true); view.classList.add('viewer-wide', 'text-view');
    view.setAttribute('aria-label', label); view.tabIndex = 0;
    return view;
  };
  const unclassed = () => '';
  const notes = [], facts = [];
  // `rendered` is the format's second view; `lineViews` are the views whose lines are the lines of the file.
  let rendered = null, raw, lineViews, modes;
  if (partial) {
    const actions = element('div', null, 'notice-actions'); actions.append(downloadLink('btn btn-sm btn-primary'));
    const shown = lineCut ? `${grouped(LINE_LIMIT)} lines`
      : displaySize(source.bytes.length) + (source.total === null ? '' : ` of ${displaySize(source.total)}`);
    notes.push(viewNote('', 'info', `Showing the first ${shown}`,
      `The preview ends at line ${grouped(lines.length)}. Copy raw copies the shown part only.`, actions));
  }
  if (format === FORMAT_DIFF) {
    const { classes, files, additions, deletions } = diffLines(lines);
    raw = sourceView(plainRows(text), index => classes[index], 'File text');
    if (!partial && files + additions + deletions > 0) {
      const changes = element('span');
      changes.append(element('span', `+${grouped(additions)}`, 'diff-stat-add'), ' ', element('span', `${MINUS_SIGN}${grouped(deletions)}`, 'diff-stat-del'));
      facts.push(counted(files, 'file'), changes);
    }
  } else if (format === FORMAT_JSON || format === FORMAT_JSON_LINES) {
    raw = sourceView(rows(text), unclassed, 'File text');
    if (!partial) {
      try {
        const formatted = format === FORMAT_JSON ? formatJson(text) : formatJsonLines(text);
        rendered = lineView(rows(formatted), unclassed, false, false); rendered.classList.add('viewer-wide', 'text-view');
        rendered.setAttribute('aria-label', 'Formatted JSON'); rendered.tabIndex = 0;
        modes = ['JSON view', 'Formatted'];
        facts.push(format === FORMAT_JSON ? 'valid JSON' : counted(lines.filter(line => line.trim()).length, 'record'));
      } catch (error) {
        if (error instanceof JsonSyntaxError) notes.push(viewNote('notice-warn', 'alert', 'Not valid JSON', `${error.message} At `,
          lineLink(error.line, `line ${error.line}, column ${error.column}`), '. The raw text is shown.'));
        else if (error instanceof JsonFormatLimitError) notes.push(viewNote('notice-neutral', 'info', 'No formatted view', `${error.message} The raw text is shown.`));
        else throw error;
      }
    }
  } else if (format === FORMAT_CSV || format === FORMAT_TSV) {
    raw = sourceView(plainRows(text), unclassed, 'File text');
    const name = format === FORMAT_CSV ? 'CSV' : 'TSV';
    const delimiter = format === FORMAT_CSV ? ',' : '\t';
    try {
      // The cut may have split the last record of a part; that is not a fault of the file.
      const { records, total } = partial ? parseCsvPart(text, delimiter) : parseCsv(text, delimiter);
      if (records.length) {
        rendered = dataTable(records, total, name, partial);
        modes = [`${name} view`, 'Table'];
        facts.push(`${partial ? 'first ' : ''}${counted(total - 1, 'row')}`, counted(numericColumns(records).length, 'column'));
      }
    } catch (error) {
      if (!(error instanceof CsvSyntaxError)) throw error;
      notes.push(viewNote('notice-warn', 'alert', `Not shown as a table`, `${error.message} See `, lineLink(error.line, `line ${error.line}`), '. The raw text is shown.'));
    }
  } else if (language === null && hasAnsi(text)) {
    rendered = sourceView(tokenLines(ansiTokens(text)), unclassed, 'Rendered log');
    raw = sourceView(tokenLines(escapeTokens(text)), unclassed, 'File text');
    lineViews = [rendered, raw];
    modes = ['Log view', 'Rendered'];
    facts.push('ANSI colours');
  } else raw = sourceView(rows(text), unclassed, 'File text');
  lineViews ??= [raw];
  content.append(...notes, ...(rendered ? [rendered] : []), raw);
  let showLines = () => {};
  if (rendered) {
    const select = viewModes(...modes, rendered, raw);
    select('rendered');
    // A view that is not made of the file's lines gives way to the raw text when lines are addressed.
    if (!lineViews.includes(rendered)) showLines = () => select('raw');
  }
  if (language !== null && text.length > HIGHLIGHT_LIMIT) facts.push(`not highlighted above ${LIMIT_KIB} KiB`);
  facts.push(partial ? `first ${counted(lines.length, 'line')}` : counted(lines.length, 'line'));
  metaExtra(...facts);
  rawCopy(text, partial ? 'Shown part of the file copied.' : 'File text copied.', SELECT_TEXT);
  lineLinks(lineViews, lines.length, showLines);
}
function downloadCard(icon, title, text) {
  const card = element('div', null, 'empty viewer-doc');
  card.append(iconSlot(icon), element('h2', title), element('p', text), downloadLink('btn btn-primary'));
  content.append(card);
}
function archive() {
  downloadCard('archive', 'No preview for archives', 'Download the original to open it locally, or fetch the whole artifact with the manure CLI.');
}
function noPreview() {
  downloadCard('file', 'No preview for this file type', 'The file is not text. Download the original to open it locally, or fetch the whole artifact with the manure CLI.');
}
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
/** 0:04, 12:31, 1:02:03. */
function displayDuration(seconds) {
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / SECONDS_PER_MINUTE);
  const tail = `${String(minutes % MINUTES_PER_HOUR).padStart(minutes >= MINUTES_PER_HOUR ? 2 : 1, '0')}:${String(whole % SECONDS_PER_MINUTE).padStart(2, '0')}`;
  return minutes >= MINUTES_PER_HOUR ? `${Math.floor(minutes / MINUTES_PER_HOUR)}:${tail}` : tail;
}
/** The browser's own player; it seeks with byte ranges of the raw file. */
function media(kind) {
  const stage = element('div', null, 'stage');
  const player = element(kind, null, kind === 'video' ? 'stage-video' : 'stage-audio');
  player.controls = true; player.preload = 'metadata';
  player.setAttribute('aria-label', meta.path);
  player.addEventListener('error', () => fail(new Error(`The browser cannot play this ${kind} file.`)));
  player.addEventListener('loadedmetadata', () => {
    const facts = [...(kind === 'video' && player.videoWidth ? [`${player.videoWidth} × ${player.videoHeight}`] : []),
      ...(Number.isFinite(player.duration) ? [displayDuration(player.duration)] : [])];
    document.querySelector('#file-facts').textContent = facts.map(fact => ` · ${fact}`).join('');
  });
  player.src = raw;
  stage.append(player); content.append(stage);
}
function loadCastStyle() {
  return new Promise((resolve, reject) => {
    const link = element('link');
    link.rel = 'stylesheet';
    link.href = new URL('./asciinema-player.css', import.meta.url).href;
    link.onload = resolve;
    link.onerror = () => reject(new Error('Could not load the terminal player styles.'));
    document.head.append(link);
  });
}
const CAST_START_DEADLINE_MS = 15000;
async function asciinema() {
  if (typeof WebAssembly !== 'object') throw new Error('This browser does not support terminal playback.');
  const data = parseAsciicast(new TextDecoder('utf-8', {fatal:true}).decode(await fetchBytes(TEXT_LIMIT)));
  const moduleUrl = new URL('./asciinema-player.js', import.meta.url).href;
  const [{create}] = await Promise.all([import(moduleUrl), loadCastStyle()])
    .catch(() => { throw new Error('Could not load the terminal player.'); });
  const stage = element('div', null, 'stage');
  const host = element('div', null, 'stage-cast');
  host.setAttribute('role', 'region'); host.setAttribute('aria-label', 'Terminal recording');
  stage.append(host); content.append(stage);
  // Only the validated recording data is passed in; the recording never
  // chooses a URL or the player options (including audio and theme).
  // A recording-derived NPT poster in 3.19.0 advances the playback cursor
  // before clearing its drawing, losing initial frames on first play/seek.
  const player = create({data}, host, {autoplay:false, preload:true, controls:true, fit:'both', theme:'asciinema',
    poster:'data:text/plain,Press play to watch the terminal recording.'});
  const onHide = event => {
    if (event.persisted) void player.pause().catch(() => {});
    else player.dispose();
  };
  addEventListener('pagehide', onHide);
  await new Promise(resolve => {
    const finish = () => { clearTimeout(deadline); resolve(); };
    const unavailable = message => {
      if (!host.isConnected) return;
      finish();
      removeEventListener('pagehide', onHide);
      player.dispose();
      fail(new Error(message));
    };
    // WASM startup can stall before the player's error handler is active.
    const deadline = setTimeout(() => unavailable('Terminal player startup timed out.'), CAST_START_DEADLINE_MS);
    player.addEventListener('ready', finish);
    player.addEventListener('error', () => unavailable('The browser could not play this terminal recording.'));
  });
}
const FETCH_DEADLINE_MS = 30000;
async function fetchWithDeadline(read) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
  try { return await read(headers => fetch(raw, {headers, credentials:'same-origin', signal:controller.signal, redirect:'error'})); }
  finally { clearTimeout(timer); controller.abort(); }
}
function fetchBytes(limit) { return fetchWithDeadline(async request => boundedBytes(await request({}), limit)); }
/** At most the first TEXT_LIMIT bytes of the file, cut at a line end when the file is larger. */
function fetchLeadingText() { return fetchWithDeadline(request => leadingBytes(request, TEXT_LIMIT)); }
const NUL = 0;
/** The text of a file of unknown type, or null when its bytes are not UTF-8 text. */
function textOrNull(bytes) {
  if (bytes.includes(NUL)) return null;
  try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); } catch { return null; }
}
async function pdf() {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs',import.meta.url).href;
  pdfjs.GlobalWorkerOptions.rendererSrc = new URL('./pdf.renderer.min.mjs',import.meta.url).href;
  const task = pdfjs.getDocument({data:await fetchBytes(32 * 1024 * 1024), isEvalSupported:false, useWasm:false, useWorkerFetch:false, useSystemFonts:true, disableFontFace:true, maxImageSize:12000000, stopAtErrors:true});
  // PDFDocumentProxy has no destroy(): the loading task owns the document and its workers.
  addEventListener('pagehide', () => task.destroy(), {once:true});
  const timer = setTimeout(() => task.destroy(), 15000);
  let doc;
  try { doc = await task.promise; } finally {clearTimeout(timer);}
  if (doc.numPages > 1000) { await task.destroy(); throw new Error('PDF exceeds 1,000 pages.'); }
  let pageNumber = 1; let busy = false; let pageWidth = 0;
  const label = element('span', null, 'tool-value');
  const canvas = element('canvas', null, 'stage-page'); canvas.setAttribute('aria-label','PDF page'); canvas.setAttribute('role','img');
  const stage = element('div',null,'stage'); stage.append(canvas);
  const previous = iconButton('chevron-up', 'Previous page', () => render(pageNumber - 1));
  const next = iconButton('chevron-down', 'Next page', () => render(pageNumber + 1));
  const zoom = element('select', null, 'select pdf-zoom'); zoom.setAttribute('aria-label', 'Zoom');
  for (const [value, text] of PDF_ZOOMS) { const option = element('option', text); option.value = value; zoom.append(option); }
  const applyZoom = () => {
    canvas.dataset.zoom = ['width', 'page'].includes(zoom.value) ? zoom.value : 'scale';
    if (canvas.dataset.zoom === 'scale') canvas.style.setProperty('width', `${pageWidth * CSS_PX_PER_PDF_POINT * Number(zoom.value)}px`);
    else canvas.style.removeProperty('width');
  };
  zoom.addEventListener('change', applyZoom);
  tools('PDF pages', previous, next, label, element('span', null, 'vr'), zoom);
  content.append(stage);
  async function render(number) {
    if (busy || number < 1 || number > doc.numPages) return;
    busy = true; previous.disabled = next.disabled = true;
    let page, renderTask, deadline;
    let expired = false;
    const cleanup = () => { const current = page; page = null; current?.cleanup(); };
    // The deadline starts BEFORE GetPage and settles independently of the worker.
    const timeout = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        expired = true;
        reject(new Error('PDF page operation exceeded the 15 second deadline.'));
        try { renderTask?.cancel(); } catch { /* still destroy a failed worker */ }
        try { cleanup(); } catch { /* worker destruction remains mandatory */ }
        try { Promise.resolve(task.destroy()).catch(() => {}); } catch { /* deadline already reported */ }
      }, 15000);
    });
    const operation = (async () => {
      try {
        page = await doc.getPage(number);
        if (expired) return; // A late worker reply must not render into detached UI.
        const initial = page.getViewport({scale:1});
        const scale = Math.min(2, 1600 / initial.width, Math.sqrt(12000000 / (initial.width * initial.height)));
        const viewport = page.getViewport({scale});
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        pageWidth = initial.width;
        renderTask = page.render({canvasContext:canvas.getContext('2d'), viewport});
        await renderTask.promise;
      } finally { cleanup(); }
    })();
    try {
      await Promise.race([operation, timeout]);
      pageNumber = number; label.textContent = `Page ${number} of ${doc.numPages}`;
      applyZoom(); // a numeric zoom scales the new page's own width
    } catch (error) { fail(error); }
    finally {clearTimeout(deadline); busy = false; previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= doc.numPages;}
  }
  await render(1);
}
function crumbs() {
  const nav = document.querySelector('#crumbs');
  const segments = meta.path.split('/');
  const parts = meta.artifactName === meta.path ? [] : [[meta.artifactName, meta.rootUrl]];
  segments.slice(0, -1).forEach((segment, index) =>
    parts.push([segment, `${meta.rootUrl}${segments.slice(0, index + 1).map(encodeURIComponent).join('/')}/`]));
  for (const [text, href] of parts) {
    const link = element('a', text); link.href = href;
    nav.append(link, element('span', '/', 'crumb-sep'));
  }
  const here = element('span', segments.at(-1), 'crumb-here'); here.setAttribute('aria-current', 'page'); here.title = meta.path;
  nav.append(here);
}
async function main() {
  if (!raw) throw new Error('Invalid file URL.');
  if (!embedded) {
    crumbs();
    document.title = `${meta.path} · Manure`;
    document.querySelector('#download').href = downloadUrl;
  }
  if (meta.kind === 'image') imageView(raw,meta.path);
  else if (meta.kind === 'pdf') await pdf();
  else if (meta.kind === 'archive') archive();
  else if (meta.kind === 'asciinema') await asciinema();
  else if (meta.kind === 'video' || meta.kind === 'audio') media(meta.kind);
  else if (meta.kind === 'text') {
    const source = await fetchLeadingText();
    textFile(new TextDecoder('utf-8', {fatal:true}).decode(source.bytes), source);
  }
  else if (meta.kind === 'unknown') {
    const source = await fetchLeadingText();
    const text = textOrNull(source.bytes);
    if (text === null) noPreview(); else textFile(text, source);
  }
  else {
    const text = new TextDecoder('utf-8', {fatal:true}).decode(await fetchBytes(TEXT_LIMIT));
    if (meta.kind === 'markdown') {
      const preview = markdownControls(text);
      try { await markdown(text, preview); } catch (error) { fail(error, preview); }
    }
    else if (['mermaid','graphviz'].includes(meta.kind)) {
      try { await diagram(text,meta.kind,content); } catch (error) { rawCopy(text, 'Raw source copied.', SELECT_TEXT); fail(error, content, text); }
    }
    else throw new Error('Unsupported preview format.');
  }
  status.textContent = '';
}
main().catch(error => { status.textContent = ''; fail(error); });
