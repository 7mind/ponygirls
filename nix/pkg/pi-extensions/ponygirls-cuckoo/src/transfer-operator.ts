import {
  constants, openSync, closeSync, fstatSync, readSync, writeSync,
  fsyncSync, realpathSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { MAX_TRANSFER_MANIFEST_BYTES } from './experiments/session-transfer.ts';

export const MAX_TRANSFER_PATH_CHARS = 4096;

export interface TransferFiles {
  projectId(cwd: string): string;
  read(path: string, signal: AbortSignal): string;
  writeExclusive(
    path: string,
    text: string,
    assertCurrent: () => void,
  ): void;
}

function absolutePath(path: string): void {
  if (
    typeof path !== 'string' || path.length === 0 ||
    path.length > MAX_TRANSFER_PATH_CHARS ||
    path.includes('\0') || !isAbsolute(path)
  ) throw new Error('Transfer requires an explicit absolute file path');
}

function live(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Transfer cancelled');
}

function regularFile(fd: number): void {
  const stat = fstatSync(fd);
  if (!stat.isFile()) {
    throw new Error('Transfer requires a regular file');
  }
  if (stat.size > MAX_TRANSFER_MANIFEST_BYTES) {
    throw new Error('Transfer file exceeds its byte bound');
  }
}

/**
 * Explicit supplied paths only. No traversal, directory creation, session-file
 * loading, overwrite, cleanup deletion, credential access, or discovery.
 */
export class NativeTransferFiles implements TransferFiles {
  projectId(cwd: string): string {
    const canonical = realpathSync.native(cwd);
    return `cwd-sha256:${createHash('sha256')
      .update(canonical, 'utf8').digest('hex')}`;
  }

  read(path: string, signal: AbortSignal): string {
    absolutePath(path);
    live(signal);
    const fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      regularFile(fd);
      const buffer = Buffer.alloc(MAX_TRANSFER_MANIFEST_BYTES + 1);
      let size = 0;
      for (;;) {
        live(signal);
        if (size === buffer.length) {
          throw new Error('Transfer file exceeds its byte bound');
        }
        const count = readSync(
          fd, buffer, size, buffer.length - size, null,
        );
        if (count === 0) break;
        size += count;
      }
      if (size > MAX_TRANSFER_MANIFEST_BYTES) {
        throw new Error('Transfer file exceeds its byte bound');
      }
      live(signal);
      // Preserve a BOM so the exact canonical validator rejects it.
      return new TextDecoder('utf-8', {
        fatal: true, ignoreBOM: true,
      }).decode(buffer.subarray(0, size));
    } finally {
      closeSync(fd);
    }
  }

  writeExclusive(
    path: string,
    text: string,
    assertCurrent: () => void,
  ): void {
    absolutePath(path);
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > MAX_TRANSFER_MANIFEST_BYTES) {
      throw new Error('Transfer export exceeds its byte bound');
    }
    assertCurrent();
    const fd = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
        constants.O_NOFOLLOW | constants.O_NONBLOCK,
      0o600,
    );
    try {
      regularFile(fd);
      let offset = 0;
      while (offset < bytes.length) {
        assertCurrent();
        const count = writeSync(
          fd, bytes, offset, bytes.length - offset, null,
        );
        if (count <= 0) throw new Error('Transfer export made no progress');
        offset += count;
      }
      assertCurrent();
      fsyncSync(fd);
      assertCurrent();
    } finally {
      closeSync(fd);
    }
  }
}
