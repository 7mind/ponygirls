import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { CollectorError, hash } from './domain.ts';
import { privacyPolicy, type PrivacyPolicy } from './privacy.ts';
import type { Config } from './config.ts';

const MAX_SECRET_BYTES = 8192;
export interface SecretReader { read(path: string): string }
export class FileSecretReader implements SecretReader {
  read(path: string): string {
    let fd: number | null = null;
    try {
      if (!isAbsolute(path)) throw new Error();
      const canonical = realpathSync(path);
      if (canonical === '/nix/store' || canonical.startsWith('/nix/store/')) throw new Error();
      // Runtime credential symlinks (e.g. age deployments) are resolved once;
      // refuse a subsequent symlink substitution and nonregular blocking files.
      fd = openSync(canonical, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.size > BigInt(MAX_SECRET_BYTES) || (before.mode & 0o077n) !== 0n) throw new Error();
      const buffer = Buffer.alloc(MAX_SECRET_BYTES + 1); let size = 0;
      for (;;) {
        const count = readSync(fd, buffer, size, buffer.length - size, null); size += count;
        if (count === 0 || size === buffer.length) break;
      }
      const after = fstatSync(fd, { bigint: true });
      if (size > MAX_SECRET_BYTES || size !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error();
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
      if (text.trim().length === 0 || text.includes('\0')) throw new Error();
      return text;
    } catch { throw new CollectorError('privacy-secret-unavailable'); }
    finally { if (fd !== null) closeSync(fd); }
  }
}
export interface RuntimePrivacy { policy: PrivacyPolicy; identity: string }
export function resolveRuntimePrivacy(config: Config, secrets: SecretReader): RuntimePrivacy {
  try {
    const patterns = new Set(config.redactions.textPatterns);
    const paths = [...new Set([config.tokenFile, ...config.redactions.secretFiles])];
    for (const path of paths) {
      const text = secrets.read(path);
      if (Buffer.byteLength(text) > MAX_SECRET_BYTES || text.trim().length === 0 || text.includes('\0')) throw new Error();
      // Token transport trims surrounding whitespace. Other literal files retain
      // significant spaces, removing only one conventional terminal line ending.
      const literal = path === config.tokenFile ? text.trim() : text.replace(/\r?\n$/, '');
      for (const value of [literal, JSON.stringify(literal).slice(1, -1)]) if (value.length > 0) patterns.add(value);
    }
    const textPatterns = [...patterns].sort((a, b) => b.length - a.length || a.localeCompare(b));
    const policy = privacyPolicy({ fieldNames: config.redactions.fieldNames, textPatterns });
    // Only the digest crosses into durable policy metadata; never the values.
    const identity = hash(JSON.stringify(textPatterns));
    return { policy, identity };
  } catch { throw new CollectorError('privacy-secret-unavailable'); }
}
