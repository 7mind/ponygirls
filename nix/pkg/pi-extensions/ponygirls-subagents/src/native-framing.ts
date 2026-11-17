import { createHash } from "node:crypto";

export const NATIVE_CHUNK_BYTES = 128 * 1024;
export const NATIVE_LOGICAL_BYTES = 64 * 1024 * 1024;
const MAX_TRANSFERS = 4;

interface Chunk {
  id: string;
  type: "canonical-json-v1";
  index: number;
  length: number;
  digest: string;
  data: string;
}
interface Transfer {
  bytes: Buffer;
  offset: number;
  index: number;
  digest: string;
  owner: string;
}

function encode(value: unknown): Buffer {
  let json: string | undefined;
  try { json = JSON.stringify(value); }
  catch { throw new Error("INVALID: native message is not canonical JSON"); }
  if (json === undefined) throw new Error("INVALID: native message is not JSON");
  const bytes = Buffer.from(json, "utf8");
  if (bytes.length > NATIVE_LOGICAL_BYTES) throw new Error("PAYLOAD_TOO_LARGE: native logical message exceeds 64 MiB");
  return bytes;
}
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function transfer(bytes: Buffer): Transfer { return { bytes, offset: 0, index: 0, digest: digest(bytes), owner: "" }; }
function chunk(id: string, entry: Transfer): Chunk {
  const data = entry.bytes.subarray(entry.offset, entry.offset + NATIVE_CHUNK_BYTES);
  const frame: Chunk = { id, type: "canonical-json-v1", index: entry.index++, length: entry.bytes.length, digest: entry.digest, data: data.toString("base64") };
  entry.offset += data.length;
  return frame;
}
function receive(value: unknown, entries: Map<string, Transfer>, owner: string): { id: string; complete: boolean; value?: unknown } {
  if (typeof value !== "object" || value === null) throw new Error("INVALID: missing native chunk");
  const c = value as Chunk;
  if (typeof c.id !== "string" || c.id.length > 128 || c.type !== "canonical-json-v1" || !Number.isSafeInteger(c.index) || c.index < 0 || !Number.isSafeInteger(c.length) || c.length <= 0 || c.length > NATIVE_LOGICAL_BYTES || typeof c.digest !== "string" || !/^[a-f0-9]{64}$/.test(c.digest) || typeof c.data !== "string" || c.data.length > Math.ceil(NATIVE_CHUNK_BYTES / 3) * 4) throw new Error("INVALID: malformed native chunk");
  const data = Buffer.from(c.data, "base64");
  if (data.toString("base64") !== c.data || data.length === 0 || data.length > NATIVE_CHUNK_BYTES) throw new Error("INVALID: native chunk encoding");
  let entry = entries.get(c.id);
  if (entry === undefined) {
    if (c.index !== 0 || entries.size >= MAX_TRANSFERS) throw new Error("INVALID: unexpected native transfer");
    entry = { bytes: Buffer.alloc(c.length), offset: 0, index: 0, digest: c.digest, owner };
    entries.set(c.id, entry);
  }
  if (entry.owner !== owner || c.index !== entry.index || c.length !== entry.bytes.length || c.digest !== entry.digest || entry.offset + data.length > c.length) throw new Error("INVALID: out-of-order native chunk");
  data.copy(entry.bytes, entry.offset);
  entry.offset += data.length;
  entry.index++;
  if (entry.offset !== c.length) return { id: c.id, complete: false };
  entries.delete(c.id);
  if (digest(entry.bytes) !== c.digest) throw new Error("INVALID: native message digest mismatch");
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(entry.bytes)) as unknown; }
  catch { throw new Error("INVALID: native logical message is not canonical JSON"); }
  return { id: c.id, complete: true, value: decoded };
}

export type NativeRoundTrip = (frame: unknown) => Promise<unknown>;

async function nativeCall(roundTrip: NativeRoundTrip, value: unknown, id: string): Promise<unknown> {
  const entry = transfer(encode(value));
  let reply: unknown;
  do {
    reply = await roundTrip({ kind: "upload", chunk: chunk(id, entry) });
    if ((reply as { ok: boolean }).ok !== true) throw new Error((reply as { error: string }).error);
  } while (entry.offset < entry.bytes.length);
  const received = new Map<string, Transfer>();
  for (;;) {
    const frame = reply as { ok: boolean; error?: string; chunk?: unknown };
    if (frame.ok !== true) throw new Error(typeof frame.error === "string" ? frame.error : "INVALID: native transport rejected message");
    const decoded = receive(frame.chunk, received, "");
    if (decoded.complete) return decoded.value;
    reply = await roundTrip({ kind: "download", id: decoded.id });
  }
}

export class NativeRpcClient {
  private sequence = 0;
  call(roundTrip: NativeRoundTrip, value: unknown): Promise<unknown> {
    return nativeCall(roundTrip, value, String(this.sequence++));
  }
}

export class NativeFrameServer<Owner> {
  private highestIncoming = -1;
  private readonly incoming = new Map<string, Transfer>();
  private readonly outgoing = new Map<string, Transfer>();
  private retired = false;

  private readonly invoke: (value: unknown, owner: Owner) => Promise<unknown>;

  private readonly ownerKey: (owner: Owner) => string;

  constructor(invoke: (value: unknown, owner: Owner) => Promise<unknown>, ownerKey: (owner: Owner) => string) { this.invoke = invoke; this.ownerKey = ownerKey; }

  retire(): void { this.retired = true; this.incoming.clear(); this.outgoing.clear(); }

  async handle(value: unknown, owner: Owner): Promise<unknown> {
    try {
      if (this.retired) throw new Error("STALE_INSTANCE: native transport retired");
      if (typeof value !== "object" || value === null) throw new Error("INVALID: native frame");
      const frame = value as { kind: string; chunk?: unknown; id?: string };
      if (frame.kind === "download") {
        const entry = typeof frame.id === "string" ? this.outgoing.get(frame.id) : undefined;
        if (entry === undefined || entry.owner !== this.ownerKey(owner)) throw new Error("INVALID: unknown native download");
        const next = chunk(frame.id!, entry);
        if (entry.offset === entry.bytes.length) this.outgoing.delete(frame.id!);
        return { ok: true, chunk: next };
      }
      if (frame.kind !== "upload") throw new Error("INVALID: native frame kind");
      const incoming = frame.chunk as Chunk;
      if (!this.incoming.has(incoming.id)) {
        const id = Number(incoming.id);
        if (!Number.isSafeInteger(id) || String(id) !== incoming.id || id <= this.highestIncoming) throw new Error("INVALID: replayed native transfer");
        this.highestIncoming = id;
      }
      const input = receive(frame.chunk, this.incoming, this.ownerKey(owner));
      if (!input.complete) return { ok: true };
      const output = transfer(encode(await this.invoke(input.value, owner)));
      if (this.retired) throw new Error("STALE_INSTANCE: native transport retired");
      output.owner = this.ownerKey(owner);
      const next = chunk(input.id, output);
      if (output.offset !== output.bytes.length) {
        if (this.outgoing.size >= MAX_TRANSFERS) throw new Error("PAYLOAD_TOO_LARGE: too many native downloads");
        this.outgoing.set(input.id, output);
      }
      return { ok: true, chunk: next };
    } catch (e) {
      this.incoming.clear();
      this.outgoing.clear();
      return { ok: false, error: e instanceof Error ? e.message : "INVALID: native transport failure" };
    }
  }
}
