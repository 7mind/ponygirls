// Raw download of one archived revision (ingest-c spec §1.6): the dashboard reads only the small manifest (cookie, same
// origin); each file is a plain `download` link to the server's byte endpoint, so the browser streams it to disk and no
// script ever holds the file.
import { useEffect, useState } from 'react';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.ts';
import { RawManifest_JsonCodec, type RawManifest } from '../../generated/typescript/chronicle/api/RawManifest.ts';
const RAW_ROOT = '/api/raw';
const NOT_FOUND = 404;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'] as const, UNIT_STEP = 1024;
export type RawManifestState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly manifest: RawManifest }
  /** The session, the revision or the session's visibility is absent: the server does not tell them apart. */
  | { readonly kind: 'not-found' }
  /** A server that predates the raw API (404 without a `Failure` body). */
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed'; readonly message: string };
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
const LOADING: RawManifestState = { kind: 'loading' };

function rawPath(sessionId: string, revision: number): string { return `${RAW_ROOT}/${encodeURIComponent(sessionId)}/${revision}`; }
/** The byte endpoint of one file of a pinned revision (never the head). */
export function rawFileHref(sessionId: string, revision: number, index: number): string { return `${rawPath(sessionId, revision)}/${index}`; }

class InvalidManifest extends Error { constructor(detail: string) { super(`The server returned an invalid raw manifest: ${detail}`); } }
function validManifest(json: unknown, sessionId: string, revision: number): RawManifest {
  if (json === null || typeof json !== 'object' || !Array.isArray((json as { files?: unknown }).files)) throw new InvalidManifest('not a manifest');
  const manifest = RawManifest_JsonCodec.instance.decode(BaboonCodecContext.Default, json);
  if (typeof manifest.sessionId !== 'string' || manifest.sessionId.toLowerCase() !== sessionId.toLowerCase()) throw new InvalidManifest(`session ${String(manifest.sessionId)} instead of ${sessionId}`);
  if (manifest.revision !== revision) throw new InvalidManifest(`revision ${String(manifest.revision)} instead of ${revision}`);
  manifest.files.forEach((file, position) => {
    if (file.index !== position) throw new InvalidManifest(`file ${position} has index ${String(file.index)}`);
    if (typeof file.path !== 'string') throw new InvalidManifest(`file ${position} has no path`);
    if (typeof file.sha256 !== 'string' || !SHA256_HEX.test(file.sha256)) throw new InvalidManifest(`file ${position} has no SHA-256`);
    if (file.bytes < 0n) throw new InvalidManifest(`file ${position} has size ${file.bytes}`);
  });
  return manifest;
}
function isJson(response: Response): boolean { return response.headers.get('Content-Type')?.split(';', 1)[0]?.trim() === 'application/json'; }
/** The server's `Failure` body ({code, message}), or null when the body is something else. */
async function failureOf(response: Response): Promise<{ code: string; message: string } | null> {
  if (!isJson(response)) return null;
  const body: unknown = await response.json();
  if (body === null || typeof body !== 'object') return null;
  const { code, message } = body as { code?: unknown; message?: unknown };
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : null;
}
/** Reads the manifest of `revision`; never rejects (an abort included: the caller ignores what an aborted read returns). */
export async function readRawManifest(fetcher: Fetch, sessionId: string, revision: number, signal: AbortSignal): Promise<Exclude<RawManifestState, { kind: 'loading' }>> {
  try {
    const response = await fetcher(rawPath(sessionId, revision), { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal });
    if (response.ok) {
      if (!isJson(response)) throw new InvalidManifest(`HTTP ${response.status} without JSON`);
      return { kind: 'ready', manifest: validManifest(await response.json(), sessionId, revision) };
    }
    const failure = await failureOf(response);
    if (response.status === NOT_FOUND) return failure === null ? { kind: 'unsupported' } : failure.code === 'not-found' ? { kind: 'not-found' } : { kind: 'failed', message: failure.message };
    return { kind: 'failed', message: failure === null ? `The server answered HTTP ${response.status}` : failure.message };
  } catch (cause) { return { kind: 'failed', message: cause instanceof Error ? cause.message : 'The raw manifest could not be read' }; }
}
/** The manifest of the viewed revision, read when the caller mounts and again when the pin changes. */
export function useRawManifest(sessionId: string, revision: number): RawManifestState {
  const key = `${sessionId}/${revision}`, [state, setState] = useState<{ key: string; value: RawManifestState }>({ key, value: LOADING });
  useEffect(() => {
    const controller = new AbortController();
    void readRawManifest((url, init) => window.fetch(url, init), sessionId, revision, controller.signal).then(value => { if (!controller.signal.aborted) setState({ key, value }); });
    return () => controller.abort();
  }, [key]);
  return state.key === key ? state.value : LOADING;
}
/** A size in binary units: exact bytes below 1 KiB, else two decimals below 10, one below 100, whole units above. */
export function formatBytes(bytes: bigint): string {
  if (bytes < BigInt(UNIT_STEP)) return `${bytes.toLocaleString()} B`;
  let value = Number(bytes), unit = 0;
  while (value >= UNIT_STEP && unit < UNITS.length - 1) { value /= UNIT_STEP; unit++; }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 2 : value < 100 ? 1 : 0 })} ${UNITS[unit]}`;
}
