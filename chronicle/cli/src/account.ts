import { CliError, uncertain } from './errors.js';
import { Http } from './transport.js';
import { isObject, type Json } from './json.js';
import { SessionStore, type Session } from './files.js';
import { uuid } from './wire.js';
export function accountUser(value: unknown): Session['user'] {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'actor,displayName,id,login') throw new CliError('protocol-error', 'Invalid account user.');
  for (const key of ['id', 'login', 'displayName', 'actor']) if (typeof value[key] !== 'string' || value[key].length === 0) throw new CliError('protocol-error', 'Invalid account user.');
  if (!/^[\x21-\x7e]+$/.test(value['actor'] as string)) throw new CliError('protocol-error', 'Invalid account owner binding.');
  return value as unknown as Session['user'];
}
function accountScopes(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length || value.some(v => !['Ingest', 'Read', 'Raw'].includes(v as string)) || (value.includes('Raw') && !value.includes('Read'))) throw new CliError('protocol-error', 'Invalid account scopes.');
}
function accountToken(value: unknown): void {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'createdAt,id,name,revoked,scopes,source' || typeof value['id'] !== 'string' || typeof value['name'] !== 'string' || !['configured', 'issued'].includes(value['source'] as string) || typeof value['revoked'] !== 'boolean' || !(value['createdAt'] === null || typeof value['createdAt'] === 'string')) throw new CliError('protocol-error', 'Invalid account token metadata.');
  try { uuid(value['id']); } catch { throw new CliError('protocol-error', 'Invalid account token identifier.'); }
  accountScopes(value['scopes']);
}
export function accountIssued(value: unknown): void {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'secret,token' || typeof value['secret'] !== 'string' || !/^[A-Za-z0-9_+/.=-]{43,1024}$/.test(value['secret'])) throw new CliError('protocol-error', 'Invalid issued account response.');
  accountToken(value['token']);
}
export function accountAcknowledgement(value: unknown): { ok: true } {
  if (!isObject(value) || Object.keys(value).join(',') !== 'ok' || value['ok'] !== true) throw uncertain(null);
  return { ok: true };
}
export async function login(http: Http, store: SessionStore, name: string, password: string): Promise<unknown> {
  const { data, headers } = await http.request('/api/account/v1/login', 'POST', { login: name, password }, null, false, { secrets: [password] });
  if (!isObject(data) || Object.keys(data).join(',') !== 'user') throw new CliError('protocol-error', 'Invalid login response.'); const user = accountUser(data['user']);
  const cookies = headers.getSetCookie().filter(v => v.startsWith('chronicle_session='));
  if (cookies.length !== 1) throw new CliError('protocol-error', 'Login did not return exactly one independent session cookie.');
  const parts = cookies[0]!.split(';').map(p => p.trim()); const cookie = parts[0]!.slice('chronicle_session='.length);
  if (!/^[A-Za-z0-9_-]{16,8192}$/.test(cookie) || !parts.some(p => p.toLowerCase() === 'httponly') || !parts.some(p => p.toLowerCase() === 'samesite=strict') || parts.some(p => /^domain=/i.test(p)) || (http.origin.startsWith('https:') && !parts.some(p => p.toLowerCase() === 'secure'))) throw new CliError('protocol-error', 'Unsafe or malformed independent session cookie.');
  store.save({ origin: http.origin, cookie, actor: user.actor, user }); return { user };
}
export async function settings(http: Http, session: Session): Promise<Json> {
  const { data } = await http.request('/api/account/v1', 'GET', null, { session, actor: false }, false);
  if (!isObject(data) || Object.keys(data).sort().join(',') !== 'scopes,tokens,user') throw new CliError('protocol-error', 'Invalid account settings response.'); const user = accountUser(data['user']);
  if (user.id !== session.user.id || user.actor !== session.actor || user.login !== session.user.login) throw new CliError('unauthorized', 'Account owner changed; login again.');
  if (!Array.isArray(data['tokens']) || !Array.isArray(data['scopes'])) throw new CliError('protocol-error', 'Invalid account token metadata.');
  accountScopes(data['scopes']); for (const token of data['tokens']) accountToken(token);
  return data;
}
