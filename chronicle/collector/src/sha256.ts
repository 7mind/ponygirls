import { CollectorError } from './domain.ts';

const K = Int32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2);
const INITIAL = Int32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
const BLOCK_BYTES = 64;
/** Eight 32-bit words and the 64-bit byte count precede the pending bytes in an exported state. */
const STATE_HEADER_BYTES = 40;

/** SHA-256 whose state can be exported after any number of bytes and resumed later (append-limits spec §2.2, M4):
 * the redacted raw's digest continues from a checkpoint instead of hashing the prefix again. The exported state is the
 * server's `raw_state` format, hex: 8 × u32 BE, the byte count as u64 BE, then the 0–63 pending bytes. */
export class Sha256 {
  private readonly words = new Int32Array(8);
  private readonly schedule = new Int32Array(64);
  private readonly pending = Buffer.alloc(BLOCK_BYTES);
  private pendingLength = 0;
  private length = 0n;
  constructor() { this.words.set(INITIAL); }
  static resume(state: string): Sha256 {
    const bytes = Buffer.from(state, 'hex'); const hash = new Sha256();
    if (bytes.length < STATE_HEADER_BYTES || bytes.length >= STATE_HEADER_BYTES + BLOCK_BYTES || bytes.toString('hex') !== state) throw new CollectorError('invalid-hash-state');
    for (let index = 0; index < 8; index++) hash.words[index] = bytes.readInt32BE(4 * index);
    hash.length = bytes.readBigUInt64BE(32); hash.pendingLength = bytes.length - STATE_HEADER_BYTES;
    if (BigInt(hash.pendingLength) !== hash.length % BigInt(BLOCK_BYTES)) throw new CollectorError('invalid-hash-state');
    bytes.copy(hash.pending, 0, STATE_HEADER_BYTES);
    return hash;
  }
  update(data: Uint8Array): this {
    const count = data.length; let offset = 0; this.length += BigInt(count);
    if (this.pendingLength > 0) {
      const take = Math.min(BLOCK_BYTES - this.pendingLength, count);
      this.pending.set(data.subarray(0, take), this.pendingLength); this.pendingLength += take; offset = take;
      if (this.pendingLength < BLOCK_BYTES) return this;
      this.block(this.pending, 0); this.pendingLength = 0;
    }
    const whole = offset + Math.floor((count - offset) / BLOCK_BYTES) * BLOCK_BYTES;
    for (let at = offset; at < whole; at += BLOCK_BYTES) this.block(data, at);
    if (whole < count) { this.pending.set(data.subarray(whole, count)); this.pendingLength = count - whole; }
    return this;
  }
  state(): string {
    const bytes = Buffer.alloc(STATE_HEADER_BYTES + this.pendingLength);
    for (let index = 0; index < 8; index++) bytes.writeInt32BE(this.words[index]!, 4 * index);
    bytes.writeBigUInt64BE(this.length, 32); this.pending.copy(bytes, STATE_HEADER_BYTES, 0, this.pendingLength);
    return bytes.toString('hex');
  }
  /** The digest of the bytes so far, hex; the hash can be updated further. */
  digest(): string {
    const copy = Sha256.resume(this.state());
    const padding = Buffer.alloc((this.pendingLength < BLOCK_BYTES - 8 ? BLOCK_BYTES : 2 * BLOCK_BYTES) - this.pendingLength);
    padding[0] = 0x80; padding.writeBigUInt64BE(this.length * 8n, padding.length - 8);
    copy.update(padding);
    const out = Buffer.alloc(32); for (let index = 0; index < 8; index++) out.writeInt32BE(copy.words[index]!, 4 * index);
    return out.toString('hex');
  }
  /** One 64-byte block of `data` at `offset`. A call per block: V8 compiles this small function far better than one
   * long loop over all blocks (≈ 2.5×). */
  private block(data: Uint8Array, offset: number): void {
    const w = this.schedule; const h = this.words;
    for (let index = 0, at = offset; index < 16; index++, at += 4) w[index] = (data[at]! << 24) | (data[at + 1]! << 16) | (data[at + 2]! << 8) | data[at + 3]!;
    for (let index = 16; index < 64; index++) {
      const x = w[index - 15]!, y = w[index - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) | 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, k = h[7]!;
    for (let index = 0; index < 64; index++) {
      const t1 = (k + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[index]! + w[index]!) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0; h[1] = (h[1]! + b) | 0; h[2] = (h[2]! + c) | 0; h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0; h[5] = (h[5]! + f) | 0; h[6] = (h[6]! + g) | 0; h[7] = (h[7]! + k) | 0;
  }
}
