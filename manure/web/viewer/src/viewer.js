import { marked } from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import { localUrl, artifactResourceUrl, boundedBytes, graphSource, diagramCount, TEXT_LIMIT } from './safety.js';

const meta = document.querySelector('#manure-viewer').dataset;
const content = document.querySelector('#content');
const status = document.querySelector('#status');
const raw = localUrl(meta.rawUrl);
const download = document.querySelector('#download');
download.href = localUrl(meta.downloadUrl) || '#';
document.querySelector('#filename').textContent = meta.path;
document.title = `${meta.path} · Manure`;
const urls = new Set();
addEventListener('pagehide', () => { for (const url of urls) URL.revokeObjectURL(url); });
function element(tag, text, cls) { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; }
function errorText(error) { return error instanceof Error ? error.message : String(error); }
function fail(error, target = content) { const el = element('p', `Preview unavailable: ${errorText(error)} Download the original to view this file.`, 'error'); el.setAttribute('role','alert'); target.replaceChildren(el); }
function button(label, action) { const el = element('button', label); el.type = 'button'; el.addEventListener('click', action); return el; }
function imageView(src, alt, target = content) {
  const box = element('div', null, 'image-view');
  const tools = element('div', null, 'tools');
  const viewport = element('div', null, 'viewport'); viewport.tabIndex = 0; viewport.setAttribute('aria-label','Image; scroll to pan when zoomed');
  const img = new Image(); img.alt = alt; img.src = src;
  img.addEventListener('error', () => fail(new Error('The image could not be decoded.'), box));
  let zoom = 1;
  const fit = () => { zoom = 1; img.style.width = ''; img.style.maxWidth = '100%'; img.style.maxHeight = ''; };
  const scale = factor => { zoom = Math.min(8, Math.max(.1, zoom * factor)); img.style.maxWidth = 'none'; img.style.maxHeight = 'none'; img.style.width = `${Math.max(1, img.naturalWidth * zoom)}px`; };
  tools.append(button('− Zoom out', () => scale(.8)), button('+ Zoom in', () => scale(1.25)), button('Actual size', () => {zoom = 1; scale(1);}), button('Fit / reset', fit));
  viewport.append(img); box.append(tools,viewport); target.append(box);
}
function svgImage(svg, target, alt) {
  if (svg.length > 8 * 1024 * 1024) throw new Error('Rendered diagram is too large.');
  const clean = DOMPurify.sanitize(svg, {USE_PROFILES:{svg:true, svgFilters:true}, FORBID_TAGS:['foreignObject','image','a','script','animate','set','animateTransform'], FORBID_ATTR:['href','xlink:href']});
  const url = URL.createObjectURL(new Blob([clean], {type:'image/svg+xml'})); urls.add(url);
  imageView(url, alt, target);
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
mermaid.initialize({startOnLoad:false, securityLevel:'strict', htmlLabels:false, maxTextSize:50000, maxEdges:500, suppressErrorRendering:true, flowchart:{htmlLabels:false}, secure:['secure','securityLevel','htmlLabels','startOnLoad','maxTextSize','maxEdges','suppressErrorRendering','flowchart']});
let graphId = 0;
async function diagram(text, kind, target) {
  const source = graphSource(text);
  const svg = ['dot','gv','graphviz'].includes(kind) ? await graphviz(source) : (await mermaid.render(`diagram-${++graphId}`, source)).svg;
  svgImage(svg,target,'Rendered diagram');
}
function sanitizedMarkdown(text) {
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
      if (value.startsWith('#') && attr === 'href') continue;
      const url = artifactResourceUrl(value,base,mountPath);
      if (url) node.setAttribute(attr,url); else node.removeAttribute(attr);
    }
    if (node.tagName === 'A') node.setAttribute('rel','noopener noreferrer');
  });
  return purifier.sanitize(marked.parse(text, {gfm:true}), {USE_PROFILES:{html:true}, FORBID_TAGS:['style','iframe','object','embed','form','input','video','audio','source'], FORBID_ATTR:['style','srcset','background']});
}
async function markdown(text) {
  const article = element('article',null,'markdown');
  article.innerHTML = sanitizedMarkdown(text);
  const graphs = [...article.querySelectorAll('pre > code')].filter(code => /language-(mermaid|mmd|dot|gv|graphviz)\b/.test(code.className));
  diagramCount(graphs.length);
  content.append(article);
  const deadline = Date.now() + 30000;
  for (const code of graphs) {
    const kind = code.className.match(/language-(mermaid|mmd|dot|gv|graphviz)\b/)[1];
    const target = element('div',null,'diagram'); code.parentElement.replaceWith(target);
    try {
      if (Date.now() >= deadline) throw new Error('Markdown diagram rendering exceeded the 30 second document deadline.');
      await diagram(code.textContent, kind, target);
    } catch (error) { fail(error,target); }
  }
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
  const timer = setTimeout(() => task.destroy(), 15000);
  let doc;
  try { doc = await task.promise; } finally {clearTimeout(timer);}
  if (doc.numPages > 1000) { await doc.destroy(); throw new Error('PDF exceeds 1,000 pages.'); }
  let pageNumber = 1; let busy = false;
  const toolbar = element('div',null,'tools'); const label = element('span');
  const canvas = element('canvas'); canvas.setAttribute('aria-label','PDF page'); canvas.setAttribute('role','img');
  const wrap = element('div',null,'pdf-view'); wrap.append(canvas);
  const previous = button('← Previous', () => render(pageNumber - 1));
  const next = button('Next →', () => render(pageNumber + 1));
  toolbar.append(previous,label,next); content.append(toolbar,wrap);
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
        try { Promise.resolve(doc.destroy()).catch(() => {}); } catch { /* deadline already reported */ }
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
  addEventListener('pagehide', () => doc.destroy(), {once:true});
}
async function main() {
  if (!raw) throw new Error('Invalid file URL.');
  if (meta.kind === 'image') imageView(raw,meta.path);
  else if (meta.kind === 'pdf') await pdf();
  else {
    const text = new TextDecoder('utf-8', {fatal:true}).decode(await fetchBytes(TEXT_LIMIT));
    if (['markdown','md'].includes(meta.kind)) await markdown(text);
    else if (['mermaid','mmd','dot','gv','graphviz'].includes(meta.kind)) await diagram(text,meta.kind,content);
    else throw new Error('Unsupported preview format.');
  }
  status.textContent = '';
}
main().catch(error => { status.textContent = ''; fail(error); });
