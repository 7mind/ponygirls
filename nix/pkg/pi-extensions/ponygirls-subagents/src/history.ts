import { constants } from "node:fs";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { err } from "./errors.ts";

export const HISTORY_CHANNEL = "ponygirls-subagents:history-v1";
export const MAX_HISTORY_PAGE_BYTES = 4 * 1024 * 1024;
export const MAX_HISTORY_PAGE_RECORDS = 256;
export interface HistorySource {
  sourceId: string; rootSessionId: string; agentId: string; agentPath: string; sessionId: string;
  parentAgentId: string | null; taskRunId: string | null; kind: "agent" | "review"; copiedFrom: string | null; reconstructedPrefixBytes: number;
}
export interface HistoryPage { entries: readonly unknown[]; nextOffset: number; eof: boolean; ready: boolean; gaps: readonly string[] }
export interface HistoryFeed {
  sources(): readonly HistorySource[];
  read(sourceId: string, offset: number, limit: number): Promise<HistoryPage>;
  subscribe(listener: () => void): () => void;
}
export interface HistoryRequest { rootSessionId: string; respond(feed: HistoryFeed): void }
export interface RegisteredHistorySource extends HistorySource { sessionFile: string; gaps: string[] }
export function historyPath(rootDir: string, source: Pick<RegisteredHistorySource, "agentId" | "sessionFile">): string {
  if (!source.agentId || /[\\/]/.test(source.agentId) || source.agentId === "." || source.agentId === "..") throw err("RECOVERY_CORRUPT", "invalid history agent identity");
  const directory = resolve(rootDir, "sessions", source.agentId);
  const local = relative(directory, resolve(source.sessionFile));
  if (!isAbsolute(source.sessionFile) || local === "" || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) throw err("FORBIDDEN", "history source outside its agent session directory");
  return directory;
}
export function publicHistorySource(source: RegisteredHistorySource): HistorySource {
  const { sourceId, rootSessionId, agentId, agentPath, sessionId, parentAgentId, taskRunId, kind, copiedFrom, reconstructedPrefixBytes } = source;
  return { sourceId, rootSessionId, agentId, agentPath, sessionId, parentAgentId, taskRunId, kind, copiedFrom, reconstructedPrefixBytes };
}
export function nativeHistoryId(bytes: Uint8Array): string {
  const newline = bytes.indexOf(10);
  if (newline < 0 || newline > MAX_HISTORY_PAGE_BYTES) throw err("RECOVERY_CORRUPT", "history session header missing or oversized");
  let header: { type?: unknown; id?: unknown };
  try { header = JSON.parse(Buffer.from(bytes.subarray(0, newline)).toString("utf8")); }
  catch { throw err("RECOVERY_CORRUPT", "invalid history session header"); }
  if (header === null || header.type !== "session" || typeof header.id !== "string" || !header.id) throw err("RECOVERY_CORRUPT", "invalid history native session identity");
  return header.id;
}
export async function openRegisteredHistoryFile(rootDir: string, source: Pick<RegisteredHistorySource, "agentId" | "sessionFile">): Promise<FileHandle> {
  const directory = historyPath(rootDir, source);
  const canonical = await realpath(source.sessionFile);
  const canonicalRoot = await realpath(rootDir);
  const expected = join(canonicalRoot, "sessions", source.agentId);
  const parent = await realpath(directory);
  if (parent !== expected || !canonical.startsWith(`${parent}${sep}`)) throw err("FORBIDDEN", "history source symlink escapes its agent directory");
  const file = await open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (process.platform === "linux" && await realpath(`/proc/self/fd/${file.fd}`) !== canonical) throw err("FORBIDDEN", "history source changed during open");
    if (!(await file.stat()).isFile()) throw err("RECOVERY_CORRUPT", "history source is not a regular file");
    return file;
  } catch (error) { await file.close(); throw error; }
}
export async function reconstructedHistoryPrefix(rootDir: string, source: Pick<RegisteredHistorySource, "agentId" | "sessionFile" | "sessionId">): Promise<number> {
  const file = await openRegisteredHistoryFile(rootDir, source);
  try {
    const size = (await file.stat()).size;
    const header = Buffer.alloc(Math.min(size, MAX_HISTORY_PAGE_BYTES));
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (nativeHistoryId(header.subarray(0, bytesRead)) !== source.sessionId) throw err("RECOVERY_CORRUPT", "restored history native identity changed");
    const tail = Buffer.alloc(1);
    if (size === 0 || (await file.read(tail, 0, 1, size - 1)).bytesRead !== 1 || tail[0] !== 10) throw err("RECOVERY_CORRUPT", "restored history prefix is not finalized");
    await file.sync();
    return size;
  } finally { await file.close(); }
}
export async function readRegisteredHistoryPage(rootDir: string, source: RegisteredHistorySource, offset: number, limit: number): Promise<HistoryPage> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw err("INVALID", "invalid history page offset/limit");
  let file: FileHandle;
  try { file = await openRegisteredHistoryFile(rootDir, source); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], nextOffset: offset, eof: true, ready: false, gaps: [...source.gaps, "Registered native session is unavailable or not yet materialized"] };
    throw error;
  }
  try {
    const stat = await file.stat();
    if (offset > stat.size) throw err("RECOVERY_CORRUPT", "history source shrank behind cursor");
    const header = Buffer.alloc(Math.min(stat.size, MAX_HISTORY_PAGE_BYTES));
    const headerRead = await file.read(header, 0, header.length, 0);
    if (offset === 0 && headerRead.bytesRead < MAX_HISTORY_PAGE_BYTES && header.subarray(0, headerRead.bytesRead).indexOf(10) < 0) {
      return { entries: [], nextOffset: 0, eof: true, ready: false, gaps: [...source.gaps, "Incomplete native session header is not finalized"] };
    }
    if (nativeHistoryId(header.subarray(0, headerRead.bytesRead)) !== source.sessionId) throw err("RECOVERY_CORRUPT", "history source native identity changed");
    if (offset > 0) {
      const previous = Buffer.alloc(1); await file.read(previous, 0, 1, offset - 1);
      if (previous[0] !== 10) throw err("INVALID", "history cursor must follow a complete JSONL record");
    }
    const buffer = Buffer.alloc(Math.min(MAX_HISTORY_PAGE_BYTES, stat.size - offset));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    const bytes = buffer.subarray(0, bytesRead); const entries: unknown[] = [];
    let position = 0;
    while (position < bytes.length && entries.length < Math.min(limit, MAX_HISTORY_PAGE_RECORDS)) {
      const end = bytes.indexOf(10, position);
      if (end < 0) {
        if (position === 0 && bytes.length === MAX_HISTORY_PAGE_BYTES) throw err("PAYLOAD_TOO_LARGE", "history JSONL record exceeds page bound");
        break;
      }
      let entry: unknown;
      try { entry = JSON.parse(bytes.subarray(position, end).toString("utf8")); }
      catch { throw err("RECOVERY_CORRUPT", "malformed finalized history record"); }
      if (offset + position !== 0) entries.push(entry);
      position = end + 1;
    }
    const partial = bytes.indexOf(10, position) < 0;
    return { entries, nextOffset: offset + position, eof: offset + bytesRead >= stat.size && partial,
      ready: !(offset + bytesRead >= stat.size && partial && position < bytes.length),
      gaps: [...source.gaps, ...(offset + bytesRead >= stat.size && partial && position < bytes.length ? ["Incomplete trailing JSONL record is not finalized"] : [])] };
  } finally { await file.close(); }
}
