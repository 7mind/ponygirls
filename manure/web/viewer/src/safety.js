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
export function graphSource(text) {
  if (text.length > GRAPH_LIMIT) throw new Error('Diagram exceeds the 50,000 character preview limit.');
  // Reject both legacy directives and YAML frontmatter: content cannot change renderer configuration.
  if (/%%\s*\{|^\s*---/m.test(text)) throw new Error('Diagram configuration directives are not allowed in previews.');
  return text;
}
