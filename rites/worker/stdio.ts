// Bounded single-descriptor reads. Used for the request frame on stdin and
// for the operator-owned model config file; neither may be trusted with an
// unbounded size.

import { readSync } from "node:fs";

export class BoundedReadError extends Error {
  constructor(readonly reason: "exceeds-limit") {
    super(reason);
    this.name = "BoundedReadError";
  }
}

export class ReadIoError extends Error {
  constructor(readonly cause: Error) {
    super("io-error");
    this.name = "ReadIoError";
  }
}

/**
 * Read one descriptor until EOF, never accumulating more than `maxBytes`.
 * Throws BoundedReadError("exceeds-limit") as soon as the stream would exceed
 * the bound; the descriptor is left open for the caller to close.
 */
export function readAllBounded(fd: number, maxBytes: number): Uint8Array {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.alloc(64 * 1024);
    let read: number;
    try {
      read = readSync(fd, chunk, 0, chunk.byteLength, null);
    } catch (error) {
      throw new ReadIoError(error instanceof Error ? error : new Error(String(error)));
    }
    if (read === 0) {
      break;
    }
    total += read;
    if (total > maxBytes) {
      throw new BoundedReadError("exceeds-limit");
    }
    chunks.push(chunk.subarray(0, read));
  }
  return Buffer.concat(chunks);
}
