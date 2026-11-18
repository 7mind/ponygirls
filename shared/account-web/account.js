// Shared account views: a thin vanilla-JS layer over the DOM-free client in account-client.js.
// Look and flow: docs/drafts/20261117-2130-dashboard-redesign-spec.md §4; behaviour:
// docs/drafts/20261117-2040-self-signup-admin-enrollment-design.md §4.9, §5.1, §12.
// Host contract (README.md): form[data-account-login] or [data-account-auth] while signed out,
// [data-account-outlet data-account-user-id] while signed in, [data-account-settings] triggers,
// events account:invalidate (in), account:changed and account:route (out).
// Account v1 is deliberately independent of each application's domain protocol.
import {
  ACCOUNT_API_PATH, ACCOUNT_REQUEST_HEADERS, ACCOUNT_REQUEST_TIMEOUT_MS, AccountApiError, AccountOwnerChangedError, AccountResponseError,
  actionStart, captureEnrollmentFragment, createAccountClient, enrollmentLink, generateTotpSecret,
  loadEnrollment, loadSignup, loginInitial, loginReduce, otpauthUri, qrMatrix, recoveryInitial, runAction,
  submitEnrollment, submitLogin, submitRecovery, submitSignup
} from './account-client.js';

const ROUTE_PREFIX = '#account/';
const SECTIONS = ['profile', 'password', 'two-factor', 'tokens', 'users'];
const AUTH_ROUTES = ['signup', 'recover'];
const DEFAULT_SECTION = 'profile';
const FALLBACK_SECTION = 'tokens';
const TOKEN_NAME_MAX = 120;
const TOKEN_FILTER_MIN_ROWS = 10;
const TOKEN_ID_TAIL = 12;
const SECRET_VISIBLE_TAIL = 4;
const MASK_CHAR = '•';
const KEY_GROUP = 4;
const TOAST_MS = 3500;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const MINUTES_PER_HOUR = 60;
const SHORT_WAIT_SECONDS = 90;
const METER_BARS = 4;
const METER_STRONG_EXTRA = 4;
const DEFAULT_USERNAME_PATTERN = '^[a-z][a-z0-9_-]{2,31}$';
const ACTOR_HEADER = 'X-Account-Actor';
const KNOWN_SCOPES = ['api', 'Ingest', 'Read', 'Raw'];
const SCOPE_MEANINGS = { Ingest: 'upload sessions (collectors)', Read: 'search and read indexed sessions', Raw: 'original source records; includes Read' };
const APP_NAMES = { chronicle: 'Chronicle', haystack: 'Haystack', manure: 'Manure' };
// Column headers of the two list tables; a narrow screen repeats them as labels of the stacked cells (data-label).
const TOKEN_COLUMNS = { name: 'Name', scopes: 'Permissions', source: 'Source', created: 'Created', id: 'Token ID' };
const USER_COLUMNS = { user: 'User', status: 'Status', source: 'Source', twoFactor: 'Two-factor', created: 'Created' };
const USER_FILTERS = [['all', 'All'], ['pending', 'Pending approval'], ['disabled', 'Disabled'], ['admins', 'Admins']];
const PROOF_FIELD = { name: 'currentPassword', label: 'Your current password', type: 'password', hint: 'Required for this change; used for this request only.' };
const PROOF_REJECTED_TEXT = 'Your password was not accepted.';
const SVG_NS = 'http://www.w3.org/2000/svg';
const CIRCLE_9 = 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0';
const ICONS = {
  alert: ['M12 4 2.5 20h19L12 4z', 'M12 10v4.5M12 17.5v.1'],
  clock: [CIRCLE_9, 'M12 7v5l3 2'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  info: [CIRCLE_9, 'M12 11v6M12 7.5v.1'],
  lock: ['M7 11h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  key: ['M4 15a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'm11 12 9-9M16 7l3 3M14 9l2 2'],
  user: ['M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M4 21a8 8 0 0 1 16 0'],
  users: ['M5.5 8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0', 'M2.5 20a6.5 6.5 0 0 1 13 0', 'M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8'],
  shield: ['M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6L12 3z'],
  refresh: ['M20 11a8 8 0 0 0-14.5-4.5L4 8', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.5 4.5L20 16', 'M20 20v-4h-4'],
  plus: ['M12 5v14M5 12h14'],
  copy: ['M11 9h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M5 15V6a2 2 0 0 1 2-2h8'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  more: ['M3.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M10.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0M17.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0'],
  search: ['M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'm20 20-3.5-3.5'],
  x: ['M6 6l12 12M18 6 6 18'],
  'x-circle': [CIRCLE_9, 'm9 9 6 6M15 9l-6 6']
};
const DATE_FORMAT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Error texts shared by the views; `code` values come from describeFailure / the client's state machines.
const UNAVAILABLE_TEXT = 'The account service is unavailable or returned an invalid response. Your credentials have not been rejected. Retry when the service is available.';
const SESSION_TEXT = 'Your browser session is no longer authorized. Sign in again.';
const CONNECTION_TEXT = 'The account could not be confirmed (connection lost). Nothing was changed; retry when the connection is back.';
const HOLD_TEXT = 'A request on this page is still running. Stay here until it finishes; its result is shown only here.';

function waitText(retryAfter) {
  if (retryAfter === null) return 'later';
  if (retryAfter < SHORT_WAIT_SECONDS) return `in ${retryAfter} seconds`;
  return `in ${Math.ceil(retryAfter / SECONDS_PER_MINUTE)} minutes`;
}
function legacyMessage(cause) {
  if (cause instanceof AccountApiError && cause.status === 401) return SESSION_TEXT;
  if (cause instanceof AccountApiError && cause.status === 403) return 'This action is not permitted for the current account. Refresh the page before trying again.';
  if (cause instanceof AccountApiError && cause.status >= 400 && cause.status < 500) return 'The account request was rejected. Check your input and refresh the list before trying again.';
  return UNAVAILABLE_TEXT;
}
function validUser(user) {
  return user !== null && typeof user === 'object' && typeof user.id === 'string' && user.id.length > 0 && typeof user.login === 'string' && typeof user.displayName === 'string' && typeof user.actor === 'string' && user.actor.length > 0;
}
function validToken(token) {
  return token !== null && typeof token === 'object' && typeof token.id === 'string' && token.id.length > 0 && typeof token.name === 'string' && ['configured', 'issued'].includes(token.source) && (token.createdAt === null || typeof token.createdAt === 'string') && typeof token.revoked === 'boolean' && Array.isArray(token.scopes) && token.scopes.every(scope => typeof scope === 'string');
}
function validAccount(account) {
  return account !== null && typeof account === 'object' && validUser(account.user) && Array.isArray(account.tokens) && account.tokens.every(validToken) && Array.isArray(account.scopes) && account.scopes.length > 0 && account.scopes.every(scope => KNOWN_SCOPES.includes(scope)) && new Set(account.scopes).size === account.scopes.length;
}
export function parseAccountRoute(hash) {
  return hash.startsWith(ROUTE_PREFIX) ? hash.slice(ROUTE_PREFIX.length) : null;
}
const capitalized = text => text.charAt(0).toUpperCase() + text.slice(1);
const groupedKey = secret => secret.match(new RegExp(`.{1,${KEY_GROUP}}`, 'g')).join(' ');
const maskedSecret = secret => MASK_CHAR.repeat(Math.max(0, secret.length - SECRET_VISIBLE_TAIL)) + secret.slice(-SECRET_VISIBLE_TAIL);

// ---------------------------------------------------------------------------------------------
// The coordinator is the ONLY holder of the account client and of the existing-endpoint requests. The signed-in
// area gets an `io` from it and nothing else (the signed-out views get a client: they hold no authority to lose).
//   - one exclusive slot for {section write | sign-out};
//   - a monotonic authority epoch: a read's verdict (verified, unverified, lost) counts only while it is the
//     newest authority read;
//   - per-resource generations: a read's data is applied only if it is newer than the data already applied;
//   - completions are bound to their area: after dispose a read applies nothing and a write never resumes.
// Resource modes: 'confirms' = owner-checked (success verifies), 'checks' = not owner-checked (success decides
// nothing); for both a transport failure unverifies (except an area's very first load) and 401 loses.
const RESOURCE_MODES = { account: 'confirms', profile: 'confirms', admin: 'checks', policy: 'none' };
const DATA_LEVEL_STATUSES = [403, 404];

class AccountStop extends Error {
  constructor() { super('The account read before a write did not confirm the owner'); }
}

function classifyFailure(cause) {
  if (cause instanceof AccountOwnerChangedError) return 'changed';
  if (cause instanceof AccountApiError && cause.status === 401) return 'signed-out';
  if (cause instanceof AccountApiError && DATA_LEVEL_STATUSES.includes(cause.status)) return 'refused';
  return 'unknown';
}

function createCoordinator({ fetch, window, onSlotChange }) {
  // `logouts` settles once every POST /logout sent so far has its answer or has failed.
  const state = { slot: null, epoch: 0, logouts: Promise.resolve() };
  const nextEpoch = () => ++state.epoch;
  const isCurrent = epoch => epoch === state.epoch;
  const never = () => new Promise(() => {});
  // Existing endpoints (GET /, POST /tokens, POST /tokens/{id}/revoke, POST /logout): same rules as account-client.js.
  async function endpoint(method, path, body, actor, signal) {
    const signals = [window.AbortSignal.timeout(ACCOUNT_REQUEST_TIMEOUT_MS)];
    if (signal !== null) signals.push(signal);
    const options = { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: window.AbortSignal.any(signals), headers: { ...ACCOUNT_REQUEST_HEADERS } };
    if (body !== null) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    if (actor !== null) options.headers[ACTOR_HEADER] = actor;
    const response = await fetch(ACCOUNT_API_PATH + path, options);
    if (!response.ok) throw new AccountApiError(response.status, null, null);
    try { return await response.json(); } catch { throw new AccountResponseError(); }
  }
  async function readOwnAccount(owner, signal) {
    const account = await endpoint('GET', '', null, null, signal);
    if (!validAccount(account)) throw new AccountResponseError();
    if (owner !== null && account.user.id !== owner) throw new AccountOwnerChangedError();
    return account;
  }
  function takeSlot(kind, holder) {
    if (state.slot !== null) return null;
    const taken = { kind, holder };
    state.slot = taken; onSlotChange();
    return taken;
  }
  function freeSlot(taken) { if (state.slot === taken) { state.slot = null; onSlotChange(); } }
  // Sign-out: GET / for the actor, then POST /logout. `owner` (null when no area is shown) must match the read.
  async function logout(owner, signal, alive) {
    let account;
    try { account = await readOwnAccount(owner, signal); } catch (cause) {
      if (!alive()) return { outcome: 'cancelled', cause };
      const kind = classifyFailure(cause);
      if (kind === 'signed-out') return { outcome: 'done', cause: null };
      return { outcome: kind === 'changed' ? 'changed' : 'failed', cause };
    }
    if (!alive()) return { outcome: 'cancelled', cause: null };
    try {
      // Once sent, the sign-out is not aborted with the area (a host may leave the page as the server ends the
      // session, e.g. on its live socket): the response must still clear the session cookie.
      const request = endpoint('POST', '/logout', {}, account.user.actor, null);
      state.logouts = Promise.all([state.logouts, request.then(() => null, () => null)]);
      const result = await request;
      if (result === null || result.ok !== true) throw new AccountResponseError();
    } catch (cause) {
      if (!alive()) return { outcome: 'cancelled', cause };
      if (classifyFailure(cause) !== 'signed-out') return { outcome: 'failed', cause };
    }
    nextEpoch(); // no authority read that started before the sign-out decides anything any more
    return { outcome: 'done', cause: null };
  }

  // The answer to a sign-out clears the session cookie, which the answers of sign-in, sign-up, recovery and enrollment
  // set: the signed-out views send their requests only after every sign-out sent so far has its answer (a host may
  // show its login page before that, e.g. when the server closes its live socket as it ends the session).
  async function afterLogouts(resource, options) {
    await state.logouts;
    return fetch(resource, options);
  }

  // hooks: alive(), trusted(), holder() (the area's identity), setAuthority(state), lose(reason).
  function forArea({ owner, signal, hooks }) {
    const client = createAccountClient({ fetch, requestTimeoutMs: ACCOUNT_REQUEST_TIMEOUT_MS, signal });
    const loaders = {
      account: () => readOwnAccount(owner, signal),
      profile: async () => {
        const profile = await client.profile();
        if (profile.user.id !== owner) throw new AccountOwnerChangedError();
        return profile;
      },
      policy: () => client.policy(),
      admin: async () => {
        const [users, enrollments] = await Promise.all([client.adminUsers(), client.enrollments()]);
        return { users, enrollments };
      }
    };
    const generations = Object.fromEntries(Object.keys(loaders).map(resource => [resource, { started: 0, applied: 0 }]));
    function judge(kind, ok, epoch, mode, first) {
      if (!isCurrent(epoch)) return 'stale';
      if (ok) { if (mode === 'confirms') hooks.setAuthority('verified'); return mode === 'confirms' ? 'verified' : 'none'; }
      if (kind === 'changed' || kind === 'signed-out') { hooks.lose(kind); return 'lost'; }
      if (kind === 'unknown' && !first) { hooks.setAuthority('unverified'); return 'unverified'; }
      return 'none';
    }
    // read(resource, apply, first): `apply({ ok, data, cause, kind, verdict })` runs only while the area lives and
    // only for the newest applied generation of the resource. Resolves to the same result; never after dispose.
    async function read(resource, apply, first) {
      const generation = ++generations[resource].started;
      const mode = RESOURCE_MODES[resource];
      const epoch = mode === 'none' ? null : nextEpoch();
      let result;
      try { result = { ok: true, data: await loaders[resource](), cause: null, kind: null }; }
      catch (cause) { result = { ok: false, data: null, cause, kind: classifyFailure(cause) }; }
      if (!hooks.alive()) return never();
      result.verdict = epoch === null ? 'none' : judge(result.kind, result.ok, epoch, mode, first);
      if (!hooks.alive()) return never();
      if (generation > generations[resource].applied) { generations[resource].applied = generation; apply(result); }
      return result;
    }
    // write(applyAccount, work): takes the slot (a refused start is an invariant violation: the busy rule disables
    // every entry point), preflights GET / with the owner check, runs `work(ops)` with the fresh actor and releases
    // the slot in finally. A failed preflight rejects with AccountStop; a disposed area's write never resumes.
    async function write(applyAccount, work) {
      if (!hooks.trusted()) throw new Error('Account: a write started while authority is unverified');
      const taken = takeSlot('write', hooks.holder());
      if (taken === null) throw new Error('Account: a write started while the slot is occupied');
      try {
        const preflight = await read('account', applyAccount, false);
        if (!preflight.ok) throw new AccountStop();
        const actor = preflight.data.user.actor;
        const ops = {
          post: (path, body) => endpoint('POST', path, body, actor, signal),
          readAccount: () => read('account', applyAccount, false),
          // The client re-reads the profile (owner check) before its POST: an authority read with its own epoch.
          action: async (name, target, input) => {
            const epoch = nextEpoch();
            const final = await runAction(client, actionStart(name, target), owner, input, () => {});
            if (!hooks.alive()) return never();
            if (final.phase === 'owner-changed' || final.phase === 'unauthorized') {
              judge(final.phase === 'owner-changed' ? 'changed' : 'signed-out', false, epoch, 'confirms', false);
              if (!hooks.alive()) return never();
            }
            return final;
          }
        };
        let result;
        try { result = await work(ops); } catch (cause) { if (!hooks.alive()) return never(); throw cause; }
        if (!hooks.alive()) return never();
        return result;
      } finally { freeSlot(taken); }
    }
    // signOut(): single-flight in the slot; the preflight is bound to this area (its signal aborts on dispose) and
    // to its owner: another owner means no POST and a lost area.
    async function signOut() {
      const taken = takeSlot('sign-out', hooks.holder());
      if (taken === null) return { outcome: 'held', cause: null };
      const epoch = nextEpoch();
      try {
        const result = await logout(owner, signal, hooks.alive);
        if (result.outcome === 'changed') judge('changed', false, epoch, 'confirms', false);
        return result;
      } finally { freeSlot(taken); }
    }
    return { read, write, signOut };
  }

  return {
    forArea,
    slotTaken: () => state.slot !== null,
    // Dispose frees the slot of its area at once (late completions find it already free).
    release: holder => { if (state.slot !== null && state.slot.holder === holder) { state.slot = null; onSlotChange(); } },
    nextEpoch,
    // Sign-out with no area shown: nothing to bind to, so no owner check.
    async signOutUnbound() {
      const taken = takeSlot('sign-out', null);
      if (taken === null) return { outcome: 'held', cause: null };
      try { return await logout(null, null, () => true); } finally { freeSlot(taken); }
    },
    authClient: signal => createAccountClient({ fetch: afterLogouts, requestTimeoutMs: ACCOUNT_REQUEST_TIMEOUT_MS, signal })
  };
}

export function installAccountUI(environment) {
  const { document, window } = environment;
  let area = null;
  const coordinator = createCoordinator({ fetch: environment.fetch, window, onSlotChange: () => { if (area !== null) area.applyBusy(); } });
  const enrollmentCode = { value: captureEnrollmentFragment({ location: window.location, history: window.history }) };
  // Token creation intents per owner survive area teardown while the page stays loaded (README: token creation recovery).
  const uncertainMints = new Map();
  // Shown-once links lost to a forced teardown, per owner, until the owner dismisses the notice.
  const lostLinks = new Map();
  const loginForms = new WeakMap();
  let ids = 0;
  let auth = null;
  let authInFlight = 0; // signed-out submissions (login, signup, enrollment, recovery) whose result renders in the current view
  async function authHeld(work) { authInFlight++; try { return await work(); } finally { authInFlight--; } }

  // ------------------------------------------------------------------------------------------
  // DOM helpers

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (typeof value === 'boolean') node.toggleAttribute(key, value);
      else node.setAttribute(key, String(value));
    }
    append(node, children);
    return node;
  }
  function append(node, children) {
    for (const child of children.flat()) {
      if (child === null || child === false) continue;
      node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }
  // Replaces children only when they differ, so a re-render keeps a persistent panel (and its focus) in place.
  function setChildren(parent, nodes) {
    const current = [...parent.children];
    if (current.length === nodes.length && current.every((node, index) => node === nodes[index])) return;
    parent.replaceChildren(...nodes);
  }
  function icon(name, small) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', small ? 'icon icon-sm' : 'icon'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    for (const data of ICONS[name]) { const path = document.createElementNS(SVG_NS, 'path'); path.setAttribute('d', data); svg.append(path); }
    return svg;
  }
  const nextId = prefix => `account-${prefix}-${++ids}`;
  const appName = () => APP_NAMES[document.documentElement.dataset.app] ?? null;
  function notice(kind, iconName, title, ...body) {
    return h('div', { class: `notice notice-${kind}` }, icon(iconName), h('div', { class: 'grow' }, title === null ? null : h('div', { class: 'notice-title' }, title), ...body));
  }
  function lostText(value) {
    const what = { token: `The secret of token “${value.name}”`, invite: `The invitation link for “${value.name}”`, reset: `The credential reset link for “${value.name}”` }[value.kind];
    const fix = value.kind === 'token' ? 'revoke the token and create a new one' : 'revoke it in Users and issue a new one';
    return value.uncertain ? `${what} may have been created but was never shown — ${fix}.` : `${what} is no longer available — ${fix}.`;
  }
  function field({ label, input, hint, id }) {
    input.id = id;
    const error = h('span', { class: 'field-error', id: `${id}-error`, hidden: true });
    const hintNode = hint === null ? null : h('span', { class: 'hint' }, hint);
    input.setAttribute('aria-describedby', `${id}-error`);
    const node = h('div', { class: 'field' }, h('label', { class: 'label', for: id }, label), input, hintNode, error);
    return {
      node, input,
      setError(text) {
        error.replaceChildren(); error.hidden = text === null;
        if (text === null) input.removeAttribute('aria-invalid');
        else { error.append(icon('alert', true), text); input.setAttribute('aria-invalid', 'true'); }
        if (hintNode !== null) hintNode.hidden = text !== null;
      }
    };
  }
  function input(props) { return h('input', { class: 'input', ...props }); }
  function codeInput(props) { return input({ class: 'input input-lg input-code', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, spellcheck: false, ...props }); }
  function setBusy(container, busy) {
    container.setAttribute('aria-busy', String(busy));
    for (const control of container.querySelectorAll('input, button, select, textarea')) {
      if (busy) { control.dataset.accountWasDisabled = String(control.disabled); control.disabled = true; }
      else if (control.dataset.accountWasDisabled !== undefined) { control.disabled = control.dataset.accountWasDisabled === 'true'; delete control.dataset.accountWasDisabled; }
    }
  }
  function dateNode(iso, format) {
    if (iso === null) return document.createTextNode('—');
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return document.createTextNode('date unavailable');
    return h('time', { datetime: iso, title: date.toISOString() }, format.format(date));
  }
  // Times of the last day with the hour, older ones with the year (spec §5 rule 9; the tooltip has the ISO time).
  function recentDate(iso) {
    return dateNode(iso, iso !== null && Date.now() - new Date(iso).getTime() < MS_PER_DAY ? DATE_TIME_FORMAT : DATE_FORMAT);
  }
  function expiryText(iso) {
    const minutes = Math.round((new Date(iso).getTime() - Date.now()) / MS_PER_MINUTE);
    if (Number.isNaN(minutes)) return '';
    if (minutes <= 0) return 'expired';
    return minutes < MINUTES_PER_HOUR ? `in ${minutes} min` : `in ${Math.round(minutes / MINUTES_PER_HOUR)} h`;
  }
  function toast(text) {
    let host = document.querySelector('.toasts[data-account-toasts]');
    if (host === null) { host = h('div', { class: 'toasts', role: 'status', 'data-account-toasts': true }); document.body.append(host); }
    const node = h('div', { class: 'toast' }, icon('check'), h('span', {}, text));
    host.append(node); window.setTimeout(() => node.remove(), TOAST_MS);
  }
  async function copyText(text) {
    if (!window.navigator.clipboard || typeof window.navigator.clipboard.writeText !== 'function') return false;
    try { await window.navigator.clipboard.writeText(text); return true; } catch { return false; }
  }
  function navigate(hash) {
    if (hash !== '') { window.location.hash = hash; return; }
    window.history.pushState(null, '', window.location.pathname + window.location.search);
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
  }

  // In-app confirmation and short forms: native <dialog>, Cancel focused unless the dialog asks for input.
  // `run(values)` resolves to null (close) or an error text (stay open); `fields` are { name, label, type, hint }.
  function openDialog({ title, body, fields, confirm, danger, cancel, extra, run }) {
    const titleId = nextId('dialog');
    const error = h('div', { class: 'notice notice-danger', role: 'alert', hidden: true });
    const inputs = fields.map(spec => {
      const control = spec.type === 'code' ? codeInput({ name: spec.name }) : input({ name: spec.name, type: spec.type, autocomplete: spec.type === 'password' ? 'current-password' : 'off', class: 'input input-lg' });
      return field({ label: spec.label, input: control, hint: spec.hint, id: nextId('dialog-field') });
    });
    const cancelButton = h('button', { class: 'btn', type: 'button' }, cancel);
    const confirmButton = h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'submit' }, confirm);
    const form = h('form', { novalidate: true },
      h('div', { class: 'dialog-body' }, ...body, ...inputs.map(item => item.node), error),
      h('div', { class: 'dialog-foot' }, ...extra.map(item => h('button', { class: item.class, type: 'button', onclick: () => { close(); item.onclick(); } }, item.label)), extra.length > 0 ? h('span', { class: 'grow' }) : null, cancelButton, confirmButton));
    const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': titleId, 'data-account-dialog': true }, h('div', { class: 'dialog-head' }, h('h2', { id: titleId }, title)), form);
    const opener = document.activeElement;
    let busy = false;
    function close() { if (dialog.open) dialog.close(); }
    dialog.addEventListener('close', () => { dialog.remove(); if (opener instanceof window.HTMLElement && opener.isConnected) opener.focus(); });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    cancelButton.addEventListener('click', close);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      busy = true; setBusy(form, true); error.hidden = true;
      const values = Object.fromEntries(inputs.map(item => [item.input.name, item.input.value]));
      for (const item of inputs) item.input.value = '';
      let failure;
      try { failure = await run(values); } finally {
        busy = false;
        if (dialog.isConnected) { setBusy(form, false); dialog.dispatchEvent(new window.Event('account:settled')); }
      }
      if (failure === null) close();
      else if (dialog.isConnected) { error.replaceChildren(icon('alert'), h('div', {}, failure)); error.hidden = false; (inputs.length > 0 ? inputs[0].input : cancelButton).focus(); }
    });
    document.body.append(dialog); dialog.showModal();
    (inputs.length > 0 ? inputs[0].input : cancelButton).focus();
    return { close, element: dialog };
  }

  // The authenticator set-up block (signup, enrollment, replacement): QR from qrMatrix as DOM cells plus the manual key.
  // `protect(element, kind)` registers the QR, the key and Copy key with an area's authority masking. The signed-out
  // set-up (signup, enrollment) passes `unprotected`: its secret is generated in this browser for an account that
  // does not exist yet, so there is no authority to lose while it is shown.
  function totpSetup({ issuer, secret, caption, label, protect }) {
    const qr = h('div', { class: 'qr', role: 'img', 'aria-label': label, 'data-account-qr': true });
    const status = h('span', { class: 'hint', role: 'status' }, 'Generated in this browser and shown only here; reloading creates a new key.');
    const copy = h('button', { class: 'btn btn-icon', type: 'button', 'aria-label': 'Copy key', title: 'Copy key', onclick: async () => {
      if (await copyText(secret)) toast('Key copied'); else status.textContent = 'Clipboard unavailable. Type the key into the app manually.';
    } }, icon('copy'));
    const key = h('code', { class: 'totp-key-text', 'aria-label': 'Authenticator set-up key', 'data-account-totp-key': true }, groupedKey(secret));
    function render(username) {
      const matrix = qrMatrix(otpauthUri({ issuer, username, secret }));
      qr.replaceChildren(...matrix.map(row => h('span', { class: 'qr-row' }, ...row.map(dark => h('i', { class: dark ? 'on' : null })))));
    }
    const node = h('div', { class: 'stack-sm' }, h('span', { class: 'small' }, caption),
      h('div', { class: 'totp' }, qr, h('div', { class: 'stack-sm' }, h('span', { class: 'hint' }, 'Cannot scan? Enter this key manually:'),
        h('div', { class: 'totp-key' }, key, copy), status)));
    protect(qr, 'conceal'); protect(key, 'conceal'); protect(copy, 'action');
    return { node, render };
  }
  const unprotected = () => {};
  function passwordMeter(minLength) {
    const bars = Array.from({ length: METER_BARS }, () => h('span', {}));
    const node = h('div', { class: 'pw-meter', 'aria-hidden': 'true' }, ...bars);
    return {
      node,
      update(length) {
        const count = length === 0 ? 0 : length < minLength ? 1 : length < minLength + METER_STRONG_EXTRA ? 2 : length < 2 * minLength ? 3 : METER_BARS;
        bars.forEach((bar, index) => { bar.className = index < count ? (length < minLength ? 'on weak' : 'on') : ''; });
      }
    };
  }
  function usernameHint(policy) {
    return policy.username.pattern === DEFAULT_USERNAME_PATTERN
      ? '3–32 characters: lowercase letters, digits, “-” and “_”, starting with a letter. It is your sign-in name and cannot be changed.'
      : `It is your sign-in name and cannot be changed. Allowed form: ${policy.username.pattern}`;
  }
  const passwordHint = minLength => `At least ${minLength} characters. Must differ from the username and e-mail.`;
  function formErrorText(error, policy) {
    switch (error.code) {
      case 'username-unavailable': return 'This username is not available. Choose another one.';
      case 'weak-password': return `Too weak: use at least ${policy === null ? 'the required number of' : policy.password.minLength} characters, different from your username and e-mail.`;
      case 'totp-mismatch': return 'That code does not match this key. Enter the current code.';
      case 'invalid': return 'Some values were not accepted. Check the username, e-mail and 6-digit code.';
      case 'rate-limited': return `Too many attempts. Try again ${waitText(error.retryAfter)}.`;
      default: return UNAVAILABLE_TEXT;
    }
  }

  // ------------------------------------------------------------------------------------------
  // Login (host forms and the shared auth card); the second factor keeps login and password in memory only.

  function loginParts(form) {
    let error = form.querySelector('[data-account-login-error]');
    if (error === null) { error = h('div', { role: 'alert', 'data-account-login-error': true, hidden: true }); form.append(error); }
    let status = form.querySelector('[data-account-login-status]');
    if (status === null) { status = h('p', { class: 'small muted', role: 'status', 'data-account-login-status': true, hidden: true }); form.append(status); }
    return { error, status };
  }
  function loginErrorNode(error, login) {
    if (error.code === 'rejected') return notice('danger', 'alert', null, 'Invalid username or password. Check both and try again.');
    if (error.code === 'rate-limited') return notice('warn', 'clock', 'Too many attempts', `Sign-in for this account is paused. Try again ${waitText(error.retryAfter)}, or recover the password with your authenticator.`);
    if (error.code === 'pending-approval') return notice('warn', 'clock', 'Awaiting approval by an administrator', 'Your password is correct, but the account ', h('strong', {}, login), ' has not been approved yet. You will be able to sign in as soon as an administrator approves it.');
    return notice('danger', 'alert', null, UNAVAILABLE_TEXT);
  }
  function showLoginStatus(parts, text) { parts.status.textContent = text; parts.status.hidden = text === ''; }
  function totpStep(form, credentials) {
    const code = field({ label: '6-digit code', input: codeInput({ name: 'totp', required: true }), hint: null, id: nextId('login-totp') });
    const status = h('p', { class: 'small muted', role: 'status', hidden: true });
    const error = h('div', { role: 'alert', hidden: true });
    const name = appName();
    const step = h('form', { class: 'auth-card', 'data-account-login-totp': true, 'data-view': 'login-totp', novalidate: true },
      h('div', {}, h('h1', { class: 'auth-title' }, 'Enter your authenticator code'),
        h('p', { class: 'auth-sub' }, 'Signing in as ', h('strong', {}, credentials.login), `. Open your authenticator app and enter the 6-digit code${name === null ? '' : ` for ${name}`}.`)),
      error, code.node, h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Verify and sign in'), status,
      h('p', { class: 'auth-foot' }, h('button', { class: 'link-button', type: 'button', onclick: () => restartLogin(form) }, 'Use a different account'),
        h('a', { href: `${ROUTE_PREFIX}recover` }, 'Lost your password?')));
    const note = h('p', { class: 'xs muted' }, 'Lost your authenticator? Ask an administrator to reset your credentials.');
    step.addEventListener('submit', event => { event.preventDefault(); void submitSecondFactor(form, step, code); });
    return { step, note, code, status, error };
  }
  function restartLogin(form) {
    const entry = loginForms.get(form);
    if (entry === undefined || entry.state.phase === 'submitting') return;
    entry.state = loginReduce(entry.state, { type: 'restart' });
    if (entry.totp !== null) { entry.totp.step.remove(); entry.totp.note.remove(); entry.totp = null; }
    form.hidden = false;
    form.elements.namedItem('login').focus();
  }
  function applyLogin(form, entry, state) {
    entry.state = state;
    const parts = loginParts(form);
    const credentialsPhase = state.phase === 'credentials' || state.phase === 'pending-approval';
    if (state.phase === 'submitting') {
      const target = state.step === 'credentials' ? form : entry.totp.step;
      setBusy(target, true);
      if (state.step === 'credentials') showLoginStatus(parts, 'Signing in…'); else { entry.totp.status.textContent = 'Verifying…'; entry.totp.status.hidden = false; }
      return;
    }
    setBusy(form, false); showLoginStatus(parts, '');
    if (state.phase === 'done') { window.location.reload(); return; }
    if (credentialsPhase) {
      const error = state.phase === 'pending-approval' ? { code: 'pending-approval', retryAfter: null } : state.error;
      parts.error.replaceChildren(); parts.error.hidden = error === null;
      if (error !== null) { parts.error.append(loginErrorNode(error, form.elements.namedItem('login').value)); form.elements.namedItem('password').focus(); }
      return;
    }
    // second-factor
    if (entry.totp === null) {
      entry.totp = totpStep(form, state.credentials);
      form.after(entry.totp.step, entry.totp.note); form.hidden = true; parts.error.hidden = true;
    }
    const totp = entry.totp;
    setBusy(totp.step, false); totp.status.hidden = true;
    totp.code.setError(state.error !== null && state.error.code === 'rejected' ? 'That code did not match. Wait for the next code and try again.' : null);
    totp.error.replaceChildren(); totp.error.hidden = state.error === null || state.error.code === 'rejected';
    if (!totp.error.hidden) totp.error.append(loginErrorNode(state.error, state.credentials.login));
    totp.code.input.focus();
  }
  function loginClient() { return coordinator.authClient(null); }
  async function submitCredentials(form) {
    const entry = loginForms.get(form) ?? { state: loginInitial(), totp: null };
    loginForms.set(form, entry);
    if (entry.state.phase === 'submitting') return;
    const login = form.elements.namedItem('login'), password = form.elements.namedItem('password');
    if (!(login instanceof window.HTMLInputElement) || !(password instanceof window.HTMLInputElement)) throw new Error('Account login requires login and password inputs');
    const credentials = { login: login.value, password: password.value }; password.value = '';
    const start = entry.state.phase === 'credentials' ? entry.state : loginInitial();
    await authHeld(() => submitLogin(loginClient(), start, credentials, state => { if (form.isConnected) applyLogin(form, entry, state); }));
  }
  async function submitSecondFactor(form, step, code) {
    const entry = loginForms.get(form);
    if (entry === undefined || entry.totp === null || entry.totp.step !== step || entry.state.phase !== 'second-factor') return;
    const totp = code.input.value.trim(); code.input.value = '';
    await authHeld(() => submitLogin(loginClient(), entry.state, { totp }, state => { if (form.isConnected) applyLogin(form, entry, state); }));
  }

  // ------------------------------------------------------------------------------------------
  // Signed-out surfaces rendered into [data-account-auth]: login card, signup, recovery, enrollment landing.

  function authCard(props, ...children) { return h('section', { class: 'auth-card', ...props }, ...children); }
  // Leaves a signed-out flow for the login card; an enrollment code is dropped only here or on success.
  function toLogin() { enrollmentCode.value = null; navigate(''); }
  function statusCard(iconName, iconClass, title, text, actionLabel) {
    return authCard({ 'data-view': 'auth-status' }, h('span', { class: `big-icon ${iconClass}` }, icon(iconName)),
      h('div', {}, h('h1', { class: 'auth-title' }, title), h('p', { class: 'auth-sub' }, ...text)),
      h('button', { class: 'btn btn-lg btn-block', type: 'button', onclick: toLogin }, actionLabel));
  }
  function loadingCard() {
    return authCard({ 'aria-busy': 'true', 'data-view': 'auth-loading' }, h('span', { class: 'skeleton sk-60' }), h('span', { class: 'skeleton' }), h('span', { class: 'skeleton sk-30' }));
  }

  function createAuth(mount) {
    const controller = new window.AbortController();
    const client = coordinator.authClient(controller.signal);
    const page = h('div', { class: 'auth-page' });
    const state = { mount, page, policy: { phase: 'loading' }, view: null, alive: true, loginLinks: null };
    mount.replaceChildren(page);
    const policyReady = client.policy().then(policy => { state.policy = { phase: 'ready', data: policy }; }, () => { state.policy = { phase: 'absent' }; })
      .then(() => { if (state.alive && state.loginLinks !== null) state.loginLinks(); });

    const show = (view, ...nodes) => { state.view = view; state.loginLinks = null; page.replaceChildren(...nodes); };
    const policy = () => (state.policy.phase === 'ready' ? state.policy.data : null);

    function renderLogin() {
      const name = appName();
      const login = field({ label: 'Username', input: input({ class: 'input input-lg', name: 'login', autocomplete: 'username', required: true, maxlength: 200 }), hint: null, id: nextId('login') });
      const passwordId = nextId('password');
      const password = input({ class: 'input input-lg', id: passwordId, name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 1000 });
      const passwordRow = h('div', { class: 'row row-between' }, h('label', { class: 'label', for: passwordId }, 'Password'));
      const foot = h('p', { class: 'auth-foot', hidden: true });
      const form = h('form', { class: 'auth-card', 'data-account-login': true, method: 'post', action: `${ACCOUNT_API_PATH}/login`, novalidate: true, 'data-view': 'login' },
        h('div', {}, h('h1', { class: 'auth-title' }, name === null ? 'Sign in' : `Sign in to ${name}`), h('p', { class: 'auth-sub' }, 'Use your account for this service.')),
        h('div', { role: 'alert', 'data-account-login-error': true, hidden: true }),
        login.node,
        h('div', { class: 'field' }, passwordRow, password),
        h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Sign in'),
        h('p', { class: 'small muted', role: 'status', 'data-account-login-status': true, hidden: true }),
        foot);
      show('login', form);
      // Links appear only where GET /policy allows them; without the endpoint the card is today's login.
      state.loginLinks = () => {
        const current = policy();
        if (current === null) return;
        passwordRow.append(h('a', { class: 'small', href: `${ROUTE_PREFIX}recover` }, 'Forgot password?'));
        foot.replaceChildren(...(current.signup ? ['New here? ', h('a', { href: `${ROUTE_PREFIX}signup` }, 'Create an account')] : ['Accounts are created by an administrator.']));
        foot.hidden = false;
      };
      if (state.policy.phase !== 'loading') state.loginLinks();
    }

    async function renderRecovery() {
      show('recover', loadingCard());
      await policyReady;
      if (!state.alive || state.view !== 'recover') return;
      const current = policy();
      if (current === null) {
        show('recover', statusCard('lock', '', 'Password recovery is not available', ['This server does not offer self-service recovery. Ask an administrator.'], 'Back to sign-in'));
        return;
      }
      let recovery = recoveryInitial();
      const notices = h('div', { role: 'alert', hidden: true });
      const username = field({ label: 'Username', input: input({ class: 'input input-lg', name: 'username', autocomplete: 'username' }), hint: null, id: nextId('recover-user') });
      const code = field({ label: 'Authenticator code', input: codeInput({ name: 'totp' }), hint: null, id: nextId('recover-code') });
      const password = field({ label: 'New password', input: input({ class: 'input input-lg', name: 'password', type: 'password', autocomplete: 'new-password' }), hint: passwordHint(current.password.minLength), id: nextId('recover-password') });
      const form = h('form', { class: 'auth-card', novalidate: true, 'data-view': 'recover' },
        h('div', {}, h('h1', { class: 'auth-title' }, 'Recover your password'), h('p', { class: 'auth-sub' }, 'Prove it is you with a code from your authenticator app, then choose a new password. Other browser sessions are signed out; API access tokens keep working.')),
        notices, username.node, code.node, password.node,
        h('button', { class: 'btn btn-primary btn-lg btn-block', type: 'submit' }, 'Set new password and sign in'),
        h('p', { class: 'auth-foot' }, h('button', { class: 'link-button', type: 'button', onclick: toLogin }, 'Back to sign-in')));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (recovery.phase !== 'form') return;
        const values = { username: username.input.value.trim(), totp: code.input.value.trim(), password: password.input.value };
        password.input.value = ''; code.input.value = '';
        recovery = await authHeld(() => submitRecovery(client, recovery, values, next => {
          if (!state.alive) return;
          setBusy(form, next.phase === 'submitting');
          if (next.phase === 'done') { window.location.reload(); return; }
          if (next.phase !== 'form') return;
          const error = next.error;
          password.setError(error !== null && error.code === 'weak-password' ? formErrorText(error, current) : null);
          notices.replaceChildren(); notices.hidden = error === null || error.code === 'weak-password';
          if (error === null || error.code === 'weak-password') return;
          notices.append(error.code === 'rejected'
            ? notice('danger', 'alert', null, 'Recovery was not accepted. Check the username and enter the code your authenticator shows right now. For accounts managed in server configuration, ask an administrator.')
            : error.code === 'rate-limited' ? notice('warn', 'clock', 'Too many attempts', `Recovery for this account is paused. Try again ${waitText(error.retryAfter)}.`)
              : notice('danger', 'alert', null, formErrorText(error, current)));
        }));
      });
      show('recover', form, h('p', { class: 'xs muted' }, 'No authenticator any more? An administrator can issue a one-time reset link.'));
    }

    // The one-page signup form, shared with the enrollment landing (`fixed` = { username, kind, expiresAt }).
    function credentialForm({ policyValue, secret, fixed, onSubmit }) {
      const name = appName() ?? 'this service';
      const summary = h('div', { role: 'alert', hidden: true });
      const usernameInput = fixed === null
        ? input({ class: 'input input-lg', name: 'username', autocomplete: 'username', maxlength: 32, spellcheck: false })
        : input({ class: 'input input-lg', name: 'username', value: fixed.username, readonly: true });
      const username = field({ label: 'Username', input: usernameInput, hint: fixed === null ? usernameHint(policyValue) : 'Fixed by the administrator.', id: nextId('signup-user') });
      const email = fixed !== null && fixed.kind === 'reset' ? null
        : field({ label: 'E-mail', input: input({ class: 'input input-lg', name: 'email', type: 'email', autocomplete: 'email' }), hint: 'For administrators to reach you. Not verified, not used for sign-in or recovery.', id: nextId('signup-email') });
      const meter = passwordMeter(policyValue.password.minLength);
      const password = field({ label: 'Password', input: input({ class: 'input input-lg', name: 'password', type: 'password', autocomplete: 'new-password', oninput: event => meter.update(event.target.value.length) }), hint: passwordHint(policyValue.password.minLength), id: nextId('signup-password') });
      password.input.after(meter.node);
      const requireTotp = h('input', { type: 'checkbox', name: 'requireTotp' });
      const code = field({ label: 'Enter the 6-digit code the app shows', input: codeInput({ name: 'totpCode' }), hint: 'Proves the app is set up before the account is created.', id: nextId('signup-code') });
      const setup = totpSetup({ issuer: policyValue.issuer, secret, caption: 'Scan this code with an authenticator app (TOTP, 6 digits, 30 seconds).', label: 'QR code with the authenticator set-up key', protect: unprotected });
      setup.render(usernameInput.value);
      usernameInput.addEventListener('input', () => setup.render(usernameInput.value.trim()));
      const heading = fixed === null
        ? h('div', {}, h('h1', { class: 'auth-title' }, `Create your ${name} account`), h('p', { class: 'auth-sub' }, policyValue.approval
          ? 'One step: choose credentials and set up an authenticator app. An administrator approves new accounts before the first sign-in.'
          : 'One step: choose credentials and set up an authenticator app.'))
        : fixed.kind === 'invite'
          ? h('div', {}, h('h1', { class: 'auth-title' }, 'Finish setting up your account'), h('p', { class: 'auth-sub' }, `An administrator invited you to ${name}. This link works once and expires `, h('strong', {}, dateNode(fixed.expiresAt, DATE_TIME_FORMAT)), ` (${expiryText(fixed.expiresAt)}).`))
          : h('div', {}, h('h1', { class: 'auth-title' }, 'Reset your credentials'), h('p', { class: 'auth-sub' }, 'An administrator issued a reset for ', h('strong', {}, fixed.username), '. Your current password keeps working until you finish. This link works once and expires ', h('strong', {}, dateNode(fixed.expiresAt, DATE_TIME_FORMAT)), '.'));
      const submit = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, fixed === null ? 'Create account' : fixed.kind === 'invite' ? 'Create account and sign in' : 'Replace credentials and sign in');
      const form = h('form', { class: 'auth-card auth-card-wide', novalidate: true, 'data-view': fixed === null ? 'signup' : 'enrollment' },
        heading, summary,
        h('div', { class: 'signup-grid' },
          h('section', { 'aria-label': 'Account' }, h('h2', { class: 'section-title' }, 'Account'), username.node, email === null ? null : email.node, password.node,
            h('label', { class: 'switch' }, requireTotp, h('span', {}, h('strong', {}, 'Also require a code at every sign-in'), h('br', {}), h('span', { class: 'hint' }, 'Optional. Off: you sign in with the password only, and the authenticator is used to recover a forgotten password. You can change this later under Two-factor.')))),
          h('section', { 'aria-label': 'Authenticator' }, h('h2', { class: 'section-title' }, 'Authenticator app'),
            h('ol', { class: 'steps' }, h('li', {}, setup.node), h('li', {}, code.node)))),
        h('div', { class: 'divider' }),
        h('div', { class: 'row row-between row-wrap' }, fixed === null
          ? h('span', { class: 'small muted' }, 'Already have an account? ', h('button', { class: 'link-button', type: 'button', onclick: toLogin }, 'Sign in'))
          : h('span', { class: 'small muted' }, 'Wrong person? Close this page; the link stays valid until it expires.'), submit));
      form.addEventListener('submit', event => {
        event.preventDefault();
        const values = { username: usernameInput.value.trim(), email: email === null ? null : email.input.value.trim(), password: password.input.value, totpCode: code.input.value.trim(), requireTotp: requireTotp.checked };
        code.input.value = '';
        void onSubmit(values);
      });
      return {
        form,
        busy(value) { setBusy(form, value); if (fixed !== null && !value) usernameInput.readOnly = true; },
        showError(error) {
          const fields = { 'username-unavailable': username, 'weak-password': password, 'totp-mismatch': code };
          for (const [codeName, target] of Object.entries(fields)) target.setError(error !== null && error.code === codeName ? formErrorText(error, policyValue) : null);
          summary.replaceChildren(); summary.hidden = error === null;
          if (error === null) return;
          summary.append(error.code in fields
            ? notice('danger', 'alert', null, `${fixed === null ? 'The account was not created' : 'Nothing was changed'}. Fix the highlighted field and submit again — nothing was saved.`)
            : error.code === 'rate-limited' ? notice('warn', 'clock', 'Too many attempts', formErrorText(error, policyValue)) : notice('danger', 'alert', null, formErrorText(error, policyValue)));
          (fields[error.code] ?? username).input.focus();
        }
      };
    }

    async function renderSignup() {
      show('signup', loadingCard());
      let current = null, view = null;
      const emit = next => {
        if (!state.alive || state.view !== 'signup') return;
        current = next;
        if (next.phase === 'loading-policy') return;
        if (next.phase === 'form') {
          if (view === null) { view = credentialForm({ policyValue: next.policy, secret: next.secret, fixed: null, onSubmit: values => authHeld(() => submitSignup(client, current, values, emit)) }); page.replaceChildren(view.form); }
          view.busy(false); view.showError(next.error); return;
        }
        if (next.phase === 'submitting') { view.busy(true); return; }
        if (next.phase === 'done') { window.location.reload(); return; }
        if (next.phase === 'pending-approval') {
          const username = view.form.elements.namedItem('username').value.trim(), entry = `${appName() ?? 'this service'} (${username})`;
          page.replaceChildren(authCard({ 'data-view': 'signup-pending' }, h('span', { class: 'big-icon' }, icon('clock')),
            h('div', {}, h('h1', { class: 'auth-title' }, 'Account created — waiting for approval'), h('p', { class: 'auth-sub' }, 'Your account ', h('strong', {}, username), ' exists, but an administrator has to approve it before you can sign in. You do not need to keep this page open.')),
            h('ul', { class: 'stack-sm small' },
              h('li', { class: 'row row-top' }, icon('check'), h('span', {}, `Keep the authenticator entry “${entry}”. You need it to recover your password${view.form.elements.namedItem('requireTotp').checked ? ' and to sign in' : ''}.`)),
              h('li', { class: 'row row-top' }, icon('check'), h('span', {}, 'After approval, sign in with your username and password.')),
              h('li', { class: 'row row-top' }, icon('info'), h('span', {}, 'There is no e-mail notification. Ask your administrator if it takes long.'))),
            h('button', { class: 'btn btn-lg btn-block', type: 'button', onclick: toLogin }, 'Go to sign-in')));
          return;
        }
        if (next.phase === 'closed') {
          page.replaceChildren(statusCard('lock', '', 'Sign-up is not available', ['This service is not accepting new self-registered accounts right now. Existing accounts keep working. Ask an administrator for an invitation link.'], 'Back to sign-in'));
          return;
        }
        page.replaceChildren(authCard({ 'data-view': 'signup-unavailable' }, notice('danger', 'alert', null, formErrorText(next.error, null)),
          h('button', { class: 'btn btn-lg btn-block', type: 'button', onclick: () => void renderSignup() }, 'Retry')));
      };
      await loadSignup(client, window.crypto, emit);
    }

    async function renderEnrollment() {
      show('enrollment', loadingCard());
      const code = enrollmentCode.value;
      await policyReady;
      if (!state.alive || state.view !== 'enrollment') return;
      let current = null, view = null;
      const emit = next => {
        if (!state.alive || state.view !== 'enrollment') return;
        current = next;
        if (next.phase === 'inspecting') return;
        if (next.phase === 'form') {
          if (policy() === null) throw new Error('An enrollment link was accepted by a server without an account policy');
          if (view === null) {
            view = credentialForm({ policyValue: policy(), secret: next.secret, fixed: { username: next.username, kind: next.kind, expiresAt: next.expiresAt }, onSubmit: values => authHeld(() => submitEnrollment(client, current, { email: values.email, password: values.password, totpCode: values.totpCode, requireTotp: values.requireTotp }, emit)) });
            page.replaceChildren(view.form);
          }
          view.busy(false); view.showError(next.error); return;
        }
        if (next.phase === 'submitting') { view.busy(true); return; }
        if (next.phase === 'done') { enrollmentCode.value = null; window.location.reload(); return; }
        if (next.phase === 'invalid-link') {
          page.replaceChildren(statusCard('link', 'big-icon-danger', 'This link is no longer valid', ['Invitation and reset links work once and expire. It may have been used, replaced by a newer link, or revoked. Ask your administrator for a new one.'], 'Go to sign-in'));
          return;
        }
        page.replaceChildren(authCard({ 'data-view': 'enrollment-unavailable' }, notice('danger', 'alert', null, formErrorText(next.error, null)),
          h('button', { class: 'btn btn-lg btn-block', type: 'button', onclick: () => void renderEnrollment() }, 'Retry')));
      };
      await loadEnrollment(client, window.crypto, code, emit);
    }

    return {
      mount,
      route(name) {
        if (enrollmentCode.value !== null) { if (state.view !== 'enrollment') void renderEnrollment(); return; }
        if (name === 'signup') { if (state.view !== 'signup') void renderSignup(); return; }
        if (name === 'recover') { if (state.view !== 'recover') void renderRecovery(); return; }
        if (state.view !== 'login') renderLogin();
      },
      dispose() { state.alive = false; controller.abort(); }
    };
  }

  // ------------------------------------------------------------------------------------------
  // Signed-in account area rendered into [data-account-outlet]: section navigation + one section per route.

  function createArea(outlet, owner) {
    const controller = new window.AbortController();
    const root = h('div', { class: 'account' });
    const nav = h('nav', { class: 'account-nav', 'aria-label': 'Account sections' });
    const holder = h('div', {});
    const connection = h('div', { hidden: true });
    root.append(nav, h('div', { class: 'account-main stack' }, connection, holder));
    const dialogs = new Set(), menus = new Set(); // overlays owned by the current section, closed by leave()/dispose()
    const self = {
      alive: true, section: null, hash: null,
      account: { phase: 'loading' }, profile: { phase: 'loading' }, policy: { phase: 'loading' }, admin: { phase: 'idle' },
      tokenView: { mode: 'idle', busy: false, formUi: null, secret: null, secretUi: null, highlight: null, showRevoked: false, filter: '', notice: null },
      usersView: { filter: 'all', query: '', mode: 'idle', formUi: null, link: null, linkUi: null, notice: null },
      tokensUi: null, usersUi: null, pendingLink: null,
      // Authority: 'verified' | 'verifying' | 'unverified' ('lost' tears the area down). `trusted` changes only on
      // verified/unverified, so 'verifying' keeps the capabilities as they were.
      authority: 'verified', trusted: true,
      replaceOpen: false, placeholder: false, pendingRender: null // a read-triggered re-render waiting for the slot and the section's prompts
    };
    // The area's only way to the network (see createCoordinator); section code below never sees a client.
    const io = coordinator.forArea({ owner, signal: controller.signal, hooks: { alive: () => self.alive, trusted: () => self.trusted, holder: () => api, setAuthority, lose } });
    // One registry of elements that display or copy a one-time value: 'action' (disabled), 'conceal' (hidden) or
    // 'mask' (update(trusted) shows a masked value) while authority is not verified.
    const sensitiveSet = new Set();
    function sensitive(element, kind, update) {
      sensitiveSet.add({ element, kind, update });
      applySensitive();
      return element;
    }
    function applySensitive() {
      for (const entry of sensitiveSet) {
        if (entry.kind === 'action') entry.element.disabled = !self.trusted;
        if (entry.kind === 'conceal') entry.element.hidden = !self.trusted;
        if (entry.kind === 'mask') entry.update(self.trusted);
      }
    }
    // A dialog is section-owned; its confirm button is a write entry point (busy rule, authority).
    const dialog = spec => {
      const opened = openDialog(spec); dialogs.add(opened); opened.element.addEventListener('close', () => { dialogs.delete(opened); flushRender(); });
      if (spec.write) entry(opened.element.querySelector('button[type="submit"]'), false);
      opened.element.addEventListener('account:settled', applyBusy);
      return opened;
    };
    const profileData = () => (self.profile.phase === 'ready' ? self.profile.data : null);
    const policyData = () => (self.policy.phase === 'ready' ? self.policy.data : null);
    const accountData = () => (self.account.phase === 'ready' ? self.account.data : null);
    const alive = () => self.alive;

    // Account data from any read (load, re-read, write preflight or follow-up): the coordinator calls this only for
    // the newest read; a failure keeps data already shown.
    function applyAccount(result) {
      if (result.ok) self.account = { phase: 'ready', data: result.data };
      else if (self.account.phase !== 'ready') self.account = { phase: 'failed', error: result.cause };
      renderNav(); requestRender('lists');
    }
    function lose(reason) { forceTeardown(api, reason); }
    function setAuthority(state) {
      self.authority = state;
      if (state === 'verified') self.trusted = true;
      if (state === 'unverified') {
        self.trusted = false;
        if (self.tokenView.secret !== null) self.tokenView.secret.revealed = false;
      }
      renderConnection(); applyBusy();
    }
    function renderConnection() {
      connection.hidden = self.trusted;
      if (self.trusted) { connection.replaceChildren(); return; }
      connection.replaceChildren(h('div', { class: 'notice notice-warn', role: 'alert', 'data-account-unverified': true }, icon('alert'),
        h('div', { class: 'grow' }, h('div', { class: 'notice-title' }, 'Connection lost — reconnect to continue'),
          'The account could not be confirmed. One-time values are kept but hidden, and changes are paused until it is confirmed again.',
          h('div', { class: 'notice-actions' }, h('button', { class: 'btn btn-sm', type: 'button', disabled: self.authority === 'verifying', onclick: () => void verify() }, icon('refresh'), self.authority === 'verifying' ? 'Reconnecting…' : 'Retry')))));
    }
    // account:invalidate, window focus, 'online' and Retry: re-read authority; nothing is torn down meanwhile.
    async function verify() {
      if (!self.alive) return;
      self.authority = 'verifying'; renderConnection();
      await io.read('account', applyAccount, false);
      if (self.authority === 'verifying') { self.authority = self.trusted ? 'verified' : 'unverified'; renderConnection(); }
    }

    function available(section) {
      const profile = profileData();
      if (section === 'tokens') return true;
      if (section === 'profile') return self.profile.phase !== 'absent';
      if (profile === null) return false;
      return { password: profile.manage.password, 'two-factor': profile.manage.totp, users: profile.manage.users }[section];
    }
    const pendingProfile = section => self.profile.phase === 'loading' && section !== 'tokens';
    const fallbackSection = () => (available(DEFAULT_SECTION) ? DEFAULT_SECTION : FALLBACK_SECTION);
    // Called only from route(), after mayLeave() allowed leaving the current section.
    function open(requested) {
      if (root.parentNode !== outlet) outlet.replaceChildren(root);
      const section = available(requested) || pendingProfile(requested) ? requested : fallbackSection();
      if (section !== requested) window.history.replaceState(null, '', ROUTE_PREFIX + section);
      if (self.section === section) return;
      leave();
      self.section = section; self.hash = ROUTE_PREFIX + section;
      renderNav(); renderSection();
      document.dispatchEvent(new window.CustomEvent('account:route', { detail: { section } }));
    }
    // Section ownership: everything the current section opened (dialogs, prompts, forms and their input)
    // is discarded before another section renders. Shown-once values are kept: mayLeave() refuses to leave
    // while they are shown or a request that may produce them is in flight.
    function leave() {
      if (self.section === null) return;
      closeOverlays();
      for (const view of [self.tokenView, self.usersView]) {
        if (view.mode === 'form') Object.assign(view, { mode: 'idle', formUi: null });
        view.notice = null;
      }
      self.section = null; self.hash = null; self.tokensUi = null; self.usersUi = null; self.replaceOpen = false;
    }
    // A shown-once value is rendered only into its owning section; arriving for another one is an invariant
    // violation: it is reported and the owning section is shown instead of writing into detached DOM.
    function deliver(section) {
      if (self.section === section) { renderNav(); (section === 'tokens' ? self.tokensUi : self.usersUi).renderAll(); return; }
      window.reportError(new Error(`Account: a one-time value for section '${section}' arrived while '${self.section}' is shown`));
      reveal(ROUTE_PREFIX + section);
    }
    // Busy rule: while the section has a write in flight, every control that would start another write or
    // discard the submitted form is disabled. Such controls are created through entry(); one counter drives them.
    const writable = () => !coordinator.slotTaken() && self.trusted;
    function entry(node, ownDisabled) {
      node.dataset.accountEntry = ownDisabled ? 'disabled' : 'enabled';
      node.disabled = ownDisabled || !writable();
      return node;
    }
    function applyBusy() {
      if (!self.alive) return;
      holder.setAttribute('aria-busy', String(coordinator.slotTaken()));
      for (const scope of [holder, ...[...dialogs].map(opened => opened.element)]) {
        for (const node of scope.querySelectorAll('[data-account-entry]')) node.disabled = node.dataset.accountEntry === 'disabled' || !writable();
      }
      applySensitive();
      flushRender();
    }
    // Read-triggered re-rendering: 'lists' patches the token and user lists, 'section' rebuilds the section. Neither
    // runs while a write or sign-out holds the slot or the section has an open dialog, menu, form or card; the
    // request waits and is flushed when the slot is freed or the prompt closes.
    const promptOpen = () => dialogs.size > 0 || menus.size > 0 || self.tokenView.mode === 'form' || self.usersView.mode === 'form' || self.replaceOpen;
    function requestRender(kind) {
      self.pendingRender = self.pendingRender === 'section' || kind === 'section' ? 'section' : 'lists';
      flushRender();
    }
    function flushRender() {
      if (!self.alive || self.pendingRender === null || coordinator.slotTaken() || promptOpen()) return;
      const kind = self.pendingRender;
      self.pendingRender = null;
      // The password section is rebuilt only to replace its loading placeholder (it holds typed passwords otherwise).
      if (kind === 'section' && self.section !== null && self.section !== 'tokens' && (self.section !== 'password' || self.placeholder)) { renderSection(); return; }
      if (self.tokensUi !== null) self.tokensUi.renderAll();
      if (self.usersUi !== null) self.usersUi.renderAll();
    }
    // Every section write goes through io.write; a preflight that did not confirm the owner is AccountStop.
    const write = work => io.write(applyAccount, work);
    function closeOverlays() {
      for (const close of [...menus]) close();
      for (const opened of [...dialogs]) opened.close();
    }
    // Shown-once values (and requests that may have produced one) that a teardown would lose.
    function lostValues() {
      const lost = [];
      const intent = uncertainMints.get(owner);
      if (self.tokenView.secret !== null) lost.push({ kind: 'token', name: self.tokenView.secret.token.name, uncertain: false });
      else if (intent !== undefined && self.tokenView.busy) lost.push({ kind: 'token', name: intent.name, uncertain: true });
      if (self.usersView.link !== null) lost.push({ kind: self.usersView.link.kind, name: self.usersView.link.name, uncertain: false });
      else if (self.pendingLink !== null) lost.push({ ...self.pendingLink, uncertain: true });
      return lost;
    }
    function renderSection() {
      const build = { profile: profileSection, password: passwordSection, 'two-factor': twoFactorSection, tokens: tokensSection, users: usersSection }[self.section];
      self.placeholder = pendingProfile(self.section);
      holder.replaceChildren(self.placeholder ? loadingSection() : build());
    }
    function loadingSection() {
      return h('section', { class: 'account-section', 'aria-busy': 'true', 'data-view': 'loading' }, h('div', { class: 'card card-body' }, h('span', { class: 'skeleton sk-60' }), h('span', { class: 'skeleton' }), h('span', { class: 'skeleton sk-30' })));
    }
    function sectionHeader(title, sub) {
      return h('header', {}, h('div', {}, h('h1', { class: 'page-title' }, title), sub === null ? null : h('p', { class: 'page-sub' }, sub)));
    }

    function renderNav() {
      const profile = profileData(), account = accountData();
      const login = profile !== null ? profile.user.login : account !== null ? account.user.login : owner;
      const role = profile === null ? '' : [profile.admin ? 'Administrator' : null, profile.source === 'declarative' ? 'Server configuration' : null].filter(Boolean).join(' · ');
      const link = (section, iconName, label, count) => (available(section)
        ? h('a', { href: ROUTE_PREFIX + section, 'data-section': section, 'aria-current': self.section === section ? 'page' : null }, icon(iconName), label, count)
        : null);
      const activeTokens = account === null ? null : account.tokens.filter(token => !token.revoked).length;
      const pending = self.admin.phase === 'ready' ? self.admin.data.users.filter(user => user.status === 'pending').length : 0;
      // Unavailable sections are null: append() skips them (replaceChildren would insert the text "null").
      nav.replaceChildren();
      append(nav, [
        h('div', { class: 'account-who' }, h('span', { class: 'avatar', 'aria-hidden': 'true' }, login.charAt(0)), h('div', {}, h('strong', {}, login), role === '' ? null : h('div', { class: 'xs muted' }, role))),
        h('span', { class: 'eyebrow' }, 'Account'),
        link('profile', 'user', 'Profile', null), link('password', 'lock', 'Password', null), link('two-factor', 'shield', 'Two-factor', null),
        link('tokens', 'key', 'Access tokens', activeTokens === null ? null : h('span', { class: 'count' }, String(activeTokens))),
        available('users') ? h('span', { class: 'eyebrow' }, 'Administration') : null,
        link('users', 'users', 'Users', pending > 0 ? h('span', { class: 'count count-attn', title: `${pending} waiting for approval` }, String(pending)) : null)]);
    }

    function loadAccount() { void io.read('account', applyAccount, true); }
    // Profile data follows the generation rule; the section is re-rendered through requestRender (never under a
    // write or an open prompt). `first` only for the area's first load.
    function loadProfile(first) {
      void io.read('profile', result => {
        if (result.ok) self.profile = { phase: 'ready', data: result.data };
        else if (self.profile.phase !== 'ready') self.profile = result.kind === 'refused' && result.cause.status === 404 ? { phase: 'absent' } : { phase: 'failed', error: result.cause };
        renderNav();
        const profile = profileData();
        if (profile !== null && profile.manage.users && self.admin.phase === 'idle') loadAdmin();
        if (self.section === null) return;
        if (!available(self.section)) { replaceRouted(ROUTE_PREFIX + fallbackSection()); return; }
        requestRender('section');
      }, first);
    }
    function loadPolicy() {
      void io.read('policy', result => {
        self.policy = result.ok ? { phase: 'ready', data: result.data } : { phase: 'absent' };
        // The policy can arrive after the password section rendered: patch its hint, never rebuild the form.
        const hint = holder.querySelector('[data-account-password-hint]');
        if (result.ok && hint !== null) hint.textContent = passwordHint(result.data.password.minLength);
      }, true);
    }
    function loadAdmin() {
      if (self.admin.phase !== 'ready') self.admin = { phase: 'loading' }; // a reload keeps the rows until it answers
      void io.read('admin', result => {
        if (result.ok) self.admin = { phase: 'ready', data: result.data };
        else if (self.admin.phase !== 'ready') {
          const status = result.cause instanceof AccountApiError ? result.cause.status : null;
          self.admin = { phase: status === 404 ? 'absent' : status === 403 ? 'forbidden' : 'unavailable' };
        }
        renderNav(); requestRender('lists');
      }, false);
    }

    // Runs one ACCOUNT_ACTIONS entry inside a write: { ok, result } or { ok: false, text, error }.
    function act(action, target, input, proofText) {
      return write(ops => actWith(ops, action, target, input, proofText)).catch(cause => {
        if (cause instanceof AccountStop) return { ok: false, text: CONNECTION_TEXT, error: null };
        throw cause;
      });
    }
    async function actWith(ops, action, target, input, proofText) {
      const final = await ops.action(action, target, input);
      if (final.phase === 'done') return { ok: true, result: final.result };
      if (final.phase === 'owner-changed' || final.phase === 'unauthorized') return { ok: false, text: SESSION_TEXT, error: null };
      const error = final.error;
      const text = error.code === 'proof-rejected' ? proofText
        : error.code === 'forbidden' ? 'This action is not permitted for the current account.'
          : error.code === 'not-found' ? 'This user or link no longer exists. Refresh the list.'
            : error.code === 'username-unavailable' && action === 'approve-user' ? 'The username is now claimed by server configuration or existing data. Reject the application instead.'
              : formErrorText(error, policyData());
      return { ok: false, text, error };
    }
    const reloadProfile = () => loadProfile(false);
    const errorCode = outcome => (outcome.error === null ? null : outcome.error.code);

    // ── Profile ──────────────────────────────────────────────────────────────────────────────
    function profileSection() {
      const profile = profileData();
      if (profile === null) return failedSection('Profile', self.profile.error);
      const declarative = profile.source === 'declarative';
      const email = profile.manage.email
        ? field({ label: 'E-mail', input: input({ name: 'email', type: 'email', autocomplete: 'email', value: profile.email ?? '' }), hint: 'For administrators to reach you. Not verified, not used for sign-in or recovery.', id: nextId('email') })
        : null;
      const save = entry(h('button', { class: 'btn btn-primary', type: 'submit' }, 'Save e-mail'), true);
      if (email !== null) email.input.addEventListener('input', () => { entry(save, email.input.value.trim() === (profile.email ?? '')); });
      const form = h('form', { class: 'card-body account-form', novalidate: true },
        field({ label: 'Username', input: input({ value: profile.user.login, readonly: true }), hint: 'Your sign-in name. It never changes.', id: nextId('username') }).node,
        email === null ? null : email.node,
        h('dl', { class: 'dl dl-fixed' },
          h('dt', {}, 'Account type'), h('dd', {}, declarative ? 'Declared in server configuration' : 'Created in this service (sign-up or invitation)'),
          h('dt', {}, 'Role'), h('dd', {}, profile.admin ? h('span', { class: 'chip chip-accent' }, 'Administrator') : 'User')),
        email === null ? null : h('div', { class: 'form-actions' }, save));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (email === null) return;
        setBusy(form, true);
        const outcome = await act('change-email', null, { email: email.input.value.trim() }, null);
        if (!alive()) return;
        setBusy(form, false); applyBusy();
        email.setError(outcome.ok ? null : outcome.text);
        if (outcome.ok) { toast('E-mail saved'); reloadProfile(); }
      });
      return h('section', { class: 'account-section', 'data-view': 'profile' }, sectionHeader('Profile', 'How this service identifies you.'),
        declarative ? notice('neutral', 'info', 'This account is managed in server configuration', 'Username, password and two-factor settings are changed by the operator, not here. You can still manage your access tokens.') : null,
        h('div', { class: 'card' }, form));
    }
    function failedSection(title, cause) {
      return h('section', { class: 'account-section', 'data-view': 'failed' }, sectionHeader(title, null),
        notice('danger', 'alert', 'Account details could not be loaded', cause instanceof AccountApiError && cause.status === 401 ? SESSION_TEXT : UNAVAILABLE_TEXT,
          h('div', { class: 'notice-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: reloadProfile }, 'Retry'))));
    }

    // ── Password ─────────────────────────────────────────────────────────────────────────────
    function passwordSection() {
      const policy = policyData();
      const current = field({ label: 'Current password', input: input({ name: 'currentPassword', type: 'password', autocomplete: 'current-password' }), hint: null, id: nextId('current-password') });
      const next = field({ label: 'New password', input: input({ name: 'newPassword', type: 'password', autocomplete: 'new-password' }), hint: policy === null ? 'Must differ from the username and e-mail.' : passwordHint(policy.password.minLength), id: nextId('new-password') });
      next.node.querySelector('.hint').dataset.accountPasswordHint = '';
      const status = h('div', { role: 'status' });
      const form = h('form', { class: 'card-body account-form', novalidate: true }, current.node, next.node, status,
        h('div', { class: 'form-actions' }, entry(h('button', { class: 'btn btn-primary', type: 'submit' }, 'Change password'), false)));
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const values = { currentPassword: current.input.value, newPassword: next.input.value };
        current.input.value = ''; next.input.value = '';
        setBusy(form, true); status.replaceChildren();
        const outcome = await act('change-password', null, values, 'Your current password was not accepted.');
        if (!alive()) return;
        setBusy(form, false); applyBusy();
        const code = outcome.ok ? null : errorCode(outcome);
        current.setError(code === 'proof-rejected' ? outcome.text : null);
        next.setError(code === 'weak-password' ? outcome.text : null);
        if (outcome.ok) status.append(notice('ok', 'check', null, 'Password changed. Your other browser sessions were signed out; access tokens keep working.'));
        else if (outcome.text !== null && code !== 'proof-rejected' && code !== 'weak-password') status.append(notice('danger', 'alert', null, outcome.text));
      });
      return h('section', { class: 'account-section', 'data-view': 'password' }, sectionHeader('Password', 'Changing it signs out your other browser sessions. Access tokens keep working.'),
        h('div', { class: 'card' }, form),
        h('p', { class: 'small muted' }, 'Forgot the current password? Sign out and use password recovery with your authenticator.'));
    }

    // ── Two-factor ───────────────────────────────────────────────────────────────────────────
    function twoFactorSection() {
      self.replaceOpen = false;
      const profile = profileData();
      const required = profile.totp.required;
      const [chipClass, chipText] = { ok: ['chip chip-ok', 'Set up'], unavailable: ['chip chip-warn', 'Unavailable'], none: ['chip', 'Not set up'] }[profile.totp.state];
      const replaceSlot = h('div', { hidden: true });
      const replaceButton = entry(h('button', { class: 'btn', type: 'button', 'aria-expanded': 'false', onclick: () => openReplace() }, 'Replace authenticator…'), false);
      const hintId = nextId('totp-toggle');
      const toggle = entry(h('input', { type: 'checkbox', checked: required, 'aria-describedby': hintId }), false);
      toggle.addEventListener('click', event => { event.preventDefault(); confirmToggle(!required); });
      function closeReplace() { replaceSlot.replaceChildren(); replaceSlot.hidden = true; replaceButton.setAttribute('aria-expanded', 'false'); self.replaceOpen = false; flushRender(); }
      function openReplace() {
        const policy = policyData();
        if (policy === null) { replaceSlot.replaceChildren(notice('danger', 'alert', null, UNAVAILABLE_TEXT)); replaceSlot.hidden = false; return; }
        const secret = generateTotpSecret(window.crypto);
        const password = field({ label: 'Current password', input: input({ name: 'currentPassword', type: 'password', autocomplete: 'current-password' }), hint: null, id: nextId('replace-password') });
        const old = required ? field({ label: 'Code from the current authenticator', input: codeInput({ name: 'currentTotp' }), hint: 'Required while codes are needed at sign-in.', id: nextId('replace-old') }) : null;
        const setup = totpSetup({ issuer: policy.issuer, secret, caption: 'Scan the new code. The old authenticator entry stops working when you save.', label: 'QR code with the new authenticator key', protect: (element, kind) => sensitive(element, kind, null) });
        setup.render(profile.user.login);
        const code = field({ label: 'Code from the new entry', input: codeInput({ name: 'totpCode' }), hint: null, id: nextId('replace-code') });
        const status = h('div', { role: 'status' });
        const form = h('form', { class: 'card', novalidate: true, 'data-account-totp-replace': true },
          h('div', { class: 'card-head' }, h('h2', {}, 'Replace authenticator'), h('span', { class: 'xs muted' }, 'for a new phone or a lost device')),
          h('div', { class: 'card-body account-form' }, password.node, old === null ? null : old.node,
            h('ol', { class: 'steps' }, h('li', {}, setup.node), h('li', {}, code.node)), status,
            h('div', { class: 'form-actions' }, entry(h('button', { class: 'btn btn-primary', type: 'submit' }, 'Replace authenticator'), false),
              h('button', { class: 'btn', type: 'button', onclick: closeReplace }, 'Cancel'))));
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const values = { currentPassword: password.input.value, totpSecret: secret, totpCode: code.input.value.trim(), currentTotp: old === null ? null : old.input.value.trim() };
          password.input.value = ''; code.input.value = ''; if (old !== null) old.input.value = '';
          setBusy(form, true); status.replaceChildren();
          const outcome = await act('replace-totp', null, values, 'The current password or authenticator code was not accepted.');
          if (!alive()) return;
          setBusy(form, false); applyBusy();
          if (outcome.ok) { toast('Authenticator replaced'); closeReplace(); reloadProfile(); return; }
          const mismatch = errorCode(outcome) === 'totp-mismatch';
          code.setError(mismatch ? outcome.text : null);
          if (outcome.text !== null && !mismatch) status.append(notice('danger', 'alert', null, outcome.text));
        });
        replaceSlot.replaceChildren(form); replaceSlot.hidden = false; replaceButton.setAttribute('aria-expanded', 'true'); self.replaceOpen = true; password.input.focus();
      }
      function confirmToggle(enable) {
        const policy = policyData();
        const body = enable
          ? [h('p', {}, 'From now on signing in needs your password and a 6-digit code. Enter a current code to prove the authenticator works — this prevents locking yourself out. Your other browser sessions are signed out. Turning it off later also asks for a code.'),
            h('p', {}, policy !== null && policy.reset ? 'If you lose the authenticator, only an administrator can reset your credentials.' : 'If you lose the authenticator, it cannot be replaced: this server offers no administrator reset.')]
          : [h('p', {}, 'Signing in will need only your password. The authenticator is still used to recover a forgotten password. Enter a current code to confirm.')];
        dialog({ write: true, title: enable ? 'Require a code at every sign-in?' : 'Stop requiring a code at sign-in?', body, fields: [{ name: 'totp', label: 'Authenticator code', type: 'code', hint: null }],
          confirm: enable ? 'Require codes' : 'Stop requiring codes', danger: false, cancel: 'Cancel', extra: [],
          run: async values => {
            const outcome = await act('set-totp-required', null, { required: enable, totp: values.totp.trim() }, 'That code did not match. Enter the code your authenticator shows right now.');
            if (outcome.ok) { toast(enable ? 'Codes are now required at sign-in' : 'Codes are no longer required at sign-in'); reloadProfile(); return null; }
            return outcome.text;
          } });
      }
      return h('section', { class: 'account-section', 'data-view': 'two-factor' },
        sectionHeader('Two-factor authentication', 'Your authenticator app proves it is you when recovering the password and, optionally, at every sign-in.'),
        h('div', { class: 'card' },
          h('div', { class: 'card-body row row-between row-top' },
            h('div', {}, h('strong', {}, 'Authenticator app'), ' ', h('span', { class: chipClass }, chipText),
              h('p', { class: 'small muted' }, required ? 'Used at every sign-in and for password recovery.' : 'Used for password recovery.')),
            replaceButton),
          h('div', { class: 'divider' }),
          h('div', { class: 'card-body row row-between row-top' },
            h('label', { class: 'switch' }, toggle, h('span', {}, h('strong', {}, 'Require a code at every sign-in'), h('br', {}),
              h('span', { class: 'hint', id: hintId }, 'Optional. On: password and a 6-digit code. Off: password only; the authenticator is still used for password recovery.'))),
            h('span', { class: required ? 'chip chip-accent' : 'chip' }, required ? 'On' : 'Off'))),
        replaceSlot);
    }

    // ── Access tokens ────────────────────────────────────────────────────────────────────────
    // Form, one-time secret panel and uncertain-outcome warning share one slot above the table.
    function tokensSection() {
      const view = self.tokenView;
      const titleId = nextId('tokens-title');
      const filter = h('input', { type: 'text', 'aria-label': 'Filter tokens', placeholder: 'Filter by name', value: view.filter, oninput: event => { view.filter = event.target.value; renderRows(); } });
      const filterBox = h('div', { class: 'querybar token-filter', hidden: true }, icon('search'), filter);
      const revokedCount = h('span', {});
      const revokedToggle = h('input', { type: 'checkbox', checked: view.showRevoked, onchange: event => { view.showRevoked = event.target.checked; renderRows(); } });
      const revokedLabel = h('label', { class: 'check', hidden: true }, revokedToggle, ' Show ', revokedCount, ' revoked');
      const refresh = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Refresh token list', title: 'Refresh token list', onclick: () => void refreshTokens() }, icon('refresh'));
      const create = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openForm() }, icon('plus'), 'New token');
      const slot = h('div', { class: 'stack', 'data-account-token-slot': true, hidden: true });
      const tbody = h('tbody', {});
      const tableCard = h('div', { class: 'card' }, h('table', { class: 'table table-inset', 'aria-label': 'Access tokens', 'data-list': 'tokens' },
        h('colgroup', {}, h('col', { class: 'col-t-name' }), h('col', { class: 'col-t-scope' }), h('col', { class: 'col-t-source' }), h('col', { class: 'col-t-date' }), h('col', {}), h('col', { class: 'col-t-act' })),
        h('thead', {}, h('tr', {}, ...[TOKEN_COLUMNS.name, TOKEN_COLUMNS.scopes, TOKEN_COLUMNS.source, TOKEN_COLUMNS.created, TOKEN_COLUMNS.id].map(label => h('th', {}, label)), h('th', { class: 'col-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
        tbody));
      const emptyCreate = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openForm() }, icon('plus'), 'New token');
      const empty = h('div', { class: 'card empty', hidden: true }, icon('key'), h('h2', {}, 'No access tokens yet'), h('p', {}, 'Create one for each collector or CLI so that you can revoke them separately.'), h('div', { class: 'row' }, emptyCreate));
      const foot = h('p', { class: 'xs muted' });
      const section = h('section', { class: 'account-section', 'data-view': 'tokens', 'aria-labelledby': titleId },
        h('div', { class: 'account-list-head' }, h('div', { class: 'grow' }, h('h1', { class: 'page-title', id: titleId }, 'Access tokens')), filterBox, revokedLabel, refresh, create),
        h('p', { class: 'small muted' }, 'Tokens authorize API clients such as collectors and CLIs. Signing out of the browser does not revoke them.'),
        slot, tableCard, empty, foot);

      const canCreate = () => self.account.phase === 'ready' && view.mode === 'idle' && !view.busy && !uncertainMints.has(owner);
      function renderSlot() {
        const nodes = [];
        if (view.mode === 'form') nodes.push(view.formUi.node);
        if (view.mode === 'secret') nodes.push(view.secretUi.node);
        const intent = uncertainMints.get(owner);
        if (intent !== undefined) nodes.push(uncertainNotice(intent));
        if (self.account.phase === 'failed') nodes.push(notice('danger', 'alert', 'Tokens could not be loaded', legacyMessage(self.account.error),
          h('div', { class: 'notice-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { loadAccount(); renderAll(); } }, 'Retry'))));
        if (view.notice !== null) nodes.push(view.notice);
        setChildren(slot, nodes); slot.hidden = nodes.length === 0;
        entry(create, !canCreate()); entry(emptyCreate, !canCreate());
      }
      function uncertainNotice(intent) {
        const dismiss = h('button', { class: 'btn btn-sm', type: 'button', disabled: !intent.refreshed || view.busy, title: intent.refreshed ? null : 'Available after the list has been refreshed',
          onclick: () => { if (uncertainMints.get(owner) === intent && intent.refreshed) { uncertainMints.delete(owner); renderSlot(); } } }, 'Dismiss');
        return h('div', { class: 'notice notice-warn', role: 'alert', 'data-account-uncertain': true }, icon('alert'),
          h('div', { class: 'grow' },
            h('div', { class: 'notice-title' }, intent.known ? `The secret of “${intent.name}” is no longer available` : `We could not confirm whether “${intent.name}” was created`),
            intent.known
              ? `The token was created, but its secret was cleared before it was saved. Refresh the list, revoke “${intent.name}” and create a new one.`
              : 'The request was sent but no valid reply arrived. Nothing is retried automatically. Refresh the list: if the token is there, its secret is lost — revoke it and create a new one.',
            h('div', { class: 'notice-actions' }, h('button', { class: 'btn btn-sm btn-primary', type: 'button', disabled: view.busy, onclick: () => void refreshTokens() }, icon('refresh'), 'Refresh list and check'), dismiss)));
      }
      function renderRows() {
        const account = accountData();
        tableCard.hidden = self.account.phase === 'failed' || (account !== null && account.tokens.length === 0);
        empty.hidden = account === null || account.tokens.length > 0;
        if (account === null) {
          revokedLabel.hidden = true; filterBox.hidden = true; foot.textContent = '';
          tbody.replaceChildren(...(self.account.phase === 'loading' ? Array.from({ length: 5 }, () => h('tr', {}, ...Array.from({ length: 5 }, () => h('td', {}, h('span', { class: 'skeleton sk-60' }))), h('td', {}))) : []));
          return;
        }
        const active = account.tokens.filter(token => !token.revoked), revoked = account.tokens.filter(token => token.revoked);
        const query = view.filter.trim().toLowerCase();
        const visible = (view.showRevoked ? account.tokens : active).filter(token => token.name.toLowerCase().includes(query));
        filterBox.hidden = account.tokens.length < TOKEN_FILTER_MIN_ROWS;
        revokedLabel.hidden = revoked.length === 0; revokedCount.textContent = String(revoked.length);
        tbody.replaceChildren(...visible.map(tokenRow));
        const configured = active.filter(token => token.source === 'configured').length;
        foot.textContent = `${active.length} active token${active.length === 1 ? '' : 's'}${configured > 0 ? `, ${configured} of them from server configuration (read-only)` : ''}`
          + `${revoked.length > 0 && !view.showRevoked ? ` · ${revoked.length} revoked hidden` : ''}${query === '' ? '' : ` · ${visible.length} match the filter`}`;
      }
      function tokenRow(token) {
        const configured = token.source === 'configured', isNew = token.id === view.highlight;
        const copyId = h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-label': `Copy token ID of ${token.name}`, title: 'Copy token ID',
          onclick: async () => { if (await copyText(token.id)) toast('Token ID copied'); } }, icon('copy'));
        return h('tr', { class: token.revoked ? 'is-revoked' : null, 'aria-selected': isNew ? 'true' : null, 'data-row-id': token.id },
          h('td', {}, h('span', { class: 'cell-title' }, token.name, isNew ? [' ', h('span', { class: 'chip chip-accent' }, 'new')] : null)),
          h('td', { 'data-label': TOKEN_COLUMNS.scopes }, ...token.scopes.flatMap((scope, index) => [index === 0 ? null : ' ', h('span', { class: 'chip' }, scope)])),
          h('td', { 'data-label': TOKEN_COLUMNS.source }, configured ? h('span', { class: 'muted', title: 'Managed in server configuration; read-only here' }, icon('lock', true), ' Configuration') : 'Issued here'),
          h('td', { 'data-label': TOKEN_COLUMNS.created }, recentDate(token.createdAt)),
          h('td', { 'data-label': TOKEN_COLUMNS.id }, h('span', { class: 'token-id-cell' }, h('span', { class: 'token-id', title: token.id }, token.id.length > TOKEN_ID_TAIL ? `…${token.id.slice(-TOKEN_ID_TAIL)}` : token.id), h('span', { class: 'row-actions' }, copyId))),
          h('td', { class: 'col-actions' }, token.revoked ? h('span', { class: 'chip' }, 'Revoked') : configured ? h('span', { class: 'xs muted' }, 'read-only')
            : entry(h('button', { class: 'btn btn-sm btn-danger-quiet', type: 'button', 'aria-label': `Revoke ${token.name}`, onclick: () => confirmRevoke(token) }, 'Revoke'), false)));
      }
      function renderAll() { renderSlot(); renderRows(); }

      function openForm() {
        if (!canCreate()) return;
        view.mode = 'form'; view.notice = null; view.formUi = tokenForm(accountData().scopes);
        renderSlot(); view.formUi.name.input.focus();
      }
      function closeForm() { view.mode = 'idle'; view.formUi = null; renderSlot(); create.focus(); flushRender(); }
      function tokenForm(scopes) {
        let selected = scopes.includes('api') ? ['api'] : [scopes.includes('Ingest') ? 'Ingest' : scopes[0]];
        const headId = nextId('token-form');
        const name = field({ label: 'Name', input: input({ name: 'name', maxlength: TOKEN_NAME_MAX, autocomplete: 'off', spellcheck: false }), hint: 'Shown in this list and in server logs. Pick something that tells you where it is used.', id: nextId('token-name') });
        const submit = entry(h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create token'), false);
        const checks = scopes.includes('api') ? [] : scopes.map(scope => h('input', { type: 'checkbox', value: scope, checked: selected.includes(scope) }));
        const permissions = scopes.includes('api')
          ? h('p', { class: 'small' }, h('strong', {}, 'Full API access'), h('span', { class: 'muted' }, ' — every operation of this service for your account. Keep access tokens private.'))
          : h('fieldset', { class: 'field' }, h('legend', { class: 'label' }, 'Permissions'), ...checks.map(check => h('label', { class: 'check' }, check, ' ',
            h('span', {}, h('strong', {}, check.value), SCOPE_MEANINGS[check.value] === undefined ? null : h('span', { class: 'muted' }, ` — ${SCOPE_MEANINGS[check.value]}`)))));
        for (const check of checks) check.addEventListener('change', () => {
          const chosen = new Set(selected);
          if (check.checked) chosen.add(check.value); else chosen.delete(check.value);
          if (check.value === 'Raw' && check.checked) chosen.add('Read');
          if (check.value === 'Read' && !check.checked) chosen.delete('Raw');
          selected = scopes.filter(scope => chosen.has(scope));
          for (const other of checks) other.checked = selected.includes(other.value);
          entry(submit, selected.length === 0);
        });
        const error = h('div', { role: 'alert', hidden: true });
        const form = h('form', { class: 'card', novalidate: true, 'aria-labelledby': headId, 'data-account-token-form': true },
          h('div', { class: 'card-head' }, h('h2', { id: headId }, 'New access token')),
          h('div', { class: 'card-body account-form' }, name.node, permissions, error,
            h('div', { class: 'form-actions' }, submit, h('button', { class: 'btn', type: 'button', onclick: closeForm }, 'Cancel'))));
        form.addEventListener('submit', event => {
          event.preventDefault();
          if (view.busy) return;
          const value = name.input.value.trim();
          if (value.length === 0) { name.setError('Enter a name. It cannot be empty or only spaces.'); name.input.focus(); return; }
          name.setError(null);
          void mint(value, [...selected]);
        });
        return {
          node: form, name,
          showError(text) { error.replaceChildren(); error.hidden = text === null; if (text !== null) error.append(notice('danger', 'alert', null, text)); }
        };
      }
      // A disposed area's write never resumes, so the catch below runs only for a live area.
      async function mint(name, scopes) {
        const form = view.formUi;
        view.busy = true; setBusy(form.node, true); form.showError(null);
        const intent = { name, known: false, refreshed: false };
        let sent = false;
        try {
          await write(async ops => {
            // Once the POST is sent, any failure can follow a committed issuance (README: token creation recovery).
            uncertainMints.set(owner, intent); sent = true;
            const result = await ops.post('/tokens', { name, scopes });
            if (result === null || typeof result.secret !== 'string' || result.secret.length === 0 || !validToken(result.token) || result.token.source !== 'issued') throw new AccountResponseError();
            if (uncertainMints.get(owner) !== intent) return;
            intent.known = true;
            const after = await ops.readAccount();
            if (!after.ok) throw new AccountStop();
            if (uncertainMints.get(owner) !== intent) return;
            if (!after.data.tokens.some(token => token.id === result.token.id && !token.revoked && token.source === 'issued')) throw new AccountResponseError();
            uncertainMints.delete(owner);
            view.busy = false; view.mode = 'secret'; view.formUi = null; view.highlight = result.token.id;
            view.secret = { token: result.token, value: result.secret, revealed: false, seen: false, copied: false };
            view.secretUi = secretPanel(view.secret);
            deliver('tokens'); view.secretUi.focus();
          });
        } catch (cause) {
          view.busy = false;
          if (sent && uncertainMints.get(owner) === intent) {
            view.mode = 'idle'; view.formUi = null;
            view.notice = cause instanceof AccountApiError && cause.status === 401 ? notice('danger', 'alert', null, SESSION_TEXT) : null;
            renderSlot();
          } else { setBusy(form.node, false); applyBusy(); form.showError(cause instanceof AccountStop ? CONNECTION_TEXT : legacyMessage(cause)); }
        }
      }
      function secretPanel(secret) {
        const value = input({ readonly: true, 'aria-label': 'One-time token secret', spellcheck: false, autocomplete: 'off', 'data-account-secret-value': true });
        const reveal = h('button', { class: 'btn btn-lg', type: 'button', 'aria-pressed': 'false' }, icon('eye'), 'Reveal');
        const copy = h('button', { class: 'btn btn-primary btn-lg', type: 'button' }, icon('copy'), 'Copy secret');
        const chip = h('span', {});
        const status = h('span', { class: 'muted', role: 'status' }, 'This panel stays until you confirm. Leaving this page asks first.');
        const saved = h('button', { class: 'btn push', type: 'button' }, 'I have saved it');
        function update() {
          value.value = secret.revealed && self.trusted ? secret.value : maskedSecret(secret.value);
          reveal.setAttribute('aria-pressed', String(secret.revealed));
          chip.className = secret.copied ? 'chip chip-ok' : 'chip chip-outline';
          chip.replaceChildren(...(secret.copied ? [icon('check', true), 'Copied'] : ['Not copied yet']));
          saved.disabled = !(secret.copied || secret.seen);
        }
        reveal.addEventListener('click', () => { if (!self.trusted) return; secret.revealed = !secret.revealed; secret.seen = true; update(); });
        copy.addEventListener('click', async () => {
          if (!self.trusted) return;
          const copied = await copyText(secret.value);
          if (view.secret !== secret) return;
          if (copied) { secret.copied = true; toast('Secret copied to clipboard'); }
          else status.textContent = 'Clipboard unavailable. Reveal the secret and copy it manually.';
          update();
        });
        saved.addEventListener('click', () => askLeave(null));
        const node = h('div', { class: 'secret', role: 'alert', 'data-account-secret': true },
          h('div', { class: 'secret-title' }, icon('key'), `Copy the secret for “${secret.token.name}” now`),
          h('p', { class: 'small' }, 'This is the only time it is available. It is not stored in this browser and cannot be retrieved later — if you lose it, revoke the token and create a new one.'),
          h('div', { class: 'secret-value' }, value, reveal, copy),
          h('div', { class: 'secret-foot' }, chip, status, saved));
        sensitive(reveal, 'action', null); sensitive(copy, 'action', null); sensitive(value, 'mask', update);
        return { node, focus: () => copy.focus() };
      }
      async function refreshTokens() {
        if (view.busy) return;
        view.busy = true; view.notice = null; renderSlot();
        const read = await io.read('account', applyAccount, false);
        const intent = uncertainMints.get(owner);
        if (read.ok && intent !== undefined) intent.refreshed = true;
        if (!read.ok) view.notice = notice('danger', 'alert', 'The token list could not be refreshed', legacyMessage(read.cause));
        view.busy = false; renderNav(); renderAll();
      }
      function confirmRevoke(token) {
        dialog({ title: `Revoke “${token.name}”?`, confirm: 'Revoke token', danger: true, cancel: 'Cancel', extra: [], fields: [],
          body: [h('p', {}, 'Clients using this token lose access immediately. This cannot be undone; create a new token to restore access.'),
            h('dl', { class: 'dl' }, h('dt', {}, 'Permissions'), h('dd', {}, token.scopes.join(', ')), h('dt', {}, 'Created'), h('dd', {}, dateNode(token.createdAt, DATE_FORMAT)),
              h('dt', {}, 'Token ID'), h('dd', { class: 'mono' }, token.id))],
          write: true,
          run: async () => {
            let sent = false;
            try {
              await write(async ops => {
                sent = true;
                const result = await ops.post(`/tokens/${encodeURIComponent(token.id)}/revoke`, {});
                if (result === null || result.ok !== true) throw new AccountResponseError();
                await ops.readAccount();
              });
              renderNav(); renderAll(); toast(`Token “${token.name}” revoked`);
              return null;
            } catch (cause) {
              if (cause instanceof AccountStop && !sent) return CONNECTION_TEXT;
              return sent ? `Revocation could not be confirmed. Refresh the token list before retrying. ${legacyMessage(cause)}` : legacyMessage(cause);
            }
          } });
      }
      self.tokensUi = { renderAll, renderRows };
      renderAll();
      return section;
    }

    // ── Users (admin) ────────────────────────────────────────────────────────────────────────
    function usersSection() {
      const view = self.usersView, profile = profileData();
      const titleId = nextId('users-title');
      const segmented = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter users' });
      const query = h('input', { type: 'text', 'aria-label': 'Filter users by name', placeholder: 'Filter by name', value: view.query, oninput: event => { view.query = event.target.value; renderRows(); } });
      const enroll = profile.manage.enrollment ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openEnroll() }, icon('plus'), 'Enroll user') : null;
      const slot = h('div', { class: 'stack', hidden: true });
      const tbody = h('tbody', {});
      const tableCard = h('div', { class: 'card' }, h('table', { class: 'table table-inset table-2line', 'aria-label': 'Users', 'data-list': 'users' },
        h('colgroup', {}, h('col', {}), h('col', { class: 'col-u-status' }), h('col', { class: 'col-u-src' }), h('col', { class: 'col-u-totp' }), h('col', { class: 'col-u-date col-optional' }), h('col', { class: 'col-u-act' })),
        h('thead', {}, h('tr', {}, ...[USER_COLUMNS.user, USER_COLUMNS.status, USER_COLUMNS.source, USER_COLUMNS.twoFactor].map(label => h('th', {}, label)), h('th', { class: 'col-optional' }, USER_COLUMNS.created), h('th', { class: 'col-actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
        tbody));
      const foot = h('p', { class: 'xs muted' });
      const section = h('section', { class: 'account-section', 'data-view': 'users', 'aria-labelledby': titleId },
        h('div', { class: 'account-list-head' }, h('div', { class: 'grow' }, h('h1', { class: 'page-title', id: titleId }, 'Users')), segmented,
          h('div', { class: 'querybar user-filter hide-md' }, icon('search'), query), enroll),
        slot, tableCard, foot);

      const users = () => (self.admin.phase === 'ready' ? self.admin.data.users : []);
      const enrollments = () => (self.admin.phase === 'ready' ? self.admin.data.enrollments : []);
      const nameOf = user => user.login ?? user.id;
      // A shown-once link must be acknowledged before another one can replace it (in-flight writes: entry()).
      const linkActionsBlocked = () => view.mode !== 'idle';
      const matches = { all: () => true, pending: user => user.status === 'pending', disabled: user => user.status === 'disabled', admins: user => user.admin };
      function renderSegmented() {
        const count = key => (key === 'all' ? rows().length : users().filter(matches[key]).length);
        segmented.replaceChildren(...USER_FILTERS.map(([key, label]) => h('button', { type: 'button', 'aria-pressed': String(view.filter === key), onclick: () => { view.filter = key; renderAll(); } },
          label, ' ', h('span', { class: key === 'pending' && count(key) > 0 ? 'count count-attn' : 'count' }, String(count(key))))));
      }
      function renderSlot() {
        const nodes = [];
        if (!profile.manage.enrollment) nodes.push(notice('neutral', 'info', null, `Invitations are turned off on this server, so there is no “Enroll user”. Approving, disabling${profile.manage.reset ? ', roles and credential resets remain' : ' and roles remain'} available.`));
        const pending = users().filter(matches.pending).length;
        if (pending > 0 && view.filter === 'all') {
          const policy = policyData();
          nodes.push(h('div', { class: 'notice notice-warn' }, icon('clock'), h('div', { class: 'grow' }, h('div', { class: 'notice-title' }, `${pending} self-registered account${pending === 1 ? ' is' : 's are'} waiting for approval`),
            `They cannot sign in until an administrator approves them.${policy !== null && policy.signup ? ' Sign-up is open; new accounts require approval.' : ''}`),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { view.filter = 'pending'; renderAll(); } }, 'Review')));
        }
        if (view.mode === 'form') nodes.push(view.formUi.node);
        if (view.mode === 'link') nodes.push(view.linkUi.node);
        const lost = lostLinks.get(owner);
        if (lost !== undefined) nodes.push(h('div', { class: 'notice notice-warn', role: 'alert', 'data-account-lost': true }, icon('alert'), h('div', { class: 'grow' }, lostText(lost),
          h('div', { class: 'notice-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { lostLinks.delete(owner); renderSlot(); } }, 'Dismiss')))));
        if (!['ready', 'loading', 'idle'].includes(self.admin.phase)) nodes.push(notice('danger', 'alert', 'Users could not be loaded', self.admin.phase === 'unauthorized' ? SESSION_TEXT : UNAVAILABLE_TEXT,
          h('div', { class: 'notice-actions' }, h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { self.admin = { phase: 'idle' }; renderAll(); void loadAdmin(); } }, 'Retry'))));
        setChildren(slot, nodes); slot.hidden = nodes.length === 0;
        if (enroll !== null) entry(enroll, linkActionsBlocked());
      }
      function rows() {
        const list = users().map(user => ({ kind: 'user', id: user.id, name: nameOf(user), user }));
        const known = new Set(list.map(row => row.id));
        for (const enrollment of enrollments()) if (enrollment.kind === 'invite' && !known.has(enrollment.username)) list.push({ kind: 'invite', id: enrollment.username, name: enrollment.username, enrollment });
        const pendingFirst = row => (row.kind === 'user' && row.user.status === 'pending' ? 0 : 1);
        return list.sort((a, b) => pendingFirst(a) - pendingFirst(b) || a.name.localeCompare(b.name));
      }
      function renderRows() {
        tableCard.hidden = !['ready', 'loading', 'idle'].includes(self.admin.phase);
        if (self.admin.phase !== 'ready') {
          tbody.replaceChildren(...Array.from({ length: 5 }, () => h('tr', {}, ...Array.from({ length: 5 }, () => h('td', {}, h('span', { class: 'skeleton sk-60' }))), h('td', {}))));
          foot.textContent = ''; return;
        }
        const all = rows(), text = view.query.trim().toLowerCase();
        const searchable = row => (row.kind === 'invite' ? [row.name] : [row.name, row.user.email ?? '', row.user.displayName]);
        const visible = all.filter(row => (row.kind === 'invite' ? view.filter === 'all' : matches[view.filter](row.user)))
          .filter(row => text === '' || searchable(row).some(value => value.toLowerCase().includes(text)));
        for (const close of [...menus]) close();
        tbody.replaceChildren(...visible.map(row => (row.kind === 'invite' ? inviteRow(row.enrollment) : userRow(row.user))));
        const configured = users().filter(user => user.source === 'declarative').length;
        const label = USER_FILTERS.find(([key]) => key === view.filter)[1].toLowerCase();
        foot.textContent = view.filter === 'all' && text === ''
          ? `${all.length} users${configured > 0 ? ` · ${configured} from server configuration (read-only)` : ''}`
          : `${visible.length} of ${all.length} entries · filtered${view.filter === 'all' ? '' : `: ${label}`}${text === '' ? '' : ` · name contains “${view.query.trim()}”`}`;
      }
      function renderAll() { renderSegmented(); renderSlot(); renderRows(); }
      const chip = (kind, text) => h('span', { class: kind === null ? 'chip' : `chip chip-${kind}` }, text);
      const enrollmentFor = (username, kind) => enrollments().find(enrollment => enrollment.username === username && enrollment.kind === kind) ?? null;
      function userRow(user) {
        const chips = [];
        if (user.status === 'pending') chips.push(chip('warn', 'Pending approval'));
        if (user.status === 'active') chips.push(user.locked ? chip('danger', 'Locked') : chip('ok', 'Active'));
        if (user.status === 'disabled') chips.push(chip(null, 'Disabled'));
        if (user.admin) chips.push(chip('accent', 'Admin'));
        if (user.pendingEnrollment === 'reset') {
          const reset = enrollmentFor(user.id, 'reset');
          chips.push(chip('info', 'Reset link sent'));
          if (reset !== null) chips.push(h('span', { class: 'xs muted' }, `expires ${expiryText(reset.expiresAt)}`));
        }
        const source = user.source === 'declarative' ? 'Configuration' : user.createdVia === 'enrollment' ? `Invited by ${user.createdBy ?? 'an administrator'}` : 'Sign-up';
        const twoFactor = user.totpRequired === null ? '—' : user.totpRequired ? 'Required' : 'Recovery only';
        return h('tr', { class: user.status === 'disabled' ? 'is-revoked' : null, 'data-row-id': user.id },
          h('td', {}, h('span', { class: 'cell-title' }, nameOf(user)), h('span', { class: 'cell-sub' }, user.email ?? (user.displayName === nameOf(user) ? '' : user.displayName))),
          h('td', { 'data-label': USER_COLUMNS.status }, h('div', { class: 'row row-wrap' }, ...chips)), h('td', { 'data-label': USER_COLUMNS.source }, source), h('td', { 'data-label': USER_COLUMNS.twoFactor }, twoFactor),
          h('td', { class: 'col-optional', 'data-label': USER_COLUMNS.created }, recentDate(user.createdAt)),
          h('td', { class: 'col-actions' }, userActions(user)));
      }
      function inviteRow(enrollment) {
        return h('tr', { 'data-row-id': `invite:${enrollment.username}` },
          h('td', {}, h('span', { class: 'cell-title' }, enrollment.username), h('span', { class: 'cell-sub' }, 'no account yet')),
          h('td', { 'data-label': USER_COLUMNS.status }, h('div', { class: 'row row-wrap' }, chip('info', 'Invitation sent'), h('span', { class: 'xs muted' }, `expires ${expiryText(enrollment.expiresAt)}`))),
          h('td', { 'data-label': USER_COLUMNS.source }, `Invited by ${enrollment.createdBy}`), h('td', { 'data-label': USER_COLUMNS.twoFactor }, '—'), h('td', { class: 'col-optional', 'data-label': USER_COLUMNS.created }, recentDate(enrollment.createdAt)),
          h('td', { class: 'col-actions' }, entry(h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Revoke the invitation for ${enrollment.username}`, onclick: () => confirmRevokeInvite(enrollment) }, 'Revoke link'), false)));
      }
      function userActions(user) {
        if (user.status === 'pending') return entry(h('button', { class: 'btn btn-sm btn-primary', type: 'button', 'aria-label': `Approve ${nameOf(user)}…`, onclick: () => openApplication(user) }, 'Approve…'), false);
        if (user.id === owner) return h('span', { class: 'xs muted' }, 'you');
        if (user.source === 'declarative') return h('span', { class: 'xs muted', title: 'Managed in server configuration' }, 'read-only');
        if (user.status === 'disabled') return entry(h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': `Enable ${nameOf(user)}`, onclick: () => confirmEnabled(user, true) }, 'Enable'), false);
        const items = [];
        if (profile.manage.reset) items.push(['key', 'Reset credentials…', () => confirmReset(user), false, linkActionsBlocked()]);
        // Pending resets can be revoked whenever the account plane is on (AM1), also without invitations.
        const reset = user.pendingEnrollment === 'reset' ? enrollmentFor(user.id, 'reset') : null;
        if (reset !== null) items.push(['link', 'Revoke reset link…', () => confirmRevokeReset(user, reset), false, false]);
        items.push(['shield', user.admin ? 'Revoke admin…' : 'Grant admin…', () => confirmAdmin(user), false, false]);
        items.push(['x-circle', 'Disable account…', () => confirmEnabled(user, false), true, false]);
        return rowMenu(`Actions for ${nameOf(user)}`, items);
      }
      // An open menu is a section-owned overlay: leave(), dispose() and a row re-render close it (menus set).
      function rowMenu(label, items) {
        const button = entry(h('button', { class: 'btn btn-ghost btn-icon btn-sm', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label }, icon('more')), false);
        const menu = h('div', { class: 'menu', role: 'menu', hidden: true });
        const outside = event => { if (!menu.contains(event.target) && !button.contains(event.target)) close(); };
        const keys = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); button.focus(); } };
        function close() { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', outside, true); menu.removeEventListener('keydown', keys); menus.delete(close); window.queueMicrotask(flushRender); }
        items.forEach(([iconName, text, run, danger, disabled], index) => {
          if (danger && index > 0) menu.append(h('div', { class: 'menu-sep', role: 'separator' }));
          menu.append(entry(h('button', { class: danger ? 'menu-item is-danger' : 'menu-item', role: 'menuitem', type: 'button', title: disabled ? 'Confirm the link shown above first' : null, onclick: () => { close(); run(); } }, icon(iconName), text), disabled));
        });
        button.addEventListener('click', () => {
          if (!menu.hidden) { close(); return; }
          menu.hidden = false; button.setAttribute('aria-expanded', 'true');
          document.addEventListener('click', outside, true); menu.addEventListener('keydown', keys); menus.add(close);
          menu.querySelector('button:not(:disabled)').focus();
        });
        return h('div', { class: 'anchor' }, button, menu);
      }
      function afterAction(outcome, message) {
        if (!outcome.ok) return outcome.text;
        toast(message); void loadAdmin();
        return null;
      }
      function openApplication(user) {
        const name = nameOf(user);
        dialog({ write: true, title: `Application of “${name}”`, confirm: 'Approve', danger: false, cancel: 'Cancel', fields: [],
          extra: [{ label: 'Reject application…', class: 'btn btn-danger-quiet', onclick: () => confirmReject(user) }],
          body: [h('p', {}, `Approving lets ${name} sign in immediately with the rights of a regular user. Rejecting removes the application and frees the username.`),
            h('dl', { class: 'dl' }, h('dt', {}, 'Username'), h('dd', {}, name, ' ', h('span', { class: 'muted' }, '(chosen by the applicant)')),
              h('dt', {}, 'E-mail'), h('dd', {}, user.email ?? '—', ' ', h('span', { class: 'muted' }, '(not verified)')),
              h('dt', {}, 'Registered'), h('dd', {}, dateNode(user.createdAt, DATE_TIME_FORMAT), ' · from sign-up'),
              h('dt', {}, 'Two-factor'), h('dd', {}, user.totpRequired ? 'Required at every sign-in' : 'Recovery only (no code at sign-in)')),
            h('p', { class: 'xs' }, 'Both values were entered by the applicant. Confirm who the person is through a channel you trust before approving.')],
          run: async () => afterAction(await act('approve-user', user.id, null, null), `${name} approved`) });
      }
      function confirmReject(user) {
        const name = nameOf(user);
        dialog({ write: true, title: `Reject the application of “${name}”?`, confirm: 'Reject and remove', danger: true, cancel: 'Cancel', fields: [], extra: [],
          body: [h('p', {}, `The application is removed: ${name} cannot sign in, and the username becomes available again. Nothing else is affected — a pending account never held data or access. This cannot be undone; the person can apply again.`)],
          run: async () => afterAction(await act('reject-user', user.id, null, null), `Application of ${name} rejected`) });
      }
      function confirmEnabled(user, enabled) {
        const name = nameOf(user);
        dialog({ write: true, title: enabled ? `Enable “${name}”?` : `Disable “${name}”?`, confirm: enabled ? 'Enable account' : 'Disable account', danger: !enabled, cancel: 'Cancel', fields: [], extra: [],
          body: [h('p', {}, enabled
            ? `${name} can sign in again with the existing password and authenticator, and the access tokens issued before work again.`
            : `${name} is signed out everywhere and can no longer sign in or recover the password. Issued access tokens stop working. A pending reset link is revoked. Data stays attributed to ${name}; the username is never reused. You can enable the account again later.`)],
          run: async () => afterAction(await act('set-user-enabled', user.id, { enabled }, null), enabled ? `${name} enabled` : `${name} disabled`) });
      }
      function confirmAdmin(user) {
        const name = nameOf(user), grant = !user.admin;
        dialog({ write: true, title: grant ? `Make “${name}” an administrator?` : `Remove administrator rights from “${name}”?`, confirm: grant ? 'Grant admin' : 'Revoke admin', danger: !grant, cancel: 'Cancel', fields: [PROOF_FIELD], extra: [],
          body: [h('p', {}, grant
            ? 'Administrators can enroll, approve, disable and reset users and grant or revoke this role. Accounts from server configuration cannot be changed here.'
            : `${name} keeps a regular account and loses access to user management.`)],
          run: async values => afterAction(await act('set-user-admin', user.id, { admin: grant, currentPassword: values.currentPassword }, PROOF_REJECTED_TEXT), grant ? `${name} is now an administrator` : `${name} is no longer an administrator`) });
      }
      function confirmReset(user) {
        const name = nameOf(user);
        dialog({ write: true, title: `Reset credentials of “${name}”?`, confirm: 'Create reset link', danger: false, cancel: 'Cancel', fields: [PROOF_FIELD], extra: [],
          body: [h('p', {}, `You get a one-time link that lets ${name} choose a new password and set up a new authenticator. The current credentials keep working until the link is used. API tokens, e-mail and role are kept.`)],
          run: async values => {
            const outcome = await linkWrite('reset', name, 'reset-user', user.id, { currentPassword: values.currentPassword }, PROOF_REJECTED_TEXT);
            if (!outcome.ok) return outcome.text;
            void loadAdmin();
            return null;
          } });
      }
      function confirmRevokeInvite(enrollment) {
        dialog({ write: true, title: `Revoke the invitation for “${enrollment.username}”?`, confirm: 'Revoke link', danger: true, cancel: 'Cancel', fields: [], extra: [],
          body: [h('p', {}, 'The link stops working immediately and the username becomes available again. You can create a new invitation later.')],
          run: async () => afterAction(await act('revoke-enrollment', enrollment.id, null, null), `Invitation for ${enrollment.username} revoked`) });
      }
      function confirmRevokeReset(user, enrollment) {
        const name = nameOf(user);
        dialog({ write: true, title: `Revoke the reset link for “${name}”?`, confirm: 'Revoke link', danger: true, cancel: 'Cancel', fields: [], extra: [],
          body: [h('p', {}, `The link stops working immediately. ${name}'s current password and authenticator keep working; nothing else changes. You can create a new reset link later.`)],
          run: async () => afterAction(await act('revoke-enrollment', enrollment.id, null, null), `Reset link for ${name} revoked`) });
      }
      function openEnroll() {
        if (view.mode !== 'idle') return;
        const headId = nextId('enroll');
        const username = field({ label: 'Username', input: input({ name: 'username', autocomplete: 'off', spellcheck: false, maxlength: 32 }), hint: 'The person completes e-mail, password and authenticator set-up from the link. Creating another link for the same username replaces the earlier one.', id: nextId('enroll-user') });
        const status = h('div', { role: 'alert' });
        const form = h('form', { class: 'card', novalidate: true, 'aria-labelledby': headId, 'data-account-enroll-form': true },
          h('div', { class: 'card-head' }, h('h2', { id: headId }, 'Enroll a user'), h('span', { class: 'xs muted' }, 'creates a one-time invitation link')),
          h('div', { class: 'card-body account-form' }, username.node, status,
            h('div', { class: 'form-actions' }, entry(h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create invitation link'), false),
              h('button', { class: 'btn', type: 'button', onclick: () => { view.mode = 'idle'; view.formUi = null; renderAll(); flushRender(); } }, 'Cancel'))));
        form.addEventListener('submit', async event => {
          event.preventDefault();
          const value = username.input.value.trim();
          if (value.length === 0) { username.setError('Enter the username for the new account.'); return; }
          setBusy(form, true); status.replaceChildren(); username.setError(null);
          const outcome = await linkWrite('invite', value, 'issue-invitation', null, { username: value }, null);
          setBusy(form, false); applyBusy();
          if (outcome.ok) { void loadAdmin(); return; }
          const code = errorCode(outcome);
          if (code === 'username-unavailable') username.setError(`“${value}” is not available. Choose another username.`);
          else if (code === 'invalid') username.setError('Use 3–32 lowercase letters, digits, “-” or “_”, starting with a letter.');
          else if (outcome.text !== null) status.append(notice('danger', 'alert', null, outcome.text));
        });
        view.mode = 'form'; view.formUi = { node: form }; renderAll(); username.input.focus();
      }
      // Invitation and reset: the link is delivered inside the write, so nothing can slip in before it is shown.
      async function linkWrite(kind, name, action, target, input, proofText) {
        self.pendingLink = { kind, name };
        try {
          return await write(async ops => {
            const outcome = await actWith(ops, action, target, input, proofText);
            if (outcome.ok) showLink(kind, name, outcome.result);
            return outcome;
          });
        } catch (cause) {
          if (cause instanceof AccountStop) return { ok: false, text: CONNECTION_TEXT, error: null };
          throw cause;
        } finally { self.pendingLink = null; }
      }
      function showLink(kind, name, result) {
        if (view.mode === 'link') throw new Error('A shown-once link would replace an unacknowledged one');
        const link = { kind, name, url: enrollmentLink(window.location.origin, result.code), expiresAt: result.enrollment.expiresAt };
        view.mode = 'link'; view.formUi = null; view.link = link; view.linkUi = linkPanel(link);
        deliver('users'); view.linkUi.focus();
      }
      function linkPanel(link) {
        const value = input({ readonly: true, 'aria-label': 'One-time link', spellcheck: false, 'data-account-link-value': true });
        const chipNode = h('span', { class: 'chip chip-outline' }, 'Not copied yet');
        const status = h('span', { class: 'muted', role: 'status' }, 'This panel stays until you confirm.');
        const sent = h('button', { class: 'btn push', type: 'button', disabled: true, onclick: () => askLeave(null) }, 'I have sent it');
        const copy = h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: async () => {
          if (!self.trusted) return;
          const copied = await copyText(link.url);
          if (view.link !== link) return;
          if (copied) { chipNode.className = 'chip chip-ok'; chipNode.replaceChildren(icon('check', true), 'Copied'); toast('Link copied to clipboard'); }
          else { status.textContent = 'Clipboard unavailable. Select the link and copy it manually.'; value.focus(); value.select(); }
          sent.disabled = false;
        } }, icon('copy'), 'Copy link');
        const node = h('div', { class: 'secret', role: 'alert', 'data-account-link': true },
          h('div', { class: 'secret-title' }, icon('link'), link.kind === 'invite' ? `Invitation link for “${link.name}” — shown once` : `Credential reset link for “${link.name}” — shown once`),
          h('p', { class: 'small' }, ...(link.kind === 'invite'
            ? ['Send it over a channel you trust. It works once, expires ', h('strong', {}, dateNode(link.expiresAt, DATE_TIME_FORMAT)), ` (${expiryText(link.expiresAt)}), and is not stored here. If it gets lost, create a new link — that invalidates this one.`]
            : [`Send it over a channel you trust. ${link.name}'s current password keeps working until the link is used. It works once and expires `, h('strong', {}, dateNode(link.expiresAt, DATE_TIME_FORMAT)), '. If you suspect compromise, disable the account instead.'])),
          h('div', { class: 'secret-value' }, value, copy),
          h('div', { class: 'secret-foot' }, chipNode, status, sent));
        // While authority is unverified the link is masked like a token secret.
        sensitive(copy, 'action', null); sensitive(value, 'mask', trusted => { value.value = trusted ? link.url : maskedSecret(link.url); });
        return { node, focus: () => copy.focus() };
      }
      self.usersUi = { renderAll };
      renderAll();
      return section;
    }

    // ── Guard for one-time secrets and links ─────────────────────────────────────────────────
    const guarded = () => self.tokenView.mode === 'secret' || self.usersView.mode === 'link';
    function dropGuarded() {
      Object.assign(self.tokenView, { mode: 'idle', secret: null, secretUi: null, formUi: null });
      Object.assign(self.usersView, { mode: 'idle', link: null, linkUi: null, formUi: null });
      if (self.tokensUi !== null) self.tokensUi.renderAll();
      if (self.usersUi !== null) self.usersUi.renderAll();
    }
    function guardDialog(run) {
      const secret = self.tokenView.mode === 'secret';
      const name = secret ? self.tokenView.secret.token.name : self.usersView.link.name;
      dialog({ title: secret ? 'Hide the secret for good?' : 'Hide the link for good?', confirm: secret ? 'Yes, I have saved it' : 'Yes, I have sent it', danger: false, cancel: 'Keep it visible', fields: [], extra: [],
        body: [h('p', {}, ...(secret
          ? ['After this, the secret of ', h('strong', {}, name), ' cannot be shown again. Continue only if it is stored in your client or password manager.']
          : ['After this, the link for ', h('strong', {}, name), ' cannot be shown again. Continue only if you have sent it.']))],
        run });
    }
    // `then` runs after the user confirms (navigation that was held back), or null for the panel's own button.
    function askLeave(then) { guardDialog(async () => { dropGuarded(); if (then !== null) then(); return null; }); }
    // Sign-out with a one-time value shown: the confirmation only starts sign-out; the value is dropped after
    // /logout succeeded (by the sign-out completion), and a failure leaves everything as it was.
    function confirmSignOut(signOut) { guardDialog(signOut); }

    const api = {
      outlet, owner, open, leave, guarded, askLeave, confirmSignOut, dropGuarded, verify, lostValues, applyBusy,
      signOut: () => io.signOut(),
      dispose() {
        self.alive = false; controller.abort();
        coordinator.release(api);
        closeOverlays();
        for (const value of lostValues()) {
          if (value.kind === 'token' && !uncertainMints.has(owner)) uncertainMints.set(owner, { name: value.name, known: true, refreshed: false });
          if (value.kind !== 'token') lostLinks.set(owner, value);
        }
        root.remove();
      }
    };
    loadAccount(); loadProfile(true); loadPolicy();
    return api;
  }

  // ------------------------------------------------------------------------------------------
  // Mounts, routing and host events

  let blocked = null; // { outlet, owner } after an owner mismatch, until the host updates the outlet
  let display = null; // { outlet, mains, scrollY } while an account route covers the host main

  // Forced teardown after authority was lost ('changed': another account, 'signed-out': no session) or given up
  // ('logged-out', after the guard). Lost shown-once values are listed in the outlet and kept per owner.
  // Bound to the area instance: a completion for an area that is already gone does nothing.
  function forceTeardown(target, reason) {
    if (area === null || area !== target) return;
    const lost = target.lostValues();
    teardownArea();
    const stale = { outlet: target.outlet, owner: target.owner };
    blocked = stale;
    const title = { changed: 'The signed-in account changed', 'signed-out': 'You were signed out', 'logged-out': 'Signed out' }[reason];
    stale.outlet.replaceChildren(h('div', { class: 'account', 'data-view': 'account-ended' }, notice(reason === 'logged-out' ? 'neutral' : 'warn', 'alert', title,
      reason === 'logged-out' ? 'Sign in again to continue.' : 'Reload the page to continue with the current account.',
      lost.length === 0 ? null : h('ul', { class: 'stack-sm' }, ...lost.map(value => h('li', { 'data-account-lost': true }, lostText(value)))))));
    document.dispatchEvent(new window.Event('account:changed'));
  }
  function teardownArea() { if (area !== null) { area.dispose(); area = null; } }
  function showOutlet(outlet) {
    if (display !== null && display.outlet === outlet) return;
    hideOutlet();
    const mains = [...outlet.parentElement.children].filter(element => element !== outlet && element.tagName === 'MAIN' && !element.hidden);
    display = { outlet, mains, scrollY: window.scrollY };
    for (const main of mains) main.hidden = true;
    outlet.hidden = false;
    window.scrollTo(0, 0);
  }
  function hideOutlet() {
    if (display === null) return;
    const { outlet, mains, scrollY } = display;
    display = null;
    outlet.hidden = true;
    for (const main of mains) main.hidden = false;
    window.scrollTo(0, scrollY);
    document.dispatchEvent(new window.CustomEvent('account:route', { detail: { section: null } }));
  }
  // The one function every way of leaving the current view consults: link clicks, hashchange and Back,
  // programmatic navigate(), observer-triggered and pageshow routing all reach it (onClick, route).
  // A view with a request in flight is held; one showing an unacknowledged secret or link asks first.
  let routedHash = null; // the fragment the current view was rendered for
  function mayLeave(target) {
    if (routedHash === null || target === routedHash) return true;
    const areaLive = area !== null && display !== null && display.outlet.isConnected;
    const authLive = auth !== null && auth.mount.isConnected;
    if ((areaLive && coordinator.slotTaken()) || (authLive && authInFlight > 0)) { toast(HOLD_TEXT); return false; }
    if (areaLive && area.guarded()) { area.askLeave(() => navigate(target)); return false; }
    return true;
  }
  const urlFor = hash => (hash === '' ? window.location.pathname + window.location.search : hash);
  function route() {
    const target = window.location.hash;
    if (!mayLeave(target)) { window.history.replaceState(null, '', urlFor(routedHash)); return; }
    render(parseAccountRoute(target));
    routedHash = window.location.hash;
  }
  // Replaces, after the fact, the fragment the current view was routed for (an open section the profile does not offer)
  // and routes the replacement like any navigation (mayLeave). Only while the location is still that fragment: a
  // navigation whose hashchange is not delivered yet is never overwritten; its own route() decides on its fragment.
  function replaceRouted(hash) {
    if (window.location.hash !== routedHash) return;
    window.history.replaceState(null, '', hash);
    route();
  }
  // Shows the section that owns a shown-once value (used only by an area's invariant check).
  function reveal(hash) {
    window.history.replaceState(null, '', hash);
    routedHash = hash;
    route();
  }
  function render(name) {
    const authMount = document.querySelector('[data-account-auth]');
    const outlet = document.querySelector('[data-account-outlet]');
    const owner = outlet === null ? null : outlet.dataset.accountUserId;
    if (outlet !== null && (owner === undefined || owner.length === 0)) throw new Error('[data-account-outlet] requires data-account-user-id');
    // An enrollment link opened while signed in is shown in the outlet; redeeming it replaces the session.
    const authTarget = authMount !== null ? authMount : outlet !== null && enrollmentCode.value !== null ? outlet : null;
    if (auth !== null && auth.mount !== authTarget) { auth.dispose(); auth = null; if (outlet !== null && authTarget !== outlet) outlet.replaceChildren(); }
    if (area !== null && (area.outlet !== outlet || area.owner !== owner)) teardownArea();
    if (blocked !== null && (blocked.outlet !== outlet || blocked.owner !== owner)) blocked = null;
    if (auth === null && authTarget !== null) auth = createAuth(authTarget);
    if (auth !== null) auth.route(name);
    if (outlet === null) { display = null; return; }
    if (auth !== null && auth.mount === outlet) { showOutlet(outlet); return; }
    if (name === null || AUTH_ROUTES.includes(name)) { if (area !== null) area.leave(); hideOutlet(); return; }
    showOutlet(outlet);
    if (blocked !== null) return;
    if (area === null) area = createArea(outlet, owner);
    area.open(SECTIONS.includes(name) ? name : DEFAULT_SECTION);
  }
  function onClick(event) {
    if (!(event.target instanceof window.Element)) return;
    // In-app links ask before they navigate, so that keeping the panel leaves no extra history entry.
    const link = event.target.closest('a[href^="#"]');
    if (link !== null && !mayLeave(link.getAttribute('href') === '#' ? '' : link.getAttribute('href'))) { event.preventDefault(); return; }
    const logout = event.target.closest('[data-account-logout]');
    if (logout !== null && !logout.disabled) { event.preventDefault(); requestLogout(); return; }
    const trigger = event.target.closest('[data-account-settings]');
    if (trigger === null || trigger.disabled) return;
    event.preventDefault();
    if (document.querySelector('[data-account-outlet]') === null) throw new Error('[data-account-settings] requires a [data-account-outlet] element');
    const section = trigger.dataset.accountSettings;
    navigate(ROUTE_PREFIX + (SECTIONS.includes(section) ? section : DEFAULT_SECTION));
  }
  function onSubmit(event) {
    if (!(event.target instanceof window.HTMLFormElement) || !event.target.matches('[data-account-login]')) return;
    event.preventDefault(); void submitCredentials(event.target);
  }
  // account:invalidate: authority may have changed. `detail.reason === 'signed-out'` is authoritative (a host that
  // signed out by itself): lost at once, no read. Otherwise the area re-reads; nothing is torn down meanwhile.
  function onInvalidate(event) {
    const target = area;
    if (target === null) { route(); return; }
    const detail = event instanceof window.CustomEvent ? event.detail : null;
    if (detail !== null && typeof detail === 'object' && detail.reason === 'signed-out') { coordinator.nextEpoch(); forceTeardown(target, 'signed-out'); return; }
    void target.verify();
  }
  function reconnect() { if (area !== null) void area.verify(); }
  // [data-account-logout]: single-flight through the coordinator's slot; with a one-time value shown it asks first.
  function requestLogout() {
    if (coordinator.slotTaken()) { toast(HOLD_TEXT); return; }
    const target = area;
    if (target !== null && target.guarded()) { target.confirmSignOut(() => signOut(target)); return; }
    void signOut(target).then(failure => { if (failure !== null) toast(failure); });
  }
  // Resolves to null when there is nothing more to say, or to the failure text; a failure changes nothing.
  // 'changed' (another owner signed in meanwhile: no POST, the area is lost) and 'cancelled' (the area is gone).
  async function signOut(target) {
    const result = target === null ? await coordinator.signOutUnbound() : await target.signOut();
    if (result.outcome === 'held') return HOLD_TEXT;
    if (result.outcome === 'failed') return `Sign-out failed. ${legacyMessage(result.cause)}`;
    if (result.outcome !== 'done') return null;
    if (target !== null && area === target) { target.dropGuarded(); forceTeardown(target, 'logged-out'); }
    else document.dispatchEvent(new window.Event('account:changed'));
    return null;
  }
  function onBeforeUnload(event) { if (coordinator.slotTaken() || (area !== null && area.guarded())) { event.preventDefault(); event.returnValue = ''; } }
  const observer = new window.MutationObserver(() => route());
  observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-account-user-id'] });
  document.addEventListener('click', onClick); document.addEventListener('submit', onSubmit); document.addEventListener('account:invalidate', onInvalidate);
  window.addEventListener('hashchange', route); window.addEventListener('focus', reconnect); window.addEventListener('online', reconnect);
  window.addEventListener('pagehide', teardownArea); window.addEventListener('pageshow', route); window.addEventListener('beforeunload', onBeforeUnload);
  route();
  return {
    dispose() {
      observer.disconnect(); teardownArea(); if (auth !== null) auth.dispose();
      document.removeEventListener('click', onClick); document.removeEventListener('submit', onSubmit); document.removeEventListener('account:invalidate', onInvalidate);
      window.removeEventListener('hashchange', route); window.removeEventListener('focus', reconnect); window.removeEventListener('online', reconnect);
      window.removeEventListener('pagehide', teardownArea); window.removeEventListener('pageshow', route); window.removeEventListener('beforeunload', onBeforeUnload);
      uncertainMints.clear();
    }
  };
}

installAccountUI({ document, window, fetch: window.fetch.bind(window) });
