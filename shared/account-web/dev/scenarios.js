// Harness scenarios: one per mockup state of the account surfaces (mockups account-*.html), named
// <surface>-<state> so that captures match the mockup shots (account-<surface>-<state>-<width>.png).
// `fixture(f)` adjusts the fake server, `hash` is the initial fragment, `steps(d)` drives the real views
// into the state through the DOM (skipped with ?steps=0), `ready` is the CSS selector that marks the state.
import { FAKE_ENROLLMENT_CODE, FAKE_PASSWORD, FAKE_TAKEN_USERNAME, FAKE_WRONG_CODE } from './fake-server.js';

const signedOut = f => { f.signedIn = false; };
const LOGIN = 'form[data-account-login]';
async function signIn(d, login) { await d.fill('Username', login); await d.fill('Password', FAKE_PASSWORD); await d.click('Sign in'); }
async function signupValues(d, username, password, code) {
  await d.fill('Username', username); await d.fill('E-mail', `${username}@example.org`); await d.fill('Password', password);
  await d.fill('Enter the 6-digit code the app shows', code);
}
async function newToken(d, name) { await d.click('New token'); await d.fill('Name', name); }
async function mintToken(d) { await newToken(d, 'laptop-cli'); await d.click('Create token'); await d.wait('[data-account-secret]'); }
async function userMenu(d, item) { await d.wait('tr[data-row-id="erin"]'); await d.click('Actions for erin'); await d.click(item); }

const scenario = (surface, state, spec) => [`${surface}-${state}`, { signedIn: true, hash: '', fixture: () => {}, steps: async () => {}, ...spec }];
const auth = (state, spec) => scenario('login', state, { signedIn: false, ready: LOGIN, ...spec, fixture: f => { signedOut(f); (spec.fixture ?? (() => {}))(f); } });
const signup = (state, spec) => scenario('signup', state, { signedIn: false, hash: '#account/signup', ...spec, fixture: f => { signedOut(f); (spec.fixture ?? (() => {}))(f); } });
const recover = (state, spec) => scenario('recover', state, { signedIn: false, hash: '#account/recover', ready: '[data-view="recover"]', ...spec, fixture: f => { signedOut(f); (spec.fixture ?? (() => {}))(f); } });
const settings = (state, spec) => scenario('settings', state, spec);
const users = (state, spec) => scenario('users', state, { hash: '#account/users', ready: 'tr[data-row-id="erin"]', ...spec });
const TOKENS = '#account/tokens', TOKEN_ROWS = 'table[data-list="tokens"] tr[data-row-id]';
// User-supplied strings without a break opportunity: the longest token name the form accepts, logins and e-mails.
export const LONG_TOKEN_NAME = 'W'.repeat(120);
export const longLogin = id => `${id}${'w'.repeat(60)}`;
const longEmail = id => `${longLogin(id)}@${'e'.repeat(40)}.example.org`;
function longStrings(f) {
  for (const user of [f.user, ...f.users]) { user.login = longLogin(user.id); if (user.email !== null) user.email = longEmail(user.id); }
  f.profile.email = longEmail(f.user.id);
  for (const enrollment of f.enrollments) if (enrollment.kind === 'invite') enrollment.username = longLogin(enrollment.username);
  f.tokens[2].name = LONG_TOKEN_NAME;
  f.tokens[6].name = 'R'.repeat(120);
}

export const SCENARIOS = new Map([
  auth('default', {}),
  auth('error', { fixture: f => { f.login = 'rejected'; }, steps: d => signIn(d, 'alice'), ready: '[data-account-login-error]:not([hidden])' }),
  auth('pending', { fixture: f => { f.login = 'pending'; }, steps: d => signIn(d, 'bob'), ready: '[data-account-login-error]:not([hidden])' }),
  auth('totp', { fixture: f => { f.login = 'totp'; }, steps: d => signIn(d, 'alice'), ready: 'form[data-account-login-totp]' }),
  auth('totp-error', { fixture: f => { f.login = 'totp'; }, steps: async d => { await signIn(d, 'alice'); await d.fill('6-digit code', FAKE_WRONG_CODE); await d.click('Verify and sign in'); }, ready: 'form[data-account-login-totp] [aria-invalid="true"]' }),
  auth('rate-limited', { fixture: f => { f.login = 'rate-limited'; }, steps: d => signIn(d, 'alice'), ready: '[data-account-login-error]:not([hidden])' }),
  auth('signup-off', { fixture: f => { f.policy.signup = false; }, ready: `${LOGIN} .auth-foot:not([hidden])` }),
  auth('legacy', { fixture: f => { f.policy = null; f.profile = null; } }),
  signup('default', { steps: d => signupValues(d, 'bob', 'hunter2hunter2', '731905'), ready: '[data-view="signup"] [data-account-qr] i' }),
  signup('errors', { steps: async d => { await signupValues(d, FAKE_TAKEN_USERNAME, 'hunter2hunter2', '731905'); await d.click('Create account'); }, ready: '[data-view="signup"] [aria-invalid="true"]' }),
  signup('pending', { steps: async d => { await signupValues(d, 'bob', 'hunter2hunter2', '731905'); await d.click('Create account'); }, ready: '[data-view="signup-pending"]' }),
  signup('closed', { fixture: f => { f.policy.signup = false; }, ready: '[data-view="auth-status"]' }),
  signup('enroll', { hash: `#account-enroll=${FAKE_ENROLLMENT_CODE}`, ready: '[data-view="enrollment"]' }),
  signup('enroll-reset', { hash: `#account-enroll=${FAKE_ENROLLMENT_CODE}`, fixture: f => { f.enrollment = { ...f.enrollment, username: 'bob', kind: 'reset' }; }, ready: '[data-view="enrollment"]' }),
  signup('enroll-invalid', { hash: '#account-enroll=expired-or-used-code', ready: '[data-view="auth-status"]' }),
  recover('default', { steps: async d => { await d.fill('Username', 'alice'); await d.fill('Authenticator code', '204817'); await d.fill('New password', 'a-new-long-password'); } }),
  recover('rejected', { fixture: f => { f.recover = 'rejected'; }, steps: async d => { await d.fill('Username', 'alice'); await d.fill('Authenticator code', '204817'); await d.fill('New password', 'a-new-long-password'); await d.click('Set new password and sign in'); }, ready: '[data-view="recover"] .notice' }),
  recover('weak', { fixture: f => { f.recover = 'weak'; }, steps: async d => { await d.fill('Username', 'alice'); await d.fill('Authenticator code', '204817'); await d.fill('New password', 'short'); await d.click('Set new password and sign in'); }, ready: '[data-view="recover"] [aria-invalid="true"]' }),
  recover('rate-limited', { fixture: f => { f.recover = 'rate-limited'; }, steps: async d => { await d.fill('Username', 'alice'); await d.fill('Authenticator code', '204817'); await d.fill('New password', 'a-new-long-password'); await d.click('Set new password and sign in'); }, ready: '[data-view="recover"] .notice' }),
  settings('profile', { hash: '#account/profile', ready: '[data-view="profile"]' }),
  settings('declarative', { hash: '#account/profile', fixture: f => { Object.assign(f.profile, { source: 'declarative', email: null, totp: { required: false, state: 'none' }, manage: { email: false, password: false, totp: false, users: true, enrollment: true, reset: true } }); }, ready: '[data-view="profile"]' }),
  settings('password', { hash: '#account/password', ready: '[data-view="password"]' }),
  settings('totp', { hash: '#account/two-factor', ready: '[data-view="two-factor"]' }),
  settings('totp-replace', { hash: '#account/two-factor', steps: d => d.click('Replace authenticator…'), ready: '[data-account-totp-replace] [data-account-qr] i' }),
  settings('totp-toggle', { hash: '#account/two-factor', steps: d => d.click('Require a code at every sign-in'), ready: 'dialog[open]' }),
  settings('tokens', { hash: TOKENS, ready: TOKEN_ROWS }),
  settings('tokens-new', { hash: TOKENS, steps: d => newToken(d, 'laptop-cli'), ready: '[data-account-token-form]' }),
  settings('tokens-invalid', { hash: TOKENS, steps: async d => { await newToken(d, '   '); await d.click('Create token'); }, ready: '[data-account-token-form] [aria-invalid="true"]' }),
  settings('tokens-secret', { hash: TOKENS, steps: mintToken, ready: '[data-account-secret]' }),
  settings('tokens-copied', { hash: TOKENS, steps: async d => { await mintToken(d); await d.click('Reveal'); await d.click('Copy secret'); }, ready: '[data-account-secret] .chip-ok' }),
  settings('tokens-leave', { hash: TOKENS, steps: async d => { await mintToken(d); await d.click('Reveal'); await d.click('I have saved it'); }, ready: 'dialog[open]' }),
  settings('tokens-unverified', { hash: TOKENS, steps: async d => { await mintToken(d); d.fake.state.account = 'down'; document.dispatchEvent(new Event('account:invalidate')); }, ready: '[data-account-unverified]' }),
  settings('tokens-revoke', { hash: TOKENS, steps: async d => { await d.wait(TOKEN_ROWS); await d.click('Revoke ci-collector-02'); }, ready: 'dialog[open]' }),
  settings('tokens-long', { hash: TOKENS, fixture: f => { for (let k = 1; k <= 26; k++) f.tokens.push({ ...f.tokens[2], id: `00000000-0000-4000-8000-${String(300040 + k).padStart(12, '0')}`, name: `laptop-cli-${k}`, scopes: f.app === 'chronicle' ? (k % 3 ? ['Ingest'] : ['Read', 'Raw']) : ['api'] }); }, ready: TOKEN_ROWS }),
  settings('tokens-uncertain', { hash: TOKENS, fixture: f => { f.mint = 'lost'; }, steps: async d => { await newToken(d, 'lost-reply-token'); await d.click('Create token'); }, ready: '[data-account-uncertain]' }),
  settings('tokens-loading', { hash: TOKENS, fixture: f => { f.account = 'loading'; }, ready: '[data-view="tokens"] .skeleton' }),
  settings('tokens-error', { hash: TOKENS, fixture: f => { f.account = 'error'; }, ready: '[data-view="tokens"] .notice-danger' }),
  settings('tokens-empty', { hash: TOKENS, fixture: f => { f.tokens = []; }, ready: '[data-view="tokens"] .empty:not([hidden])' }),
  settings('legacy', { hash: TOKENS, fixture: f => { f.policy = null; f.profile = null; }, ready: TOKEN_ROWS }),
  settings('tokens-long-strings', { hash: TOKENS, fixture: longStrings, steps: async d => { await d.wait(TOKEN_ROWS); await d.click('Show'); await newToken(d, LONG_TOKEN_NAME); await d.click('Create token'); }, ready: '[data-account-secret]' }),
  users('default', {}),
  users('pending', { steps: d => d.click('Pending approval'), ready: 'tr[data-row-id="bob"]' }),
  users('menu', { steps: async d => { await d.wait('tr[data-row-id="erin"]'); await d.click('Actions for erin'); }, ready: '[role="menu"]:not([hidden])' }),
  users('approve', { steps: async d => { await d.wait('tr[data-row-id="bob"]'); await d.click('Approve bob…'); }, ready: 'dialog[open]' }),
  users('reject', { steps: async d => { await d.wait('tr[data-row-id="bob"]'); await d.click('Approve bob…'); await d.click('Reject application…'); }, ready: 'dialog[open]' }),
  users('enroll', { steps: async d => { await d.click('Enroll user'); await d.fill('Username', 'carol'); }, ready: '[data-account-enroll-form]' }),
  users('enroll-link', { steps: async d => { await d.click('Enroll user'); await d.fill('Username', 'carol'); await d.click('Create invitation link'); }, ready: '[data-account-link]' }),
  users('disable', { steps: d => userMenu(d, 'Disable account…'), ready: 'dialog[open]' }),
  users('grant-admin', { steps: d => userMenu(d, 'Grant admin…'), ready: 'dialog[open]' }),
  users('reset', { steps: d => userMenu(d, 'Reset credentials…'), ready: 'dialog[open]' }),
  users('reset-link', { steps: async d => { await userMenu(d, 'Reset credentials…'); await d.fill('Your current password', FAKE_PASSWORD); await d.click('Create reset link'); }, ready: '[data-account-link]' }),
  users('long-strings', { fixture: longStrings, steps: async d => { await d.wait('tr[data-row-id="bob"]'); await d.click(`Approve ${longLogin('bob')}…`); }, ready: 'dialog[open]' }),
  users('signup-only', { fixture: f => { f.profile.manage.enrollment = false; f.policy.enrollment = false; }, steps: async d => { await d.wait('tr[data-row-id="erin"]'); await d.click('Actions for erin'); }, ready: '[role="menu"]:not([hidden])' })
]);
