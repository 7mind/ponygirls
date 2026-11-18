import { renderMarkdown } from './markdown.js';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { localUrl, artifactResourceUrl, markdownLinkUrl, boundedBytes, graphSource, diagramCount, TEXT_LIMIT } from './safety.js';
import { hydrateIcons, iconSlot, copyText, toast } from './chrome.js';

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
function rawLines(text, classify) {
  const pre = element('pre', null, 'raw');
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) pre.append(element('span', line, classify(line)));
  return pre;
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
  hydrateIcons(notice);
}
/** Page toolbar in place of the plain meta line: tool controls left, file facts right. */
function tools(label, ...controls) {
  toolbar.classList.add('viewer-tools');
  toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', label);
  document.querySelector('#file-meta').classList.add('push');
  toolbar.prepend(...controls);
  hydrateIcons(toolbar);
}
function segmented(label, options, select) {
  const group = element('div', null, 'segmented'); group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
  const buttons = options.map(([value, text]) => { const b = button(text, () => select(value), ''); b.dataset.value = value; return b; });
  group.append(...buttons);
  return { group, press: value => { for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === value)); } };
}
function imageView(src, alt) {
  const stage = element('div', null, 'stage');
  const img = new Image(); img.alt = alt; img.src = src; img.className = 'stage-image is-fit';
  img.addEventListener('error', () => fail(new Error('The image could not be decoded.')));
  const percent = element('span', null, 'tool-value'); percent.setAttribute('aria-live', 'polite');
  const show = () => { if (img.naturalWidth) percent.textContent = `${Math.round(img.getBoundingClientRect().width / img.naturalWidth * PERCENT)} %`; };
  const width = value => { img.classList.remove('is-fit'); img.style.removeProperty('max-height'); img.style.setProperty('width', `${Math.max(1, value)}px`); show(); };
  // Fit uses the height actually left under the sticky chrome, which wraps on narrow screens.
  const fitHeight = () => {
    const padding = parseFloat(getComputedStyle(stage).paddingTop) + parseFloat(getComputedStyle(stage).paddingBottom);
    img.style.setProperty('max-height', `${Math.max(1, innerHeight - toolbar.getBoundingClientRect().bottom - padding)}px`);
  };
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
  mode.press('fit');
  img.addEventListener('load', () => {
    document.querySelector('#file-facts').textContent = ` · ${img.naturalWidth} × ${img.naturalHeight}`;
    show();
  });
  addEventListener('resize', () => { if (img.classList.contains('is-fit')) fitHeight(); show(); });
  tools('Image zoom', textButton(MINUS_SIGN, 'Zoom out', () => zoom(1 / ZOOM_STEP)), percent, iconButton('plus', 'Zoom in', () => zoom(ZOOM_STEP)),
    element('span', null, 'vr'), mode.group);
  stage.append(img); content.append(stage);
  fitHeight();
  return img;
}
function svgImage(svg, target, alt, renderer) {
  if (svg.length > 8 * 1024 * 1024) throw new Error('Rendered diagram is too large.');
  const clean = DOMPurify.sanitize(svg, {USE_PROFILES:{svg:true, svgFilters:true}, FORBID_TAGS:['foreignObject','image','a','script','animate','set','animateTransform'], FORBID_ATTR:['href','xlink:href']});
  const url = URL.createObjectURL(new Blob([clean], {type:'image/svg+xml'})); urls.add(url);
  if (target === content) { imageView(url, alt).dataset.renderer = renderer; return; }
  const img = new Image(); img.alt = alt; img.src = url; img.dataset.renderer = renderer;
  img.addEventListener('error', () => fail(new Error('The diagram could not be decoded.'), target));
  target.replaceChildren(img);
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
  return purifier.sanitize(html, {USE_PROFILES:{html:true}, FORBID_TAGS:['style','iframe','object','embed','form','input','video','audio','source'], FORBID_ATTR:['style','srcset','background']});
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
function bindCopy(copy, text) {
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    try { await copyText(text, 'Raw Markdown copied.'); }
    catch { toast(SELECT_RAW); }
    finally { copy.disabled = false; }
  });
}
function rawCopy(text, success, failure) {
  const copy = document.querySelector('#copy-raw');
  copy.hidden = false; copy.disabled = false;
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    try { await copyText(text, success); }
    catch { toast(failure); }
    finally { copy.disabled = false; }
  });
}
const SELECT_TEXT = 'Could not copy. Select the text and copy it instead.';
const SELECT_RAW = 'Could not copy. Select and copy the text in Raw instead.';
function lineCount(text) { return (text.match(/\n/g) || []).length + (text.endsWith('\n') || !text ? 0 : 1); }
function counted(count, noun) { return `${count} ${noun}${count === 1 ? '' : 's'}`; }
function markdownControls(text) {
  const preview = element('div', null, 'viewer-doc'); preview.id = 'markdown-preview';
  const source = markdownRaw(text); source.id = 'markdown-source'; source.classList.add('viewer-wide'); source.hidden = true;
  source.setAttribute('aria-label', 'Raw Markdown'); source.tabIndex = 0;
  content.append(preview, source);
  if (embedded) return preview;
  const modes = document.querySelector('#view-mode');
  const buttons = [...modes.querySelectorAll('button')];
  const select = mode => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    preview.hidden = mode !== 'rendered'; source.hidden = mode !== 'raw';
  };
  for (const b of buttons) b.addEventListener('click', () => select(b.dataset.mode));
  modes.hidden = false;
  rawCopy(text, 'Raw Markdown copied.', SELECT_RAW);
  return preview;
}
function copySourceButton(text, label, cls) {
  const copy = element('button', null, `btn btn-sm btn-ghost ${cls}`); copy.type = 'button';
  copy.append(iconSlot('copy', 'icon-sm'), document.createTextNode('Copy'));
  copy.setAttribute('aria-label', label); copy.title = label;
  bindCopy(copy, text);
  return copy;
}
function markdownCopyControls(article, sources, text) {
  for (const node of article.querySelectorAll('h1,h2,h3,h4,h5,h6,table')) {
    const marker = node.getAttribute('data-manure-source');
    const source = marker === null ? null : sources[Number(marker)];
    node.removeAttribute('data-manure-source');
    const table = node.tagName === 'TABLE';
    if (!source || source.kind !== (table ? 'table' : 'section')) throw new Error('Markdown copy source is unavailable.');
    const copy = copySourceButton(text.slice(source.start, source.end), `Copy ${table ? 'table' : 'section'} Markdown`, table ? 'copy-table' : 'copy-section');
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
async function markdown(text, target) {
  const article = element('article',null,'markdown prose');
  const rendered = renderMarkdown(text);
  article.innerHTML = sanitizedMarkdown(rendered.html);
  const scrollToFragment = markdownLinks(article);
  markdownCopyControls(article, rendered.sources, text);
  const graphs = [...article.querySelectorAll('pre > code')].filter(code => /language-(mermaid|mmd|dot|gv|graphviz)\b/.test(code.className));
  diagramCount(graphs.length);
  target.append(article);
  if (!embedded) document.querySelector('#meta-extra').textContent =
    `${counted(article.querySelectorAll('h1,h2,h3,h4,h5,h6').length, 'section')} · ${counted(lineCount(text), 'line')}`;
  // Icons are decoration: the document renders even if the shared icon module cannot load.
  hydrateIcons(article);
  scrollToFragment();
  const deadline = Date.now() + 30000;
  for (const code of graphs) {
    const kind = code.className.match(/language-(mermaid|mmd|dot|gv|graphviz)\b/)[1];
    const target = element('figure',null,'diagram'); code.parentElement.replaceWith(target);
    try {
      if (Date.now() >= deadline) throw new Error('Markdown diagram rendering exceeded the 30 second document deadline.');
      await diagram(code.textContent, kind, target);
    } catch (error) { fail(error,target); }
  }
  scrollToFragment();
}
function plainText(text) {
  const view = rawLines(text, () => ''); view.classList.add('viewer-wide', 'text-view');
  view.setAttribute('aria-label', 'File text'); view.tabIndex = 0;
  content.append(view);
  document.querySelector('#meta-extra').textContent = counted(lineCount(text), 'line');
  rawCopy(text, 'File text copied.', SELECT_TEXT);
}
function archive() {
  const card = element('div', null, 'empty viewer-doc');
  card.append(iconSlot('archive'), element('h2', 'No preview for archives'),
    element('p', 'Download the original to open it locally, or fetch the whole artifact with the manure CLI.'), downloadLink('btn btn-primary'));
  content.append(card);
  hydrateIcons(card);
}
async function fetchBytes(limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try { return await boundedBytes(await fetch(raw, {credentials:'same-origin', signal:controller.signal, redirect:'error'}), limit); }
  finally {clearTimeout(timer);}
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
    } catch (error) { fail(error); }
    finally {clearTimeout(deadline); busy = false; previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= doc.numPages;}
  }
  await render(1);
  applyZoom();
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
  const here = element('span', segments.at(-1), 'crumb-here'); here.setAttribute('aria-current', 'page');
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
  else {
    const text = new TextDecoder('utf-8', {fatal:true}).decode(await fetchBytes(TEXT_LIMIT));
    if (meta.kind === 'markdown') {
      const preview = markdownControls(text);
      try { await markdown(text, preview); } catch (error) { fail(error, preview); }
    }
    else if (['mermaid','graphviz'].includes(meta.kind)) {
      try { await diagram(text,meta.kind,content); } catch (error) { rawCopy(text, 'Raw source copied.', SELECT_TEXT); fail(error, content, text); }
    }
    else if (meta.kind === 'text') plainText(text);
    else throw new Error('Unsupported preview format.');
  }
  status.textContent = '';
}
main().catch(error => { status.textContent = ''; fail(error); });
