// Account v1 is deliberately independent of each application's domain protocol.
export function installAccountUI({ document, window, fetch }) {
  const API = '/api/account/v1';
  const REQUEST_TIMEOUT_MS = 15_000;
  const uncertainMints = new Map();
  const loginRequests = new WeakSet();
  let current = null;

  class AccountError extends Error {
    constructor(status) { super('Account request failed'); this.status = status; }
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== null) element.textContent = text;
    if (className !== null) element.className = className;
    return element;
  }
  function button(text, action) {
    const element = node('button', text, null); element.type = 'button'; element.addEventListener('click', action); return element;
  }
  function message(cause, login) {
    if (cause instanceof AccountError && cause.status === 401) return login ? 'Invalid login or password. Try again.' : 'Your browser session is no longer authorized. Sign in again.';
    if (cause instanceof AccountError && cause.status === 403) return 'This action is not permitted for the current account. Refresh settings before trying again.';
    if (cause instanceof AccountError && cause.status >= 400 && cause.status < 500) return 'The account request was rejected. Check your input and refresh settings before trying again.';
    return 'The account service is unavailable or returned an invalid response. Your credentials have not been rejected. Retry when the service is available.';
  }
  async function request(path, method, body, controllers) {
    const controller = new window.AbortController(); controllers.add(controller);
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const options = { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } };
      if (body !== null) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
      const response = await fetch(API + path, options);
      if (!response.ok) throw new AccountError(response.status);
      return await response.json();
    } finally { window.clearTimeout(timeout); controllers.delete(controller); }
  }
  function validUser(user) {
    return user !== null && typeof user === 'object' && typeof user.id === 'string' && user.id.length > 0 && typeof user.login === 'string' && typeof user.displayName === 'string';
  }
  function validToken(token) {
    return token !== null && typeof token === 'object' && typeof token.id === 'string' && token.id.length > 0 && typeof token.name === 'string' && ['configured', 'issued'].includes(token.source) && (token.createdAt === null || typeof token.createdAt === 'string') && typeof token.revoked === 'boolean' && Array.isArray(token.scopes) && token.scopes.every(scope => typeof scope === 'string');
  }
  function validAccount(account) {
    return account !== null && typeof account === 'object' && validUser(account.user) && Array.isArray(account.tokens) && account.tokens.every(validToken) && Array.isArray(account.scopes) && account.scopes.length > 0 && account.scopes.every(scope => ['api', 'Ingest', 'Read', 'Raw'].includes(scope)) && new Set(account.scopes).size === account.scopes.length;
  }
  function active(view) {
    return current === view && view.dialog.isConnected && view.trigger.isConnected && view.trigger.dataset.accountUserId === view.owner;
  }
  function clearSecret(view) {
    if (view.secret !== null) { view.secret.querySelector('input').value = ''; view.secret.remove(); view.secret = null; }
  }
  function close() {
    if (current === null) return;
    const view = current; current = null;
    for (const controller of view.controllers) controller.abort();
    clearSecret(view); view.dialog.close(); view.dialog.remove();
    if (view.trigger.isConnected && view.trigger.dataset.accountUserId === view.owner) view.trigger.focus();
  }
  function setBusy(view, busy) {
    view.busy = busy; view.dialog.setAttribute('aria-busy', String(busy));
    for (const element of view.content.querySelectorAll('input, button')) element.disabled = busy;
    if (view.create !== null) view.create.disabled = busy || view.secret !== null || uncertainMints.has(view.owner) || view.permissions.length === 0;
    if (view.acknowledge !== null) view.acknowledge.disabled = busy || !uncertainMints.get(view.owner).reconciled;
  }
  function showError(view, cause) {
    view.error.textContent = message(cause, false); view.error.hidden = false;
  }
  async function readAccount(view) {
    if (!active(view)) return null;
    const account = await request('', 'GET', null, view.controllers);
    if (!validAccount(account)) throw new Error('Invalid account response');
    if (!active(view)) return null;
    if (account.user.id !== view.owner) {
      close(); document.dispatchEvent(new window.Event('account:changed')); return null;
    }
    return account;
  }
  function renderTokens(view, account) {
    view.tokens.replaceChildren();
    if (account.tokens.length === 0) view.tokens.append(node('p', 'No access tokens.', null));
    for (const token of account.tokens) {
      const row = node('li', null, 'account-token');
      const heading = node('div', null, 'account-token-heading'); heading.append(node('strong', token.name, null));
      heading.append(node('span', token.source === 'configured' ? 'Configured' : 'Issued', 'account-badge')); row.append(heading);
      row.append(node('p', token.scopes.join(' / '), 'account-token-meta'), node('code', token.id, 'account-token-id'));
      if (token.createdAt !== null) {
        const date = new Date(token.createdAt);
        row.append(node('p', `Created ${Number.isNaN(date.getTime()) ? 'date unavailable' : date.toLocaleString()}`, 'account-token-meta'));
      }
      if (token.source === 'configured') row.append(node('p', 'Managed in server configuration; read-only here.', 'account-token-meta'));
      if (token.revoked) row.append(node('span', 'Revoked', 'account-badge'));
      else if (token.source === 'issued') {
        const revoke = button('Revoke', () => void revokeToken(view, token)); revoke.setAttribute('aria-label', `Revoke ${token.name}`); row.append(revoke);
      }
      view.tokens.append(row);
    }
  }
  function renderUncertainty(view) {
    view.uncertain.replaceChildren(); view.acknowledge = null;
    const pending = uncertainMints.get(view.owner);
    if (pending === undefined) return;
    const warning = node('p', `Creation outcome is unknown for “${pending.name}”. Do not blindly create it again. Refresh the token list and check for an issued token. A lost one-time secret cannot be recovered: revoke that token before creating a replacement.`, null);
    warning.setAttribute('role', 'alert');
    const acknowledge = button('I checked the list; allow another token', () => {
      if (!active(view) || view.busy || !pending.reconciled) return;
      uncertainMints.delete(view.owner); renderUncertainty(view); setBusy(view, false);
    });
    view.acknowledge = acknowledge; view.uncertain.append(warning, acknowledge);
  }
  async function refreshTokens(view) {
    if (!active(view) || view.busy) return;
    setBusy(view, true); view.error.hidden = true; view.status.textContent = 'Refreshing access tokens…';
    try {
      const account = await readAccount(view); if (account === null) return;
      renderTokens(view, account);
      const pending = uncertainMints.get(view.owner);
      if (pending !== undefined) { pending.reconciled = true; renderUncertainty(view); }
      view.status.textContent = 'Token list refreshed. Check issued tokens before creating another token.';
    } catch (cause) { if (active(view)) { showError(view, cause); view.status.textContent = ''; } }
    finally { if (active(view)) setBusy(view, false); }
  }
  async function revokeToken(view, token) {
    if (!active(view) || view.busy || !window.confirm(`Revoke access token “${token.name}”? Clients using it will lose access.`)) return;
    setBusy(view, true); view.error.hidden = true; view.status.textContent = 'Revoking access token…';
    let sent = false;
    try {
      if (await readAccount(view) === null) return;
      sent = true;
      const result = await request(`/tokens/${encodeURIComponent(token.id)}/revoke`, 'POST', {}, view.controllers);
      if (result === null || result.ok !== true) throw new Error('Invalid revocation response');
      const account = await readAccount(view); if (account === null) return;
      renderTokens(view, account); view.status.textContent = 'Access token revoked.';
    } catch (cause) {
      if (active(view)) {
        showError(view, cause);
        view.status.textContent = sent ? 'Revocation could not be confirmed. Refresh the token list before retrying.' : '';
      }
    } finally { if (active(view)) setBusy(view, false); }
  }
  function showSecret(view, secret) {
    clearSecret(view);
    const panel = node('section', null, 'account-secret'); panel.setAttribute('aria-label', 'One-time secret');
    panel.append(node('h3', 'Save your token now', null), node('p', 'Shown once. Store this secret securely outside the browser. Closing settings or dismissing it clears it from this page; it cannot be retrieved again.', null));
    const label = node('label', 'One-time token secret', null), input = node('input', null, null);
    input.type = 'text'; input.readOnly = true; input.autocomplete = 'off'; input.spellcheck = false; input.value = secret; label.append(input);
    const status = node('p', '', null); status.setAttribute('role', 'status');
    const copy = button('Copy secret', async () => {
      if (!active(view) || view.secret !== panel) return;
      try {
        if (!window.navigator.clipboard || typeof window.navigator.clipboard.writeText !== 'function') throw new Error('Clipboard unavailable');
        await window.navigator.clipboard.writeText(input.value);
        if (active(view) && view.secret === panel) status.textContent = 'Secret copied. Store it securely outside the browser.';
      } catch {
        if (active(view) && view.secret === panel) { status.textContent = 'Clipboard unavailable. Select and copy the displayed secret manually.'; input.focus(); input.select(); }
      }
    });
    const dismiss = button('Dismiss secret', () => { clearSecret(view); setBusy(view, false); view.create.focus(); });
    const actions = node('div', null, 'account-actions'); actions.append(copy, dismiss);
    panel.append(label, actions, status); view.secret = panel; view.secretSlot.append(panel); input.focus(); input.select();
  }
  async function issueToken(view, form) {
    if (!active(view) || view.busy || view.secret !== null || uncertainMints.has(view.owner) || view.permissions.length === 0) return;
    const name = form.elements.namedItem('name').value.trim();
    if (name.length === 0) { form.elements.namedItem('name').focus(); return; }
    const scopes = [...view.permissions];
    setBusy(view, true); view.error.hidden = true; view.status.textContent = 'Creating access token…';
    let sent = false, creationAnswered = false;
    try {
      if (await readAccount(view) === null) return;
      // Record before sending: dismissal, cancellation and lost replies are uncertain,
      // not permission to replay a non-idempotent token creation request.
      uncertainMints.set(view.owner, { name, reconciled: false }); sent = true;
      const result = await request('/tokens', 'POST', { name, scopes }, view.controllers);
      creationAnswered = true;
      if (result === null || typeof result.secret !== 'string' || result.secret.length === 0 || !validToken(result.token) || result.token.source !== 'issued') throw new Error('Invalid issued token response');
      const account = await readAccount(view); if (account === null) return;
      if (!account.tokens.some(token => token.id === result.token.id && !token.revoked && token.source === 'issued')) throw new Error('Issued token not in current account');
      renderTokens(view, account); showSecret(view, result.secret); uncertainMints.delete(view.owner);
      renderUncertainty(view); form.elements.namedItem('name').value = ''; view.status.textContent = 'Access token created. Save its one-time secret now.';
    } catch (cause) {
      if (!creationAnswered && cause instanceof AccountError && cause.status >= 400 && cause.status < 500) uncertainMints.delete(view.owner);
      if (active(view)) {
        showError(view, cause);
        if (sent && uncertainMints.has(view.owner)) { renderUncertainty(view); view.status.textContent = 'No creation request will be retried automatically.'; }
        else view.status.textContent = '';
      }
    } finally { if (active(view)) setBusy(view, false); }
  }
  function renderAccount(view, account) {
    view.content.replaceChildren(); view.error.hidden = true;
    view.content.append(node('p', `Signed in as ${account.user.displayName}`, 'account-user'));
    view.secretSlot = node('div', null, null); view.uncertain = node('div', null, 'account-uncertain');
    view.content.append(view.secretSlot, node('h3', 'Access tokens', null), node('p', 'Access tokens authorize API clients. Signing out ends this browser session without revoking your access tokens.', null));
    const form = node('form', null, 'account-token-form');
    const label = node('label', 'Token name', null), name = node('input', null, null);
    name.name = 'name'; name.required = true; name.maxLength = 120; name.autocomplete = 'off'; label.append(name); form.append(label);
    const supported = account.scopes;
    view.permissions = supported.includes('api') ? ['api'] : [supported.includes('Ingest') ? 'Ingest' : supported[0]];
    if (supported.includes('api')) form.append(node('p', 'Full API access (api). Keep access tokens private.', 'account-token-meta'));
    else {
      const permissions = node('fieldset', null, 'account-scopes'); permissions.append(node('legend', 'Permissions', null));
      for (const scope of supported) {
        const choice = node('label', scope, null), checkbox = node('input', null, null);
        checkbox.type = 'checkbox'; checkbox.value = scope; checkbox.checked = view.permissions.includes(scope);
        checkbox.addEventListener('change', () => {
          const selected = new Set(view.permissions);
          if (checkbox.checked) selected.add(scope); else selected.delete(scope);
          if (scope === 'Raw' && checkbox.checked) selected.add('Read');
          if (scope === 'Read' && !checkbox.checked) selected.delete('Raw');
          view.permissions = supported.filter(value => selected.has(value));
          for (const input of permissions.querySelectorAll('input')) input.checked = view.permissions.includes(input.value);
          setBusy(view, false);
        });
        choice.prepend(checkbox); permissions.append(choice);
      }
      form.append(permissions, node('p', 'Raw permits original source records and requires Read.', 'account-token-meta'));
    }
    view.create = node('button', 'Create access token', null); view.create.type = 'submit'; form.append(view.create);
    form.addEventListener('submit', event => { event.preventDefault(); void issueToken(view, form); });
    view.tokens = node('ul', null, 'account-tokens'); view.tokens.setAttribute('aria-label', 'Your access tokens');
    view.content.append(form, view.uncertain, button('Refresh token list', () => void refreshTokens(view)), view.tokens);
    renderTokens(view, account); renderUncertainty(view); setBusy(view, false);
  }
  async function load(view) {
    if (!active(view) || view.busy) return;
    view.busy = true; view.dialog.setAttribute('aria-busy', 'true'); view.error.hidden = true; view.status.textContent = 'Loading account settings…';
    view.content.replaceChildren();
    try { const account = await readAccount(view); if (account !== null) { renderAccount(view, account); view.status.textContent = ''; } }
    catch (cause) { if (active(view)) { showError(view, cause); view.status.textContent = ''; view.content.replaceChildren(button('Retry loading settings', () => void load(view))); } }
    finally { if (active(view)) { view.busy = false; view.dialog.setAttribute('aria-busy', 'false'); } }
  }
  function open(trigger) {
    close();
    const owner = trigger.dataset.accountUserId;
    if (typeof owner !== 'string' || owner.length === 0) throw new Error('Settings requires data-account-user-id');
    const dialog = node('dialog', null, 'account-dialog'); dialog.dataset.accountDialog = ''; dialog.setAttribute('aria-label', 'Account settings');
    const heading = node('div', null, 'account-dialog-heading'); heading.append(node('h2', 'Account settings', null), button('Close settings', close));
    const content = node('div', null, 'account-dialog-content'), status = node('p', '', 'account-status'), error = node('p', '', 'account-error');
    status.setAttribute('role', 'status'); error.setAttribute('role', 'alert'); error.hidden = true;
    dialog.append(heading, status, error, content);
    const view = { owner, trigger, dialog, content, status, error, controllers: new Set(), busy: false, create: null, acknowledge: null, permissions: [], tokens: null, uncertain: null, secret: null, secretSlot: null };
    current = view; document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter(element => !element.hidden && element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
    dialog.showModal(); void load(view);
  }
  async function submitLogin(form) {
    if (loginRequests.has(form)) return;
    const login = form.elements.namedItem('login'), password = form.elements.namedItem('password');
    if (!(login instanceof window.HTMLInputElement) || !(password instanceof window.HTMLInputElement)) throw new Error('Account login requires login and password inputs');
    let error = form.querySelector('[data-account-login-error]');
    if (error === null) { error = node('p', '', 'account-error'); error.dataset.accountLoginError = ''; error.setAttribute('role', 'alert'); form.append(error); }
    let status = form.querySelector('[data-account-login-status]');
    if (status === null) { status = node('p', '', 'account-status'); status.dataset.accountLoginStatus = ''; status.setAttribute('role', 'status'); form.append(status); }
    const controls = [...form.querySelectorAll('input, button')];
    const credentials = { login: login.value, password: password.value }; password.value = '';
    loginRequests.add(form); controls.forEach(element => { element.disabled = true; }); form.setAttribute('aria-busy', 'true');
    error.hidden = true; status.textContent = 'Signing in…';
    try {
      const result = await request('/login', 'POST', credentials, new Set());
      if (result === null || !validUser(result.user)) throw new Error('Invalid login response');
      close(); window.location.reload();
    } catch (cause) { if (form.isConnected) { error.textContent = message(cause, true); error.hidden = false; status.textContent = ''; password.focus(); } }
    finally { credentials.password = ''; loginRequests.delete(form); controls.forEach(element => { element.disabled = false; }); form.setAttribute('aria-busy', 'false'); }
  }
  function click(event) {
    if (!(event.target instanceof window.Element)) return;
    const trigger = event.target.closest('[data-account-settings]');
    if (trigger !== null && !trigger.disabled) { event.preventDefault(); open(trigger); }
  }
  function submit(event) {
    if (!(event.target instanceof window.HTMLFormElement) || !event.target.matches('[data-account-login]')) return;
    event.preventDefault(); void submitLogin(event.target);
  }
  function invalidate() { close(); }
  function changed() { if (current !== null && !active(current)) close(); }
  function focus() {
    const view = current;
    // A response already in flight may describe the account from before a
    // cross-tab cookie change. Replace its lifecycle, not merely its next read.
    if (view !== null) open(view.trigger);
  }
  const observer = new window.MutationObserver(changed); observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-account-user-id'] });
  document.addEventListener('click', click); document.addEventListener('submit', submit); document.addEventListener('account:invalidate', invalidate);
  window.addEventListener('pagehide', invalidate); window.addEventListener('focus', focus);
  return { dispose() { close(); observer.disconnect(); document.removeEventListener('click', click); document.removeEventListener('submit', submit); document.removeEventListener('account:invalidate', invalidate); window.removeEventListener('pagehide', invalidate); window.removeEventListener('focus', focus); uncertainMints.clear(); } };
}

installAccountUI({ document, window, fetch: window.fetch.bind(window) });
