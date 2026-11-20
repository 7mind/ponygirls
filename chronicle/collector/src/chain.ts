import { createHash, type Hash } from 'node:crypto';

/** The fields of a message that message chain v1 covers (`parentId` and `timestamp` absent as null). */
export interface ChainMessage { id: string; parentId: string | null; role: string; text: string; timestamp: string | null; recordIndex: number }
const MESSAGE_DOMAIN = 'chronicle.message.v1';
const PART_DOMAIN = 'chronicle.upload-part.v1';
const ZERO = Buffer.of(0);
const ONE = Buffer.of(1);
/** The server stores message text with U+0000 as the six characters `\u0000`; chains cover the stored text. */
export const storedText = (text: string): string => text.replaceAll('\u0000', '\\u0000');
const u32 = (value: number): Buffer => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; };
function field(digest: Hash, value: string): void { const bytes = Buffer.from(value, 'utf8'); digest.update(u32(bytes.length)); digest.update(bytes); }
function optional(digest: Hash, value: string | null): void { if (value === null) digest.update(ZERO); else { digest.update(ONE); field(digest, value); } }

/** m(x) of message chain v1 (append-only ingest spec §5). */
export function messageDigest(message: ChainMessage): Buffer {
  const digest = createHash('sha256').update(MESSAGE_DOMAIN).update(ZERO);
  field(digest, message.id); optional(digest, message.parentId); field(digest, message.role); field(digest, storedText(message.text)); optional(digest, message.timestamp);
  const index = Buffer.alloc(4); index.writeInt32BE(message.recordIndex);
  return digest.update(index).digest();
}
/** chain₀; chains travel as lowercase hex. */
export const INITIAL_CHAIN = createHash('sha256').update('chronicle.message-chain.v1').digest('hex');
export class MessageChain {
  private value: Buffer;
  constructor(hex: string = INITIAL_CHAIN) { this.value = Buffer.from(hex, 'hex'); }
  /** chainₖ₊₁ = SHA-256(chainₖ ‖ m(xₖ)). */
  extend(digest: Buffer): void { this.value = createHash('sha256').update(this.value).update(digest).digest(); }
  get hex(): string { return this.value.toString('hex'); }
}
/** SHA-256("chronicle.upload-part.v1" ‖ 0x00 ‖ u64be(len raw) ‖ raw ‖ u32be(n) ‖ m(x₁) ‖ … ‖ m(xₙ)), hex; `raw` in pieces. */
export function partDigest(raw: readonly string[], messageDigests: readonly Buffer[]): string {
  const length = Buffer.alloc(8); length.writeBigUInt64BE(raw.reduce((sum, piece) => sum + BigInt(Buffer.byteLength(piece)), 0n));
  const digest = createHash('sha256').update(PART_DOMAIN).update(ZERO).update(length);
  for (const piece of raw) digest.update(piece, 'utf8');
  digest.update(u32(messageDigests.length));
  for (const message of messageDigests) digest.update(message);
  return digest.digest('hex');
}
