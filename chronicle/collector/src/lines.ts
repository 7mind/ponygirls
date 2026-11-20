import { readSync } from 'node:fs';
import { CollectorError } from './domain.ts';

export const READ_BUFFER_BYTES = 1_048_576;
const MIN_LINE_CAPACITY = 65_536;
/** The most bytes any line reader of this process has held at once: its read buffer and the line it assembles. */
export const readerMemory = { highWater: 0 };
/** A record longer than `limit` bytes; it was measured, never held. */
export class RecordOverLimitError extends CollectorError {
  constructor(readonly recordIndex: number, readonly size: bigint, readonly limit: number) { super('record-over-limit'); }
}
/** `bytes` is valid only until the next line is requested. `terminated` is false for a last line without `\n`. */
export interface Line { bytes: Buffer; offset: bigint; index: number; terminated: boolean }

/** The lines of `descriptor` in [start, end), numbered from `firstIndex`. A line longer than `cap` bytes stops the
 * reader with `RecordOverLimitError` before it is returned: the reader holds the read buffer and at most `cap` bytes. */
export function* readLines(descriptor: number, start: bigint, end: bigint, firstIndex: number, cap: number): Generator<Line> {
  const buffer = Buffer.allocUnsafe(end - start < BigInt(READ_BUFFER_BYTES) ? Math.max(1, Number(end - start)) : READ_BUFFER_BYTES);
  let line = Buffer.alloc(0); let length = 0; let measured = 0n; let over = false;
  let position = start; let lineStart = start; let index = firstIndex;
  const retain = (size: number): void => {
    if (size <= line.length) return;
    const grown = Buffer.allocUnsafe(Math.min(cap, Math.max(size, line.length * 2, MIN_LINE_CAPACITY)));
    line.copy(grown, 0, 0, length); line = grown;
    readerMemory.highWater = Math.max(readerMemory.highWater, buffer.length + line.length);
  };
  readerMemory.highWater = Math.max(readerMemory.highWater, buffer.length);
  while (position < end) {
    const wanted = end - position < BigInt(buffer.length) ? Number(end - position) : buffer.length;
    const count = readSync(descriptor, buffer, 0, wanted, position);
    // The file is shorter than its size at open: it changed while it was read.
    if (count === 0) throw new CollectorError('source-changed-during-read');
    const chunk = buffer.subarray(0, count);
    let from = 0;
    while (from < count) {
      const newline = chunk.indexOf(10, from); const stop = newline === -1 ? count : newline;
      const size = stop - from;
      if (!over && length + size > cap) { over = true; measured = BigInt(length); length = 0; }
      if (over) measured += BigInt(size);
      else if (newline === -1 || length > 0) { retain(length + size); chunk.copy(line, length, from, stop); length += size; }
      if (newline === -1) break;
      if (over) throw new RecordOverLimitError(index, measured, cap);
      yield { bytes: length > 0 ? line.subarray(0, length) : chunk.subarray(from, stop), offset: lineStart, index, terminated: true };
      length = 0; from = newline + 1; index++; lineStart = position + BigInt(from);
    }
    position += BigInt(count);
  }
  if (over) throw new RecordOverLimitError(index, measured, cap);
  if (length > 0) yield { bytes: line.subarray(0, length), offset: lineStart, index, terminated: false };
}
