import { CollectorError, object, type Json, type JsonObject } from './domain.ts';

export interface PrivacyRules { fieldNames: string[]; textPatterns: string[] }
export interface PrivacyPolicy { redact(value: Json): { value: Json; changed: boolean } }
const REDACTED = '[REDACTED]';
const BINARY_FIELDS = new Set(['base64', 'b64_json', 'bytes', 'blob', 'file_data', 'encrypted_content', 'encrypted_function_args', 'thinkingSignature', 'thoughtSignature', 'textSignature', 'signature']);
const CREDENTIAL_FIELDS = new Set(['authorization', 'apikey', 'api_key', 'access_token', 'refresh_token', 'password', 'secret', 'credential']);
const REMOTE_FIELDS = new Set(['gitRemote', 'repository_url', 'remote', 'remote_url']);

export function sanitizeRemote(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:' && url.protocol !== 'ssh:' && url.protocol !== 'git:') return REDACTED;
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString();
  } catch {
    const scp = /^(?:[^/@\s]+@)?([a-zA-Z0-9.-]+):([\w./-]+)$/.exec(value);
    return scp === null ? REDACTED : `${scp[1]}:${scp[2]}`;
  }
}

export function privacyPolicy(rules: PrivacyRules): PrivacyPolicy {
  const fields = new Set(rules.fieldNames.map(name => name.toLowerCase()));
  return {
    redact(input) {
      let changed = false;
      const walk = (value: Json, depth: number): Json => {
        if (depth > 64) throw new CollectorError('record-depth-limit');
        if (typeof value === 'string') {
          let result = value.replace(/data:[^\s"'<>]*;base64,[a-zA-Z0-9+/=_-]+/g, '[REDACTED:binary]');
          // Conservative policy: never persist long opaque base64 runs, even in unknown fields.
          result = result.replace(/[A-Za-z0-9+/_-]{256,}={0,2}/g, '[REDACTED:opaque]');
          for (const pattern of rules.textPatterns) result = result.split(pattern).join(REDACTED);
          if (result !== value) changed = true;
          if (/^\s*[{[]/.test(result)) {
            let embedded: Json | undefined;
            try { embedded = JSON.parse(result) as Json; } catch { /* Ordinary text is not necessarily JSON. */ }
            if (object(embedded) || Array.isArray(embedded)) {
              const sanitized = walk(embedded, depth + 1);
              if (JSON.stringify(sanitized) !== JSON.stringify(embedded)) { result = JSON.stringify(sanitized); changed = true; }
            }
          }
          return result;
        }
        if (Array.isArray(value)) return value.map(child => walk(child, depth + 1));
        if (object(value)) {
          const result: JsonObject = {};
          for (const [key, child] of Object.entries(value)) {
            if (BINARY_FIELDS.has(key) || (key === 'data' && typeof child === 'string') || (key === 'result' && value['type'] === 'image_generation_call') || CREDENTIAL_FIELDS.has(key.toLowerCase()) || fields.has(key.toLowerCase())) {
              result[key] = child === null ? null : REDACTED;
              if (result[key] !== child) changed = true;
            } else if (REMOTE_FIELDS.has(key) && typeof child === 'string') {
              result[key] = walk(sanitizeRemote(child), depth + 1);
              if (result[key] !== child) changed = true;
            } else result[key] = walk(child, depth + 1);
          }
          return result;
        }
        return value;
      };
      return { value: walk(input, 0), changed };
    },
  };
}
