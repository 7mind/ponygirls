// DOM-free client for the account v1 self-signup / enrollment / recovery / management endpoints.
// No DOM, no storage, no network except through the injected `fetch`; secrets live only in the
// states and arguments the caller holds. Design: docs/drafts/20261117-2040-self-signup-admin-enrollment-design.md
// (§4.2, §4.9, §5.1 and the amendments AM1/AM2 of §12).
//
// QR encoder: written from ISO/IEC 18004 (byte mode, error-correction level M, versions 1-40);
// no third-party code is vendored. Mask selection reproduces libqrencode 4.1.1 so that the output is
// bit-identical to `qrencode -8 -l M`, the independent reference used by the tests.

export const ACCOUNT_API_PATH = '/api/account/v1';
export const ACCOUNT_REQUEST_TIMEOUT_MS = 15_000;
export const ENROLLMENT_FRAGMENT_PREFIX = '#account-enroll=';
export const TOTP_PARAMETERS = Object.freeze({ algorithm: 'SHA1', digits: 6, period: 30, secretBytes: 20 });
// Sent with every account request: a custom header proves same origin where browsers send neither Origin nor
// Sec-Fetch-Site (plain-HTTP origins), because a cross-origin page cannot add it without a CORS preflight.
// `X-Account-Scopes: all` asks for every account scope by name (Chronicle's OperateJobs); a service without such
// scopes ignores it.
export const ACCOUNT_REQUEST_HEADERS = Object.freeze({ Accept: 'application/json', 'X-Account-Request': '1', 'X-Account-Scopes': 'all' });

const ACTOR_HEADER = 'X-Account-Actor';
const RETRY_AFTER_HEADER = 'Retry-After';
const STATUS_PENDING = 'pending';
const STATUS_ACTIVE = 'active';
const HTTP_ACCEPTED = 202;

// ---------------------------------------------------------------------------------------------
// Errors

export class AccountApiError extends Error {
  constructor(status, code, retryAfter) { super('Account request failed'); this.status = status; this.code = code; this.retryAfter = retryAfter; }
}
export class AccountResponseError extends Error {
  constructor() { super('Invalid account response'); }
}
export class AccountOwnerChangedError extends Error {
  constructor() { super('Account owner changed'); }
}

// ---------------------------------------------------------------------------------------------
// Response validation (shapes of design §5.1; unknown extra members are tolerated)

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string';
const isNonEmptyText = value => typeof value === 'string' && value.length > 0;
const isTextOrNull = value => value === null || typeof value === 'string';
const isBoolean = value => typeof value === 'boolean';
const isOneOf = (...values) => value => values.includes(value);
const isInteger = value => Number.isInteger(value);

function hasShape(value, shape) {
  return isObject(value) && Object.entries(shape).every(([key, check]) => check(value[key]));
}
const validUser = user => hasShape(user, { id: isNonEmptyText, login: isText, displayName: isText, actor: isNonEmptyText });
const validEnrollment = value => hasShape(value, { id: isNonEmptyText, username: isNonEmptyText, kind: isOneOf('invite', 'reset'), createdBy: isNonEmptyText, createdAt: isNonEmptyText, expiresAt: isNonEmptyText });
const validPolicy = value => hasShape(value, {
  signup: isBoolean, approval: isBoolean, enrollment: isBoolean, reset: isBoolean, issuer: isNonEmptyText,
  username: username => hasShape(username, { pattern: isNonEmptyText }),
  password: password => hasShape(password, { minLength: isInteger, maxLength: isInteger }),
  totp: totp => hasShape(totp, { algorithm: isOneOf(TOTP_PARAMETERS.algorithm), digits: isOneOf(TOTP_PARAMETERS.digits), period: isOneOf(TOTP_PARAMETERS.period), secretBytes: isOneOf(TOTP_PARAMETERS.secretBytes) })
});
const validProfile = value => hasShape(value, {
  user: validUser, source: isOneOf('declarative', 'imperative'), admin: isBoolean, email: isTextOrNull,
  totp: totp => hasShape(totp, { required: isBoolean, state: isOneOf('ok', 'unavailable', 'none') }),
  manage: manage => hasShape(manage, { email: isBoolean, password: isBoolean, totp: isBoolean, users: isBoolean, enrollment: isBoolean, reset: isBoolean })
});
const validManagedUser = value => hasShape(value, {
  id: isNonEmptyText, login: isTextOrNull, displayName: isText, type: isNonEmptyText, source: isOneOf('declarative', 'imperative'),
  status: isOneOf('active', 'disabled', STATUS_PENDING), admin: isBoolean, email: isTextOrNull, createdAt: isTextOrNull,
  createdVia: value => value === null || ['signup', 'enrollment'].includes(value), createdBy: isTextOrNull, approvedBy: isTextOrNull,
  totpRequired: value => value === null || isBoolean(value), totpState: isNonEmptyText, locked: isBoolean,
  pendingEnrollment: value => value === null || ['invite', 'reset'].includes(value)
});
const isIndexingChoice = isOneOf('inherit', 'enabled', 'disabled');
const indexingStateShape = { userId: isNonEmptyText, defaultEnabled: isBoolean, enabled: isBoolean, choice: isIndexingChoice, override: isIndexingChoice };
const validIndexing = value => hasShape(value, { ...indexingStateShape, admin: isBoolean, allowOptIn: isBoolean, allowOptOut: isBoolean });
const validManagedIndexing = value => hasShape(value, { ...indexingStateShape, displayName: isText });
const validOk = value => hasShape(value, { ok: value => value === true });
const validSignupResult = (value, status) => status === HTTP_ACCEPTED
  ? hasShape(value, { status: isOneOf(STATUS_PENDING) })
  : hasShape(value, { status: isOneOf(STATUS_ACTIVE), user: validUser });

// ---------------------------------------------------------------------------------------------
// HTTP client

function parseRetryAfter(response) {
  const raw = response.headers.get(RETRY_AFTER_HEADER);
  return raw !== null && /^[0-9]{1,9}$/.test(raw) ? Number(raw) : null;
}
async function apiError(response) {
  let code = null;
  try {
    const body = await response.json();
    if (isObject(body) && isObject(body.error) && isNonEmptyText(body.error.code)) code = body.error.code;
  } catch { /* an unreadable body leaves the code unknown */ }
  return new AccountApiError(response.status, code, parseRetryAfter(response));
}

// `signal` is an AbortSignal (or null) that cancels every request of this client; each request also times out.
export function createAccountClient({ fetch, requestTimeoutMs, signal }) {
  async function request(method, path, body, actor, validate) {
    const signals = [AbortSignal.timeout(requestTimeoutMs)];
    if (signal !== null) signals.push(signal);
    const options = { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.any(signals), headers: { ...ACCOUNT_REQUEST_HEADERS } };
    if (body !== null) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    if (actor !== null) options.headers[ACTOR_HEADER] = actor;
    const response = await fetch(ACCOUNT_API_PATH + path, options);
    if (!response.ok) throw await apiError(response);
    let data;
    try { data = await response.json(); } catch { throw new AccountResponseError(); }
    if (!validate(data, response.status)) throw new AccountResponseError();
    return data;
  }
  const get = (path, validate) => request('GET', path, null, null, validate);
  const post = (path, body, validate) => request('POST', path, body, null, validate);
  // A mutation takes the actor from a fresh read of the profile and refuses to proceed for another owner.
  async function mutate(owner, path, body, validate) {
    const profile = await get('/profile', validProfile);
    if (profile.user.id !== owner) throw new AccountOwnerChangedError();
    return request('POST', path, body, profile.user.actor, validate);
  }
  function ownIndexing(value, owner) {
    if (value.userId !== owner) throw new AccountOwnerChangedError();
    return value;
  }
  // Indexing is independent of /profile. The sequencer supplies the actor from its owner-checked GET /.
  async function mutateIndexing(actor, path, body, validate) {
    if (!isNonEmptyText(actor)) throw new AccountResponseError();
    return request('POST', path, body, actor, validate);
  }
  const userPath = (id, action) => `/admin/users/${encodeURIComponent(id)}/${action}`;
  const withOptional = (body, key, value) => (value === null ? body : { ...body, [key]: value });

  return {
    policy: () => get('/policy', validPolicy),
    login: ({ login, password, totp }) => post('/login', withOptional({ login, password }, 'totp', totp), value => hasShape(value, { user: validUser })),
    signup: ({ username, email, password, totpSecret, totpCode, requireTotp }) => post('/signup', { username, email, password, totpSecret, totpCode, requireTotp }, validSignupResult),
    inspectEnrollment: code => post('/enrollments/inspect', { code }, value => hasShape(value, { username: isNonEmptyText, kind: isOneOf('invite', 'reset'), expiresAt: isNonEmptyText })),
    // `email` is null for a reset code (the member must then be absent) and required for an invitation.
    redeemEnrollment: ({ code, email, password, totpSecret, totpCode, requireTotp }) => post('/enrollments/redeem', withOptional({ code, password, totpSecret, totpCode, requireTotp }, 'email', email), value => hasShape(value, { user: validUser })),
    recover: ({ username, totp, password }) => post('/recover', { username, totp, password }, value => hasShape(value, { user: validUser })),
    profile: () => get('/profile', validProfile),
    indexing: owner => get('/indexing', validIndexing).then(value => ownIndexing(value, owner)),
    setIndexing: (owner, actor, { choice }) => mutateIndexing(actor, '/indexing', { choice }, validIndexing).then(value => ownIndexing(value, owner)),
    adminIndexing: () => get('/admin/indexing', value => hasShape(value, { users: users => Array.isArray(users) && users.every(validManagedIndexing) })).then(value => value.users),
    setIndexingOverride: (actor, userId, { override, currentPassword }) => mutateIndexing(actor, '/admin/indexing', { userId, override, currentPassword }, validOk),
    changeEmail: (owner, { email }) => mutate(owner, '/profile/email', { email }, validOk),
    changePassword: (owner, { currentPassword, newPassword }) => mutate(owner, '/profile/password', { currentPassword, newPassword }, validOk),
    // `currentTotp` is null unless mandatory TOTP is on (the member must then be absent).
    replaceTotp: (owner, { currentPassword, totpSecret, totpCode, currentTotp }) => mutate(owner, '/profile/totp', withOptional({ currentPassword, totpSecret, totpCode }, 'currentTotp', currentTotp), validOk),
    setTotpRequired: (owner, { required, totp }) => mutate(owner, '/profile/totp-required', { required, totp }, validOk),
    adminUsers: () => get('/admin/users', value => hasShape(value, { users: users => Array.isArray(users) && users.every(validManagedUser) })).then(value => value.users),
    approveUser: (owner, id) => mutate(owner, userPath(id, 'approve'), {}, validOk),
    rejectUser: (owner, id) => mutate(owner, userPath(id, 'reject'), {}, validOk),
    setUserEnabled: (owner, id, { enabled }) => mutate(owner, userPath(id, 'enabled'), { enabled }, validOk),
    setUserAdmin: (owner, id, { admin, currentPassword }) => mutate(owner, userPath(id, 'admin'), { admin, currentPassword }, validOk),
    resetUser: (owner, id, { currentPassword }) => mutate(owner, userPath(id, 'reset'), { currentPassword }, value => hasShape(value, { enrollment: validEnrollment, code: isNonEmptyText })),
    enrollments: () => get('/admin/enrollments', value => hasShape(value, { enrollments: list => Array.isArray(list) && list.every(validEnrollment) })).then(value => value.enrollments),
    issueEnrollment: (owner, { username }) => mutate(owner, '/admin/enrollments', { username }, value => hasShape(value, { enrollment: validEnrollment, code: isNonEmptyText })),
    revokeEnrollment: (owner, id) => mutate(owner, `/admin/enrollments/${encodeURIComponent(id)}/revoke`, {}, validOk)
  };
}

// ---------------------------------------------------------------------------------------------
// Failure classification shared by the state machines

const FIELD_ERRORS = ['invalid', 'weak-password', 'totp-mismatch', 'username-unavailable'];

// Maps any failure of a client call to { code, retryAfter }. Only (status, code) pairs of the design are trusted.
export function describeFailure(cause) {
  if (cause instanceof AccountOwnerChangedError) return { code: 'owner-changed', retryAfter: null };
  if (!(cause instanceof AccountApiError)) return { code: 'unavailable', retryAfter: null };
  const { status, code, retryAfter } = cause;
  const described = name => ({ code: name, retryAfter: name === 'rate-limited' ? retryAfter : null });
  if (status === 429) return described('rate-limited');
  if (status === 400) return described(['weak-password', 'totp-mismatch'].includes(code) ? code : 'invalid');
  if (status === 401) return described(code === 'totp-required' ? 'totp-required' : 'unauthorized');
  if (status === 403) return described(['pending-approval', 'proof-rejected'].includes(code) ? code : 'forbidden');
  if (status === 404) return described('not-found');
  if (status === 409 && code === 'username-unavailable') return described(code);
  return described('unavailable');
}
async function attempt(call) {
  try { return { ok: true, value: await call() }; } catch (cause) { return { ok: false, failure: describeFailure(cause) }; }
}
// Failure → error shown inside a form: field errors, rate-limited (with retryAfter), otherwise unavailable.
function formError(failure) {
  if (FIELD_ERRORS.includes(failure.code)) return { code: failure.code, retryAfter: null };
  if (failure.code === 'rate-limited') return { code: 'rate-limited', retryAfter: failure.retryAfter };
  return { code: 'unavailable', retryAfter: null };
}
function unexpected(machine, state, event) {
  throw new Error(`${machine}: event '${event.type}' is not valid in phase '${state.phase}'`);
}

// ---------------------------------------------------------------------------------------------
// Login with second factor (§4.9, AM2)
// phases: credentials{error} → submitting{step,credentials} → done{user} | second-factor{credentials,error} |
//         pending-approval | back to a form with error {code: rejected|rate-limited|unavailable, retryAfter}
// Login and password are held in the states (memory only) because the second step resubmits them.

export const loginInitial = () => ({ phase: 'credentials', error: null });

export function loginReduce(state, event) {
  switch (event.type) {
    case 'submit':
      if (state.phase === 'credentials') return { phase: 'submitting', step: 'credentials', credentials: event.credentials };
      if (state.phase === 'second-factor') return { phase: 'submitting', step: 'second-factor', credentials: state.credentials };
      break;
    case 'succeeded':
      if (state.phase === 'submitting') return { phase: 'done', user: event.user };
      break;
    case 'failed': {
      if (state.phase !== 'submitting') break;
      const { code, retryAfter } = event.failure;
      if (state.step === 'credentials' && code === 'totp-required') return { phase: 'second-factor', credentials: state.credentials, error: null };
      if (state.step === 'credentials' && code === 'pending-approval') return { phase: 'pending-approval' };
      const error = code === 'unauthorized' ? { code: 'rejected', retryAfter: null }
        : code === 'rate-limited' ? { code, retryAfter } : { code: 'unavailable', retryAfter: null };
      return state.step === 'credentials' ? { phase: 'credentials', error } : { phase: 'second-factor', credentials: state.credentials, error };
    }
    case 'restart':
      if (state.phase !== 'submitting') return loginInitial();
      break;
  }
  return unexpected('login', state, event);
}

// input: { login, password } from the credentials phase, { totp } from the second-factor phase.
export async function submitLogin(client, state, input, emit) {
  const submitting = loginReduce(state, { type: 'submit', credentials: state.phase === 'credentials' ? { login: input.login, password: input.password } : null });
  emit(submitting);
  const totp = submitting.step === 'second-factor' ? input.totp : null;
  const outcome = await attempt(() => client.login({ ...submitting.credentials, totp }));
  const next = loginReduce(submitting, outcome.ok ? { type: 'succeeded', user: outcome.value.user } : { type: 'failed', failure: outcome.failure });
  emit(next);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Signup (§4.9; the secret is generated once per form and survives field errors)
// phases: loading-policy → form{policy,secret,error} → submitting → pending-approval | done{user}
//         | closed | unavailable{error}

export const signupInitial = () => ({ phase: 'loading-policy' });

export function signupReduce(state, event) {
  switch (event.type) {
    case 'policy-loaded':
      if (state.phase !== 'loading-policy') break;
      return event.policy.signup ? { phase: 'form', policy: event.policy, secret: event.secret, error: null } : { phase: 'closed' };
    case 'policy-failed':
      if (state.phase !== 'loading-policy') break;
      return event.failure.code === 'not-found' ? { phase: 'closed' } : { phase: 'unavailable', error: formError(event.failure) };
    case 'submit':
      if (state.phase === 'form') return { phase: 'submitting', policy: state.policy, secret: state.secret };
      break;
    case 'succeeded':
      if (state.phase !== 'submitting') break;
      return event.result.status === STATUS_PENDING ? { phase: 'pending-approval' } : { phase: 'done', user: event.result.user };
    case 'failed':
      if (state.phase !== 'submitting') break;
      if (['forbidden', 'not-found'].includes(event.failure.code)) return { phase: 'closed' };
      return { phase: 'form', policy: state.policy, secret: state.secret, error: formError(event.failure) };
  }
  return unexpected('signup', state, event);
}

// `crypto` provides getRandomValues (the browser's WebCrypto object).
export async function loadSignup(client, crypto, emit) {
  emit(signupInitial());
  const outcome = await attempt(() => client.policy());
  const next = signupReduce(signupInitial(), outcome.ok
    ? { type: 'policy-loaded', policy: outcome.value, secret: outcome.value.signup ? generateTotpSecret(crypto) : null }
    : { type: 'policy-failed', failure: outcome.failure });
  emit(next);
  return next;
}

// values: { username, email, password, totpCode, requireTotp }
export async function submitSignup(client, state, values, emit) {
  const submitting = signupReduce(state, { type: 'submit' });
  emit(submitting);
  const outcome = await attempt(() => client.signup({ ...values, totpSecret: submitting.secret }));
  const next = signupReduce(submitting, outcome.ok ? { type: 'succeeded', result: outcome.value } : { type: 'failed', failure: outcome.failure });
  emit(next);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Enrollment landing (fragment #account-enroll={code})
// phases: inspecting{code} → form{code,username,kind,expiresAt,secret,error} | invalid-link | unavailable{error}
//         form → submitting → done{user} | invalid-link | form with error

export const enrollmentInitial = code => ({ phase: 'inspecting', code });

export function enrollmentReduce(state, event) {
  switch (event.type) {
    case 'inspected':
      if (state.phase !== 'inspecting') break;
      return { phase: 'form', code: state.code, username: event.enrollment.username, kind: event.enrollment.kind, expiresAt: event.enrollment.expiresAt, secret: event.secret, error: null };
    case 'inspect-failed':
      if (state.phase !== 'inspecting') break;
      return ['not-found', 'invalid'].includes(event.failure.code) ? { phase: 'invalid-link' } : { phase: 'unavailable', error: formError(event.failure) };
    case 'submit':
      if (state.phase === 'form') return { phase: 'submitting', code: state.code, username: state.username, kind: state.kind, expiresAt: state.expiresAt, secret: state.secret };
      break;
    case 'succeeded':
      if (state.phase === 'submitting') return { phase: 'done', user: event.user };
      break;
    case 'failed': {
      if (state.phase !== 'submitting') break;
      if (event.failure.code === 'not-found') return { phase: 'invalid-link' };
      const { phase, ...form } = state;
      return { phase: 'form', ...form, error: formError(event.failure) };
    }
  }
  return unexpected('enrollment', state, event);
}

export async function loadEnrollment(client, crypto, code, emit) {
  const initial = enrollmentInitial(code);
  emit(initial);
  const outcome = await attempt(() => client.inspectEnrollment(code));
  const next = enrollmentReduce(initial, outcome.ok
    ? { type: 'inspected', enrollment: outcome.value, secret: generateTotpSecret(crypto) }
    : { type: 'inspect-failed', failure: outcome.failure });
  emit(next);
  return next;
}

// values: { email (invitation) | null (reset), password, totpCode, requireTotp }
export async function submitEnrollment(client, state, values, emit) {
  const submitting = enrollmentReduce(state, { type: 'submit' });
  if ((submitting.kind === 'invite') === (values.email === null)) throw new Error('An invitation requires an e-mail address and a reset forbids one');
  emit(submitting);
  const outcome = await attempt(() => client.redeemEnrollment({ ...values, code: submitting.code, totpSecret: submitting.secret }));
  const next = enrollmentReduce(submitting, outcome.ok ? { type: 'succeeded', user: outcome.value.user } : { type: 'failed', failure: outcome.failure });
  emit(next);
  return next;
}

// Returns the enrollment code of a location hash, or null when the hash is not an enrollment link.
export function parseEnrollmentFragment(hash) {
  return hash.startsWith(ENROLLMENT_FRAGMENT_PREFIX) ? hash.slice(ENROLLMENT_FRAGMENT_PREFIX.length) : null;
}
// Reads the code and removes the fragment from the address bar so the code never stays in the URL or history entry.
export function captureEnrollmentFragment({ location, history }) {
  const code = parseEnrollmentFragment(location.hash);
  if (code !== null) history.replaceState(null, '', location.pathname + location.search);
  return code;
}
export const enrollmentLink = (origin, code) => `${origin}/${ENROLLMENT_FRAGMENT_PREFIX}${code}`;

// ---------------------------------------------------------------------------------------------
// Recovery
// phases: form{error: rejected|weak-password|invalid|rate-limited|unavailable} → submitting → done{user}
// `rejected` is generic by design: it must not distinguish unknown, pending, disabled or wrong code.

export const recoveryInitial = () => ({ phase: 'form', error: null });

export function recoveryReduce(state, event) {
  switch (event.type) {
    case 'submit':
      if (state.phase === 'form') return { phase: 'submitting' };
      break;
    case 'succeeded':
      if (state.phase === 'submitting') return { phase: 'done', user: event.user };
      break;
    case 'failed': {
      if (state.phase !== 'submitting') break;
      const { code, retryAfter } = event.failure;
      const error = code === 'unauthorized' ? { code: 'rejected', retryAfter: null }
        : ['weak-password', 'invalid'].includes(code) ? { code, retryAfter: null }
          : code === 'rate-limited' ? { code, retryAfter } : { code: 'unavailable', retryAfter: null };
      return { phase: 'form', error };
    }
  }
  return unexpected('recovery', state, event);
}

// values: { username, totp, password }
export async function submitRecovery(client, state, values, emit) {
  const submitting = recoveryReduce(state, { type: 'submit' });
  emit(submitting);
  const outcome = await attempt(() => client.recover(values));
  const next = recoveryReduce(submitting, outcome.ok ? { type: 'succeeded', user: outcome.value.user } : { type: 'failed', failure: outcome.failure });
  emit(next);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Resource loading (policy, profile, admin overview)
// phases: loading → ready{data} | absent (404: feature off) | unauthorized | forbidden | unavailable{error}

export const resourceInitial = () => ({ phase: 'loading' });

export function resourceReduce(state, event) {
  if (state.phase !== 'loading') return unexpected('resource', state, event);
  if (event.type === 'loaded') return { phase: 'ready', data: event.data };
  if (event.type !== 'failed') return unexpected('resource', state, event);
  const { code } = event.failure;
  if (code === 'not-found') return { phase: 'absent' };
  if (code === 'unauthorized') return { phase: 'unauthorized' };
  if (code === 'forbidden') return { phase: 'forbidden' };
  return { phase: 'unavailable', error: formError(event.failure) };
}

export async function loadResource(load, emit) {
  const initial = resourceInitial();
  emit(initial);
  const outcome = await attempt(load);
  const next = resourceReduce(initial, outcome.ok ? { type: 'loaded', data: outcome.value } : { type: 'failed', failure: outcome.failure });
  emit(next);
  return next;
}
export const loadAdminOverview = (client, emit) => loadResource(async () => {
  const [users, enrollments] = await Promise.all([client.adminUsers(), client.enrollments()]);
  return { users, enrollments };
}, emit);
export const pendingApplicants = users => users.filter(user => user.status === STATUS_PENDING);

// ---------------------------------------------------------------------------------------------
// What self-service controls can change. Reset removes an explicit choice; only new explicit choices
// need the corresponding opt-in/out flag. A forced state has no self-service controls.
export function indexingControls({ enabled, choice, override, allowOptIn, allowOptOut }) {
  if (override !== 'inherit') return { toggle: null, reset: false };
  return { toggle: enabled ? (allowOptOut ? 'disabled' : null) : (allowOptIn ? 'enabled' : null), reset: choice !== 'inherit' };
}

// Confirmed / proof-protected actions (settings sections and admin list actions)
// phases: <prompt: form | confirm | proof>{action,target,error} → saving → done{result}
//         | owner-changed | unauthorized | back to the prompt with error
// Nothing typed into a prompt is ever placed in a state; `input` exists only for the one request.

export const ACCOUNT_ACTIONS = Object.freeze({
  'change-email': { prompt: 'form', run: (client, owner, target, input) => client.changeEmail(owner, input) },
  'change-password': { prompt: 'form', run: (client, owner, target, input) => client.changePassword(owner, input) },
  'replace-totp': { prompt: 'form', run: (client, owner, target, input) => client.replaceTotp(owner, input) },
  'set-totp-required': { prompt: 'confirm', run: (client, owner, target, input) => client.setTotpRequired(owner, input) },
  'set-indexing': { prompt: 'confirm', run: (client, owner, _target, input, actor) => client.setIndexing(owner, actor, input) },
  'set-indexing-override': { prompt: 'proof', run: (client, _owner, target, input, actor) => client.setIndexingOverride(actor, target, input) },
  'approve-user': { prompt: 'confirm', run: (client, owner, target) => client.approveUser(owner, target) },
  'reject-user': { prompt: 'confirm', run: (client, owner, target) => client.rejectUser(owner, target) },
  'set-user-enabled': { prompt: 'confirm', run: (client, owner, target, input) => client.setUserEnabled(owner, target, input) },
  'set-user-admin': { prompt: 'proof', run: (client, owner, target, input) => client.setUserAdmin(owner, target, input) },
  'reset-user': { prompt: 'proof', run: (client, owner, target, input) => client.resetUser(owner, target, input) },
  'issue-invitation': { prompt: 'form', run: (client, owner, target, input) => client.issueEnrollment(owner, input) },
  'revoke-enrollment': { prompt: 'confirm', run: (client, owner, target) => client.revokeEnrollment(owner, target) }
});

function actionDescriptor(name) {
  const descriptor = ACCOUNT_ACTIONS[name];
  if (descriptor === undefined) throw new Error(`Unknown account action '${name}'`);
  return descriptor;
}
// `target` is the id of the user or enrollment the action applies to, null for self-service and invitations.
export const actionStart = (action, target) => ({ phase: actionDescriptor(action).prompt, action, target, error: null });

export function actionReduce(state, event) {
  const prompting = ['form', 'confirm', 'proof'].includes(state.phase);
  switch (event.type) {
    case 'submit':
      if (prompting) return { phase: 'saving', action: state.action, target: state.target };
      break;
    case 'succeeded':
      if (state.phase === 'saving') return { phase: 'done', action: state.action, target: state.target, result: event.result };
      break;
    case 'failed': {
      if (state.phase !== 'saving') break;
      const { code } = event.failure;
      if (code === 'owner-changed') return { phase: 'owner-changed' };
      if (code === 'unauthorized') return { phase: 'unauthorized' };
      const error = ['proof-rejected', 'rate-limited', 'forbidden', 'not-found'].includes(code) ? { code, retryAfter: event.failure.retryAfter } : formError(event.failure);
      return { phase: actionDescriptor(state.action).prompt, action: state.action, target: state.target, error };
    }
    case 'cancel':
      if (prompting) return { phase: 'cancelled' };
      break;
  }
  return unexpected('action', state, event);
}

// `owner` is the id the dialog was opened for; a mismatch ends in 'owner-changed'. Indexing takes
// the actor from the sequencer's preflight; the existing actions obtain it from the fresh /profile.
export async function runAction(client, state, owner, input, emit, actor) {
  const saving = actionReduce(state, { type: 'submit' });
  emit(saving);
  const outcome = await attempt(() => actionDescriptor(saving.action).run(client, owner, saving.target, input, actor));
  const next = actionReduce(saving, outcome.ok ? { type: 'succeeded', result: outcome.value } : { type: 'failed', failure: outcome.failure });
  emit(next);
  return next;
}

// ---------------------------------------------------------------------------------------------
// Base32 (RFC 4648, upper-case alphabet, no padding — the canonical form the server accepts) and TOTP

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BITS_PER_BASE32_CHAR = 5;
const BITS_PER_BYTE = 8;

export function base32Encode(bytes) {
  let text = '', buffer = 0, bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << BITS_PER_BYTE) | byte; bits += BITS_PER_BYTE;
    while (bits >= BITS_PER_BASE32_CHAR) { bits -= BITS_PER_BASE32_CHAR; text += BASE32_ALPHABET[(buffer >>> bits) & 31]; }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) text += BASE32_ALPHABET[(buffer << (BITS_PER_BASE32_CHAR - bits)) & 31];
  return text;
}

// Rejects padding, lower case, foreign characters and non-canonical lengths or trailing bits.
export function base32Decode(text) {
  const bytes = [];
  let buffer = 0, bits = 0;
  for (const char of text) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) throw new Error('Invalid base32 character');
    buffer = (buffer << BITS_PER_BASE32_CHAR) | value; bits += BITS_PER_BASE32_CHAR;
    if (bits >= BITS_PER_BYTE) { bits -= BITS_PER_BYTE; bytes.push((buffer >>> bits) & 255); }
    buffer &= (1 << bits) - 1;
  }
  if (bits >= BITS_PER_BASE32_CHAR || buffer !== 0) throw new Error('Non-canonical base32 text');
  return Uint8Array.from(bytes);
}

export function generateTotpSecret(crypto) {
  const bytes = new Uint8Array(TOTP_PARAMETERS.secretBytes);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

const URI_UNRESERVED_EXTRA = /[!'()*]/g;
const encodeUriPart = text => encodeURIComponent(text).replace(URI_UNRESERVED_EXTRA, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

// Provisioning URI of design §4.2.1; `secret` is the 32-character base32 text.
export function otpauthUri({ issuer, username, secret }) {
  if (base32Decode(secret).length !== TOTP_PARAMETERS.secretBytes) throw new Error('A TOTP secret must be 20 bytes');
  const { algorithm, digits, period } = TOTP_PARAMETERS;
  return `otpauth://totp/${encodeUriPart(issuer)}:${encodeUriPart(username)}?secret=${secret}&issuer=${encodeUriPart(issuer)}&algorithm=${algorithm}&digits=${digits}&period=${period}`;
}

// ---------------------------------------------------------------------------------------------
// QR code: byte mode, error-correction level M, versions 1-40 (up to 2331 bytes)

const QR_MAX_VERSION = 40;
// Indexed by version (index 0 unused), error-correction level M.
const QR_ECC_CODEWORDS_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const QR_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const QR_VERSION_32 = 32;
const QR_BYTE_MODE = 0b0100;
const QR_MODE_BITS = 4;
const QR_PAD_BYTES = [0xec, 0x11];
const QR_FORMAT_POLY = 0x537;
const QR_FORMAT_MASK = 0x5412;
const QR_VERSION_POLY = 0x1f25;
const QR_MASKS = 8;
const GF256_POLY = 0x11d;
const PENALTY_RUN = 3, PENALTY_BLOCK = 3, PENALTY_FINDER = 40, PENALTY_BALANCE = 10, MIN_RUN = 5, BALANCE_STEP_PERCENT = 5;

function qrAlignmentCenters(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2, size = 17 + 4 * version;
  const step = version === QR_VERSION_32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const centers = [6];
  for (let center = size - 7, i = 1; i < count; i++, center -= step) centers.splice(1, 0, center);
  return centers;
}
const qrCountBits = version => (version <= 9 ? 8 : 16);
function qrRawCodewords(version) {
  let modules = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const centers = Math.floor(version / 7) + 2;
    modules -= (25 * centers - 10) * centers - 55;
    if (version >= 7) modules -= 36;
  }
  return Math.floor(modules / 8);
}
const qrDataCodewords = version => qrRawCodewords(version) - QR_ECC_CODEWORDS_PER_BLOCK[version] * QR_BLOCKS[version];

function gfMultiply(x, y) {
  let product = 0;
  for (let bit = 7; bit >= 0; bit--) { product = (product << 1) ^ ((product >>> 7) * GF256_POLY); product ^= ((y >>> bit) & 1) * x; }
  return product;
}
function rsDivisor(degree) {
  const result = new Array(degree).fill(0); result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { result[j] = gfMultiply(result[j], root); if (j + 1 < degree) result[j] ^= result[j + 1]; }
    root = gfMultiply(root, 2);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift(); result.push(0);
    divisor.forEach((coefficient, i) => { result[i] ^= gfMultiply(coefficient, factor); });
  }
  return result;
}
function bchRemainder(value, poly, degree) {
  let remainder = value;
  for (let i = 0; i < degree; i++) remainder = (remainder << 1) ^ ((remainder >>> (degree - 1)) * poly);
  return remainder;
}

// Data and error-correction codewords, split into blocks and interleaved.
function qrCodewords(bytes, version) {
  const capacity = qrDataCodewords(version);
  const bits = [];
  const push = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(QR_BYTE_MODE, QR_MODE_BITS); push(bytes.length, qrCountBits(version));
  for (const byte of bytes) push(byte, BITS_PER_BYTE);
  push(0, Math.min(4, capacity * BITS_PER_BYTE - bits.length));
  push(0, (BITS_PER_BYTE - bits.length % BITS_PER_BYTE) % BITS_PER_BYTE);
  const data = [];
  for (let i = 0; i < bits.length; i += BITS_PER_BYTE) data.push(parseInt(bits.slice(i, i + BITS_PER_BYTE).join(''), 2));
  for (let i = 0; data.length < capacity; i++) data.push(QR_PAD_BYTES[i % 2]);
  const blockCount = QR_BLOCKS[version], eccLength = QR_ECC_CODEWORDS_PER_BLOCK[version], raw = qrRawCodewords(version);
  const shortBlocks = blockCount - raw % blockCount, shortLength = Math.floor(raw / blockCount);
  const divisor = rsDivisor(eccLength), blocks = [];
  for (let i = 0, offset = 0; i < blockCount; i++) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const block = data.slice(offset, offset + length); offset += length;
    blocks.push({ data: block, ecc: rsRemainder(block, divisor) });
  }
  const result = [];
  for (let i = 0; i <= shortLength - eccLength; i++) for (const block of blocks) if (i < block.data.length) result.push(block.data[i]);
  for (let i = 0; i < eccLength; i++) for (const block of blocks) result.push(block.ecc[i]);
  return result;
}

function maskApplies(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return x * y % 2 + x * y % 3 === 0;
    case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
    default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
  }
}

// 1:1:3:1:1 finder-like patterns (of any module width) with a light run of four widths on a side or at a line end.
function finderPenalty(line) {
  const runs = [];
  let dark = false, length = 0;
  for (const module of line) { if (module === dark) length++; else { runs.push(length); dark = module; length = 1; } }
  runs.push(length);
  let score = 0;
  for (let i = 3; i < runs.length - 2; i += 2) {
    if (runs[i] % 3 !== 0) continue;
    const unit = runs[i] / 3;
    if (runs[i - 2] === unit && runs[i - 1] === unit && runs[i + 1] === unit && runs[i + 2] === unit
      && (i === 3 || runs[i - 3] >= 4 * unit || i + 4 >= runs.length || runs[i + 3] >= 4 * unit)) score += PENALTY_FINDER;
  }
  return score;
}
function penalty(modules) {
  const size = modules.length;
  let score = 0, dark = 0;
  for (let i = 0; i < size; i++) {
    for (const line of [modules[i], modules.map(row => row[i])]) {
      let run = 1;
      for (let j = 1; j <= size; j++) {
        if (j < size && line[j] === line[j - 1]) run++;
        else { if (run >= MIN_RUN) score += PENALTY_RUN + run - MIN_RUN; run = 1; }
      }
      score += finderPenalty(line);
    }
  }
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
    const module = modules[y][x];
    if (module === modules[y][x + 1] && module === modules[y + 1][x] && module === modules[y + 1][x + 1]) score += PENALTY_BLOCK;
  }
  for (const row of modules) for (const module of row) if (module) dark++;
  const total = size * size, percent = Math.floor(Math.floor((200 * dark + total) / total) / 2);
  return score + Math.floor(Math.abs(percent - 50) / BALANCE_STEP_PERCENT) * PENALTY_BALANCE;
}

function writeFormat(modules, size, mask) {
  const bits = ((mask << 10) | bchRemainder(mask, QR_FORMAT_POLY, 10)) ^ QR_FORMAT_MASK; // error-correction level M has indicator 00
  const set = (x, y, index) => { modules[y][x] = ((bits >>> index) & 1) === 1; };
  for (let i = 0; i <= 5; i++) set(8, i, i);
  set(8, 7, 6); set(8, 8, 7); set(7, 8, 8);
  for (let i = 9; i < 15; i++) set(14 - i, 8, i);
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
  modules[size - 8][8] = true;
}

// Returns the module matrix (rows of booleans, true = dark) without quiet zone.
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= QR_MAX_VERSION && qrDataCodewords(version) * BITS_PER_BYTE < QR_MODE_BITS + qrCountBits(version) + bytes.length * BITS_PER_BYTE) version++;
  if (version > QR_MAX_VERSION) throw new Error('QR payload exceeds the supported size');
  const size = 17 + 4 * version;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; reserved[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
    }
  }
  const centers = qrAlignmentCenters(version), last = centers.length - 1;
  centers.forEach((cx, i) => centers.forEach((cy, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if ((x < 9 && y < 9) || (x >= size - 8 && y < 9) || (x < 9 && y >= size - 8)) reserved[y][x] = true; // format areas
  if (version >= 7) {
    const bits = (version << 12) | bchRemainder(version, QR_VERSION_POLY, 12);
    for (let i = 0; i < 18; i++) { const dark = ((bits >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); }
  }
  const codewords = qrCodewords(bytes, version);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
      if (!reserved[y][x] && index < codewords.length * BITS_PER_BYTE) { modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1; index++; }
    }
  }
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < QR_MASKS; mask++) {
    const candidate = modules.map(row => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!reserved[y][x] && maskApplies(mask, x, y)) candidate[y][x] = !candidate[y][x];
    writeFormat(candidate, size, mask);
    const score = penalty(candidate);
    if (score < bestScore) { best = candidate; bestScore = score; }
  }
  return best;
}
