export const TEXT_LIMIT = 2 * 1024 * 1024;
export const GRAPH_LIMIT = 50000;
export function localUrl(value, base = location.href) {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(base).origin || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
export function artifactResourceUrl(value, base, mountPath) {
  const href = localUrl(value, base);
  if (!href) return null;
  const url = new URL(href);
  try {
    const segments = url.pathname.split('/').map(decodeURIComponent);
    // Match the server's single-pass decoding: literal percent names stay literal.
    if (segments.some(part => /[\u0000-\u001f\u007f\\/]/.test(part) || part === '.' || part === '..')) return null;
    const path = segments.join('/');
    if (mountPath && !path.startsWith(`${mountPath}/`)) return null;
    const resource = mountPath ? path.slice(mountPath.length + 1) : path.slice(1);
    if (['api','__manure'].includes(resource.split('/')[0])) return null;
    return href;
  } catch { return null; }
}
export function markdownLinkUrl(value, base, mountPath) {
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (value.startsWith('#')) return value;
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.origin !== new URL(base).origin) return url.href;
    const resource = artifactResourceUrl(value, base, mountPath);
    if (resource) return resource;
    // Config.contentMount uses /view/<32 lowercase hex> only in path mode.
    if (!/^\/view\/[0-9a-f]{32}$/.test(mountPath) || !/^(?:https?:\/\/|\/)/i.test(value)) return null;
    const target = url.pathname.match(/^(\/view\/[0-9a-f]{32})(?:\/|$)/);
    if (!target) return null;
    return url.pathname === target[1] ? url.href : artifactResourceUrl(url.href, base, target[1]);
  } catch { return null; }
}
export function diagramCount(count) {
  if (count > 32) throw new Error('Markdown exceeds the preview limit of 32 diagrams.');
}
export async function boundedBytes(response, limit) {
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('File is too large to preview. Download the original instead.');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('File is too large to preview. Download the original instead.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
const UTF8_SEQUENCE_MAX = 4;
/** Bytes a UTF-8 lead byte announces for its sequence; 1 for ASCII, 0 for a continuation or invalid byte. */
function utf8Length(byte) { return byte < 0x80 ? 1 : byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 0; }
/**
 * The leading whole lines of a cut-off UTF-8 text: a sequence split by the cut is dropped, then the incomplete
 * last line when a line feed precedes it. A text without any line feed keeps its incomplete line.
 */
export function wholeLines(bytes) {
  let end = bytes.length;
  for (let back = 1; back <= Math.min(UTF8_SEQUENCE_MAX, bytes.length); back++) {
    const length = utf8Length(bytes[bytes.length - back]);
    if (length === 0) continue;
    if (length > back) end = bytes.length - back;
    break;
  }
  const lineEnd = bytes.subarray(0, end).lastIndexOf(0x0a);
  return bytes.subarray(0, lineEnd < 0 ? end : lineEnd + 1);
}
/**
 * At most the first `limit` bytes of a file. `request(headers)` performs the fetch. A larger file is asked for
 * again as a byte range and reported as `truncated` with its `total` size; its bytes end at a line end.
 */
export async function leadingBytes(request, limit) {
  const whole = await request({});
  if (!whole.ok) throw new Error(`Download failed (HTTP ${whole.status}).`);
  const total = Number(whole.headers.get('content-length'));
  if (!(total > limit)) return { bytes: await boundedBytes(whole, limit), total: null, truncated: false };
  await whole.body.cancel();
  const part = await request({ Range: `bytes=0-${limit - 1}` });
  if (part.status !== 206) throw new Error(`Download failed (HTTP ${part.status} for a byte range).`);
  return { bytes: wholeLines(await boundedBytes(part, limit)), total, truncated: true };
}
const LINE_FRAGMENT = /^#L([1-9][0-9]*)(?:-L([1-9][0-9]*))?$/;
/** `{first, last}` of a `#L12` or `#L12-L18` fragment within a text of `count` lines, or null. */
export function lineRange(hash, count) {
  const found = LINE_FRAGMENT.exec(hash);
  if (!found) return null;
  const numbers = [Number(found[1]), Number(found[2] ?? found[1])];
  const first = Math.min(...numbers), last = Math.min(Math.max(...numbers), count);
  return first > count ? null : { first, last };
}
/** The fragment that addresses lines `from`..`to` in either order. */
export function lineFragment(from, to) {
  return from === to ? `#L${from}` : `#L${Math.min(from, to)}-L${Math.max(from, to)}`;
}
export function graphSource(text) {
  if (text.length > GRAPH_LIMIT) throw new Error('Diagram exceeds the 50,000 character preview limit.');
  // Reject both legacy directives and YAML frontmatter: content cannot change renderer configuration.
  if (/%%\s*\{|^\s*---/m.test(text)) throw new Error('Diagram configuration directives are not allowed in previews.');
  return text;
}
