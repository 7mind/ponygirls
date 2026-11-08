// Rites web UI. Vanilla TypeScript, no framework, no persistence.
//
// Security rules honored here:
//  - credential secrets are write-only: never rendered, never prefilled into
//    forms, never stored; input fields are cleared after submit, after dialog
//    close, on logout and on session loss.
//  - all server-provided strings are inserted with textContent, never HTML.
//  - proposal links are rendered as anchors only for http/https URLs.
//  - every request has a finite timeout and same-origin cookie credentials.
//  - responses that arrive after logout or an account change are discarded
//    (generation guard) and can never restore stale private UI.
//
// Manual-run uncertainty: if the response to POST /api/runs is lost, the run
// intent (scoped to user+repository+rite) keeps its requestId so an explicit
// retry sends exactly the same idempotency key. Only a known response, or an
// explicit "New run" choice, clears the intent. Nothing is retried
// automatically.

import { BaboonCodecContext } from '../generated/typescript/BaboonSharedRuntime.js';
import {
  Ack,
  CredentialInfo,
  CredentialMode,
  CredentialsResult,
  CredentialResult,
  DeleteCredentialRequest,
  DeleteRepositoryRequest,
  DeleteRiteRequest,
  Failure,
  ForgeKind,
  GrantInfo,
  GrantRole,
  LoginRequest,
  LoginResponse,
  ManualRunRequest,
  ModelInfo,
  ModelsResult,
  OAuthClientInfo,
  OAuthClientsResult,
  RepositoryInfo,
  RepositoriesResult,
  RefreshHealth,
  RepositoryResult,
  RiteInfo,
  RiteResult,
  RitesResult,
  RunInfo,
  RunResult,
  RunsResult,
  SaveCredentialRequest,
  SaveRiteRequest,
  SaveRepositoryRequest,
  SetGrantRequest,
  StatusInfo,
  UserInfo,
  UsersResult,
  VersionInfo,
} from '../generated/typescript/rites/api/index.js';

// ---------------------------------------------------------------------------
// Small stateless DOM helpers (textContent only — never HTML from data)
// ---------------------------------------------------------------------------

type Child = Node | string | null | undefined;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs !== null) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = String(value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function badge(text: string): HTMLElement {
  return el('span', { class: 'badge' }, text);
}

function alertBox(message: string): HTMLElement {
  return el('p', { class: 'error', role: 'alert' }, message);
}

function emptyBox(message: string): HTMLElement {
  return el('p', { class: 'empty' }, message);
}

function muted(text: string): HTMLElement {
  return el('span', { class: 'muted' }, text);
}

function mono(text: string): HTMLElement {
  return el('code', {}, text);
}

function safeHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

// Fixed production timings; deliberately not configurable at runtime.
const POLL_INTERVAL_MS = 10_000;
const FETCH_DEADLINE_MS = 10_000;
// Hard cap on a single response body so a broken or hostile server cannot
// force unbounded allocation in the browser.
const MAX_RESPONSE_BYTES = 1_048_576;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(`HTTP ${status}: ${code}`);
  }
}

// Thrown when a response belongs to an earlier session/view generation
// (logout, login, session loss). Such responses must be dropped silently.
class StaleResponseError extends Error {
  constructor() {
    super('stale response');
  }
}

// Thrown when an authenticated response names a different actual user than
// the one this UI is signed in as (cookie switched by another page/context
// tab). All private state, open forms and run intents must be discarded.
class IdentityMismatchError extends Error {
  constructor() {
    super('identity mismatch');
  }
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return `Unable to reach Rites (${error.code}).`;
    }
    return `Request failed: HTTP ${error.status}, code ${error.code}.`;
  }
  return 'Unexpected error.';
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

type View = 'repositories' | 'credentials' | 'users' | 'rites';
type Phase = 'connecting' | 'login' | 'loading' | 'app' | 'unreachable' | 'load-failed';

interface AppScheduler {
  every(handler: () => void, ms: number): void;
}

interface AppUuid {
  random(): string;
}

interface AppTransport {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

class Application {
  private readonly transport: AppTransport;
  private readonly scheduler: AppScheduler;
  private readonly uuid: AppUuid;

  // Session/view generation: every request captures it and discards results
  // that arrive after it changed (logout, login, session loss).
  private generation = 0;

  private phase: Phase = 'connecting';
  private me: UserInfo | null = null;
  private version: VersionInfo | null = null;
  private view: View = 'repositories';
  private credentials: CredentialInfo[] = [];
  private repositories: RepositoryInfo[] = [];
  private models: ModelInfo[] = [];
  private oauthClients: OAuthClientInfo[] = [];
  private users: UserInfo[] = [];
  private status: StatusInfo | null = null;
  private statusError: string | null = null;
  private listError: string | null = null;
  private readonly rites: Map<string, RiteInfo[]> = new Map();
  private readonly runs: Map<string, RunInfo[]> = new Map();
  private activeRepoId: string | null = null;
  private historyRiteId: string | null = null;
  private readonly runPending: Set<string> = new Set();
  // Manual-run intents keyed by user|repository|rite; value is the
  // idempotency requestId. Kept across uncertain outcomes for exact retry.
  private readonly runIntents: Map<string, string> = new Map();

  private polling = false;

  constructor(transport: AppTransport, scheduler: AppScheduler, uuid: AppUuid) {
    this.transport = transport;
    this.scheduler = scheduler;
    this.uuid = uuid;
  }

  start(): void {
    this.scheduler.every(() => void this.tick(), POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.tick();
    });
    void this.boot();
  }

  // ----- HTTP ---------------------------------------------------------------

  // The fetch deadline stays armed through ALL body consumption (success
  // and error responses alike); aborting cancels the body stream too.
  //
  // Identity contract: every request made while signed in carries
  // X-Rites-User with the expected user id; every authenticated response
  // echoes the actual user. A mismatch (the browser cookie was switched by
  // another page) is detected BEFORE the body is consumed, and discards all
  // private state instead of silently switching accounts.
  private async requestWithIdentity(method: string, path: string, body: unknown | undefined): Promise<{ json: unknown; actualUser: string | null }> {
    const generation = this.generation;
    const expectedUser = this.me === null ? null : this.me.id;
    const headers: Record<string, string> = {};
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = 'application/json';
    }
    if (expectedUser !== null) {
      headers['X-Rites-User'] = expectedUser;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), FETCH_DEADLINE_MS);
    const settle = (): void => {
      window.clearTimeout(timer);
    };
    let response: Response;
    try {
      response = await this.transport.fetch(path, {
        method,
        credentials: 'same-origin',
        headers: Object.keys(headers).length === 0 ? undefined : headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      settle();
      if (this.generation !== generation) throw new StaleResponseError();
      throw new ApiError(0, controller.signal.aborted ? 'timeout' : 'network');
    }
    if (expectedUser !== null) {
      const actualUser = response.headers.get('X-Rites-User');
      if ((actualUser !== null && actualUser !== expectedUser) || (response.ok && actualUser === null)) {
        // The session now belongs to someone else: refuse to consume the body.
        settle();
        throw new IdentityMismatchError();
      }
    }
    if (!response.ok) {
      let code = `http-${response.status}`;
      try {
        const failure = Failure.jsonCodec().decode(BaboonCodecContext.Default, await this.readBoundedJson(response, controller));
        code = failure.code;
      } catch {
        // The error body was unusable, oversized, or truncated: the HTTP
        // status alone is still a definitive, settled failure.
      }
      settle();
      if (this.generation !== generation) throw new StaleResponseError();
      throw new ApiError(response.status, code);
    }
    let json: unknown;
    try {
      json = await this.readBoundedJson(response, controller);
    } catch (error) {
      settle();
      if (this.generation !== generation) throw new StaleResponseError();
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, controller.signal.aborted ? 'timeout' : 'network');
    }
    settle();
    if (this.generation !== generation) throw new StaleResponseError();
    return { json, actualUser: response.headers.get('X-Rites-User') };
  }

  private async request(method: string, path: string, body: unknown | undefined): Promise<unknown> {
    const envelope = await this.requestWithIdentity(method, path, body);
    return envelope.json;
  }

  // Reads a JSON response body under the armed request deadline, with a hard
  // byte cap so a broken or hostile server cannot force unbounded allocation.
  private async readBoundedJson(response: Response, controller: AbortController): Promise<unknown> {
    let text: string;
    const stream = response.body;
    if (stream === null) {
      text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) {
        controller.abort();
        throw new ApiError(0, 'response-too-large');
      }
    } else {
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value = chunk.value;
        if (value === undefined) continue;
        received += value.byteLength;
        if (received > MAX_RESPONSE_BYTES) {
          controller.abort();
          throw new ApiError(0, 'response-too-large');
        }
        chunks.push(value);
      }
      const total = chunks.reduce((sum, part) => sum + part.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const part of chunks) {
        merged.set(part, offset);
        offset += part.byteLength;
      }
      text = new TextDecoder().decode(merged);
    }
    return JSON.parse(text) as unknown;
  }

  private static encode<T>(codec: { encode(ctx: BaboonCodecContext, value: T): unknown }, value: T): unknown {
    return codec.encode(BaboonCodecContext.Default, value);
  }

  // Classify a caught error for refresh-style handlers: null means "already
  // handled" (stale response, session loss), otherwise the message to show.
  private handledOrMessage(error: unknown): string | null {
    if (error instanceof StaleResponseError) return null;
    if (error instanceof IdentityMismatchError) {
      this.identityLost();
      return null;
    }
    if (error instanceof ApiError && error.status === 401) {
      this.authLost();
      return null;
    }
    return describeError(error);
  }

  // ----- API wrappers -------------------------------------------------------

  private async getVersion(): Promise<VersionInfo> {
    return VersionInfo.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', '/api/version', undefined));
  }
  private async postLogin(login: string, password: string): Promise<LoginResponse> {
    const body = Application.encode(LoginRequest.jsonCodec(), new LoginRequest(login, password));
    const envelope = await this.requestWithIdentity('POST', '/api/login', body);
    const response = LoginResponse.jsonCodec().decode(BaboonCodecContext.Default, envelope.json);
    // Login binds the identity the UI will expect on every later request.
    if (envelope.actualUser !== null && envelope.actualUser !== response.user.id) {
      throw new IdentityMismatchError();
    }
    return response;
  }
  private async getMe(): Promise<UserInfo> {
    const envelope = await this.requestWithIdentity('GET', '/api/me', undefined);
    const user = UserInfo.jsonCodec().decode(BaboonCodecContext.Default, envelope.json);
    if (envelope.actualUser !== null && envelope.actualUser !== user.id) {
      throw new IdentityMismatchError();
    }
    return user;
  }
  private async postLogout(): Promise<Ack> {
    return Ack.jsonCodec().decode(BaboonCodecContext.Default, await this.request('POST', '/api/logout', undefined));
  }
  private async listCredentials(): Promise<CredentialsResult> {
    return CredentialsResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', '/api/credentials', undefined));
  }
  private async saveCredential(value: SaveCredentialRequest): Promise<CredentialResult> {
    const body = Application.encode(SaveCredentialRequest.jsonCodec(), value);
    return CredentialResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('PUT', '/api/credentials', body));
  }
  private async deleteCredential(id: string, expectedRevision: number): Promise<Ack> {
    const body = Application.encode(DeleteCredentialRequest.jsonCodec(), new DeleteCredentialRequest(id, expectedRevision));
    return Ack.jsonCodec().decode(BaboonCodecContext.Default, await this.request('POST', '/api/credentials/delete', body));
  }
  private async listRepositories(): Promise<RepositoriesResult> {
    return RepositoriesResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', '/api/repositories', undefined));
  }
  private async saveRepository(value: SaveRepositoryRequest): Promise<RepositoryResult> {
    const body = Application.encode(SaveRepositoryRequest.jsonCodec(), value);
    return RepositoryResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('PUT', '/api/repositories', body));
  }
  private async deleteRepository(id: string, expectedRevision: number): Promise<Ack> {
    const body = Application.encode(DeleteRepositoryRequest.jsonCodec(), new DeleteRepositoryRequest(id, expectedRevision));
    return Ack.jsonCodec().decode(BaboonCodecContext.Default, await this.request('POST', '/api/repositories/delete', body));
  }
  private async setGrant(value: SetGrantRequest): Promise<RepositoryResult> {
    const body = Application.encode(SetGrantRequest.jsonCodec(), value);
    return RepositoryResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('POST', '/api/grants', body));
  }
  private async listRites(repositoryId: string): Promise<RitesResult> {
    const path = `/api/repositories/${encodeURIComponent(repositoryId)}/rites`;
    return RitesResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', path, undefined));
  }
  private async saveRite(value: SaveRiteRequest): Promise<RiteResult> {
    const body = Application.encode(SaveRiteRequest.jsonCodec(), value);
    return RiteResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('PUT', '/api/rites', body));
  }
  private async deleteRite(repositoryId: string, id: string, expectedRevision: number): Promise<Ack> {
    const body = Application.encode(DeleteRiteRequest.jsonCodec(), new DeleteRiteRequest(repositoryId, id, expectedRevision));
    return Ack.jsonCodec().decode(BaboonCodecContext.Default, await this.request('POST', '/api/rites/delete', body));
  }
  private async listModels(): Promise<ModelsResult> {
    return ModelsResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', '/api/models', undefined));
  }
  private async listOAuthClients(): Promise<OAuthClientsResult> {
    return OAuthClientsResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', '/api/oauth-clients', undefined));
  }
  private async listUsers(): Promise<UsersResult> {
    return UsersResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', '/api/users', undefined));
  }
  private async getStatus(): Promise<StatusInfo> {
    return StatusInfo.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', '/api/status', undefined));
  }
  private async startRun(value: ManualRunRequest): Promise<RunResult> {
    const body = Application.encode(ManualRunRequest.jsonCodec(), value);
    return RunResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('POST', '/api/runs', body));
  }
  private async getRun(id: string): Promise<RunResult> {
    const path = `/api/runs/${encodeURIComponent(id)}`;
    return RunResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', path, undefined));
  }
  private async listRuns(repositoryId: string, riteId: string): Promise<RunsResult> {
    const path = `/api/repositories/${encodeURIComponent(repositoryId)}/rites/${encodeURIComponent(riteId)}/runs`;
    return RunsResult.jsonCodec().decode(BaboonCodecContext.Default, await this.request('GET', path, undefined));
  }

  // ----- Session state transitions ------------------------------------------

  private resetToLogin(message: string): void {
    this.generation += 1;
    this.clearSecretInputs(document);
    this.closeAllDialogs();
    this.resetTransientState();
    this.me = null;
    this.view = 'repositories';
    this.phase = 'login';
    this.dismissNotice();
    this.render();
    this.showNotice(message, null);
  }

  private authLost(): void {
    this.resetToLogin('Session expired.\nSign in again to continue.');
  }

  private identityLost(): void {
    this.resetToLogin('Account changed: the browser session now belongs to a different user.\nAll pending input was discarded. Sign in again.');
  }

  private async doLogout(): Promise<void> {
    this.generation += 1;
    this.clearSecretInputs(document);
    this.closeAllDialogs();
    try {
      await this.postLogout();
    } catch (error) {
      if (error instanceof IdentityMismatchError) {
        // Another page switched the account under us: the server refused the
        // logout. Discard everything and require fresh authentication.
        this.identityLost();
        return;
      }
      // Best effort otherwise: local session state is cleared regardless.
    }
    this.resetTransientState();
    this.me = null;
    this.view = 'repositories';
    this.phase = 'login';
    this.dismissNotice();
    this.render();
    this.showNotice('Signed out.', null);
  }

  private resetTransientState(): void {
    this.credentials = [];
    this.repositories = [];
    this.models = [];
    this.oauthClients = [];
    this.users = [];
    this.status = null;
    this.statusError = null;
    this.listError = null;
    this.rites.clear();
    this.runs.clear();
    this.activeRepoId = null;
    this.historyRiteId = null;
    this.runPending.clear();
    this.runIntents.clear();
  }

  private async loadCore(): Promise<void> {
    const [credentials, repositories, models, oauthClients, users] = await Promise.all([
      this.listCredentials(),
      this.listRepositories(),
      this.listModels(),
      this.listOAuthClients(),
      this.listUsers(),
    ]);
    this.credentials = credentials.items;
    this.repositories = repositories.items;
    this.models = models.items;
    this.oauthClients = oauthClients.items;
    this.users = users.items;
    this.listError = null;
  }

  private async refreshRepositories(): Promise<void> {
    try {
      const result = await this.listRepositories();
      this.repositories = result.items;
      this.listError = null;
    } catch (error) {
      const message = this.handledOrMessage(error);
      if (message !== null) this.listError = message;
    }
  }

  private async refreshStatus(): Promise<void> {
    try {
      this.status = await this.getStatus();
      this.statusError = null;
    } catch (error) {
      const message = this.handledOrMessage(error);
      if (message !== null) this.statusError = message;
    }
  }

  private async refreshCredentials(): Promise<void> {
    try {
      const result = await this.listCredentials();
      this.credentials = result.items;
    } catch (error) {
      const message = this.handledOrMessage(error);
      if (message !== null) this.listError = message;
    }
  }

  private async refreshRites(repositoryId: string): Promise<void> {
    try {
      const result = await this.listRites(repositoryId);
      this.rites.set(repositoryId, result.items);
      this.listError = null;
    } catch (error) {
      const message = this.handledOrMessage(error);
      if (message !== null) this.listError = message;
    }
  }

  private async refreshRuns(repositoryId: string, riteId: string): Promise<void> {
    try {
      const result = await this.listRuns(repositoryId, riteId);
      this.runs.set(`${repositoryId}/${riteId}`, result.items);
    } catch (error) {
      const message = this.handledOrMessage(error);
      if (message !== null) this.listError = message;
    }
  }

  // ----- Lookup helpers -----------------------------------------------------

  private repositoryById(id: string): RepositoryInfo | null {
    return this.repositories.find(repo => repo.id === id) ?? null;
  }

  private myRole(repo: RepositoryInfo): GrantRole | null {
    if (this.me === null) return null;
    if (repo.owner === this.me.id) return GrantRole.Owner;
    const grant = repo.grants.find(g => g.userId === this.me?.id);
    return grant === undefined ? null : grant.role;
  }

  private canManageRites(repo: RepositoryInfo): boolean {
    const role = this.myRole(repo);
    return role === GrantRole.Owner || role === GrantRole.Editor;
  }

  private isOwner(repo: RepositoryInfo): boolean {
    return this.myRole(repo) === GrantRole.Owner;
  }

  private credentialName(id: string): string {
    const cred = this.credentials.find(c => c.id === id);
    return cred === undefined ? id : `${cred.name} (${cred.forge})`;
  }

  private runIntentKey(repositoryId: string, riteId: string): string | null {
    if (this.me === null) return null;
    return `${this.me.id}|${repositoryId}|${riteId}`;
  }

  // ----- Notice area --------------------------------------------------------

  private dismissNotice(): void {
    const notice = document.getElementById('notice');
    if (notice !== null) notice.replaceChildren();
  }

  private showNotice(
    message: string,
    action: { label: string; run: () => void | Promise<void> } | null,
  ): void {
    const notice = document.getElementById('notice');
    if (notice === null) return;
    notice.replaceChildren();
    const row = el('div', { class: 'actions', style: 'margin:0' });
    row.append(el('p', { style: 'white-space:pre-line;margin:0' }, message));
    if (action !== null) {
      const button = el('button', { class: 'primary', type: 'button' }, action.label);
      button.addEventListener('click', () => {
        this.dismissNotice();
        void action.run();
      });
      row.append(button);
    }
    const close = el('button', { type: 'button', 'aria-label': 'Dismiss notice' }, 'Dismiss');
    close.addEventListener('click', () => this.dismissNotice());
    row.append(close);
    notice.append(row);
  }

  private conflictNotice(what: string): void {
    this.showNotice(
      `The ${what} changed elsewhere (revision conflict).\nPress Reload to fetch the latest data.`,
      {
        label: 'Reload',
        run: () => this.reloadAfterConflict(),
      },
    );
  }

  private async reloadAfterConflict(): Promise<void> {
    if (this.view === 'rites' && this.activeRepoId !== null) {
      await this.refreshRites(this.activeRepoId);
      this.renderRitesRegion(false);
    }
    await this.refreshRepositories();
    this.renderRepoRegion(false);
  }

  // ----- Regions and focus preservation ------------------------------------

  // True when a DOM region must not be replaced: an open dialog, or keyboard
  // focus inside the region (replacing it would steal focus mid-use).
  private uiEngaged(node: HTMLElement): boolean {
    if (node.ownerDocument.querySelector('dialog[open]') !== null) return true;
    const active = node.ownerDocument.activeElement;
    return active instanceof HTMLElement && node.contains(active);
  }

  // Polling-driven renders (force=false) never replace an active form or
  // focused control; user-initiated renders pass force=true.
  private setRegion(id: string, build: () => Node, force: boolean): void {
    const region = document.getElementById(id);
    if (region === null) return;
    if (!force && this.uiEngaged(region)) return;
    region.replaceChildren(build());
  }

  private clearSecretInputs(root: ParentNode): void {
    for (const input of Array.from(root.querySelectorAll('input[type="password"]'))) {
      (input as HTMLInputElement).value = '';
    }
  }

  private closeAllDialogs(): void {
    for (const dialog of Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]'))) {
      dialog.close();
      this.clearSecretInputs(dialog);
      dialog.remove();
    }
  }

  // ----- Rendering ----------------------------------------------------------

  private renderIdentity(): void {
    const identity = document.getElementById('identity');
    if (identity === null) return;
    identity.replaceChildren();
    if (this.phase === 'connecting') {
      identity.append(el('span', { class: 'muted' }, 'Connecting…'));
      return;
    }
    if (this.me === null) {
      identity.append(el('span', { class: 'muted' }, 'Not signed in'));
      return;
    }
    identity.append(el('span', {}, `Signed in as ${this.me.login}`));
    const out = el('button', { type: 'button' }, 'Sign out');
    out.addEventListener('click', () => void this.doLogout());
    identity.append(out);
  }

  private render(): void {
    const app = document.getElementById('app');
    if (app === null) return;
    app.replaceChildren();
    app.setAttribute('aria-busy', 'false');
    this.renderIdentity();
    const phase = this.phase;
    if (phase === 'connecting') {
      app.append(el('p', null, 'Connecting to Rites…'));
      return;
    }
    if (phase === 'unreachable') {
      const box = el('div', { class: 'panel' }, null);
      box.append(el('h1', null, 'Unable to reach Rites'));
      box.append(alertBox('The Rites service could not be contacted.\nCheck the connection and try again.'));
      const retry = el('button', { class: 'primary', type: 'button' }, 'Retry');
      retry.addEventListener('click', () => void this.boot());
      box.append(retry);
      app.append(box);
      return;
    }
    if (phase === 'load-failed') {
      const box = el('div', { class: 'panel' }, null);
      box.append(el('h1', null, 'Could not load data'));
      box.append(alertBox(this.listError ?? 'Loading failed.'));
      const retry = el('button', { class: 'primary', type: 'button' }, 'Retry');
      retry.addEventListener('click', () => {
        retry.disabled = true;
        void this.enterApp();
      });
      box.append(retry);
      app.append(box);
      return;
    }
    if (phase === 'loading') {
      app.append(el('p', null, 'Loading your Rites data…'));
      return;
    }
    if (phase === 'login') {
      app.append(this.loginView());
      return;
    }
    app.append(this.navBar());
    if (this.view === 'repositories') {
      app.append(el('h1', null, 'Repositories'));
      const statusRegion = el('section', { id: 'status-region', 'aria-label': 'Service status' }, null);
      const repoRegion = el('section', { id: 'repo-region', 'aria-label': 'Repositories' }, null);
      app.append(statusRegion, repoRegion);
      this.renderStatusRegion(false);
      this.renderRepoRegion(false);
    } else if (this.view === 'credentials') {
      app.append(el('h1', null, 'Credentials'));
      app.append(el('p', { class: 'muted' }, 'Credentials are write-only: access and refresh tokens are never displayed or retrievable. When refresh health is Uncertain or Failed the owner must replace the credential; expiry is metadata only.'));
      const credRegion = el('section', { id: 'cred-region', 'aria-label': 'Credentials' }, null);
      app.append(credRegion);
      this.renderCredRegion(false);
    } else if (this.view === 'users') {
      app.append(el('h1', null, 'Users'));
      app.append(this.usersTable());
    } else {
      app.append(this.ritesView());
    }
    for (const heading of Array.from(app.querySelectorAll('h1'))) {
      heading.setAttribute('tabindex', '-1');
    }
  }

  private navBar(): HTMLElement {
    const nav = el('nav', { 'aria-label': 'Main navigation' }, null);
    const tabs: Array<[View, string]> = [
      ['repositories', 'Repositories'],
      ['credentials', 'Credentials'],
      ['users', 'Users'],
    ];
    for (const [view, label] of tabs) {
      const button = el('button', { type: 'button' }, label);
      if (this.view === view) button.setAttribute('aria-current', 'page');
      button.addEventListener('click', () => {
        this.view = view;
        this.historyRiteId = null;
        this.render();
        const heading = document.querySelector('main h1');
        if (heading instanceof HTMLElement) heading.focus();
      });
      nav.append(button);
    }
    return nav;
  }

  private loginView(): HTMLElement {
    const panel = el('div', { class: 'login' }, null);
    panel.append(el('h1', null, 'Sign in to Rites'));
    const error = el('p', { class: 'error', role: 'alert', hidden: true }, null);
    const login = el('input', { type: 'text', name: 'login', autocomplete: 'username', required: true });
    const password = el('input', { type: 'password', name: 'password', autocomplete: 'current-password', required: true });
    const submit = el('button', { class: 'primary', type: 'submit' }, 'Sign in');
    const form = el('form', null, null);
    form.append(
      el('label', null, 'Login', login),
      el('label', null, 'Password', password),
      submit,
    );
    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.setAttribute('hidden', '');
      submit.disabled = true;
      try {
        const response = await this.postLogin(login.value.trim(), password.value);
        password.value = '';
        this.generation += 1;
        this.me = response.user;
        this.version = response.versions;
        this.phase = 'loading';
        this.render();
        await this.enterApp();
      } catch (err) {
        password.value = '';
        if (err instanceof StaleResponseError) return;
        if (err instanceof IdentityMismatchError) {
          this.identityLost();
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          error.replaceChildren('Invalid login or password.');
        } else {
          error.replaceChildren(describeError(err));
        }
        error.removeAttribute('hidden');
      } finally {
        submit.disabled = false;
      }
    });
    panel.append(error, form);
    if (this.version !== null) {
      panel.append(el('p', { class: 'muted' }, `Rites ${this.version.current} (minimum ${this.version.minimum})`));
    }
    return panel;
  }

  private usersTable(): HTMLElement {
    const wrap = el('div', { class: 'table-wrap' }, null);
    const table = el('table', { 'aria-label': 'Users' }, null);
    const head = el('tr', null, el('th', null, 'Login'), el('th', null, 'ID'));
    table.append(el('thead', null, head));
    const body = el('tbody', null, null);
    for (const user of this.users) {
      body.append(el('tr', null, el('td', null, user.login), el('td', null, mono(user.id))));
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  // ----- Status region ------------------------------------------------------

  private renderStatusRegion(force: boolean): void {
    this.setRegion('status-region', () => {
      const section = el('div', { class: 'toolbar' }, null);
      if (this.statusError !== null) {
        // The status must visibly fail; never show stale success values.
        section.append(alertBox(`Status unavailable.\n${this.statusError}`));
        return section;
      }
      if (this.status === null) {
        section.append(muted('Status not loaded yet.'));
        return section;
      }
      section.append(
        badge(`scheduler ${this.status.schedulerEnabled ? 'enabled' : 'disabled'}`),
        el('span', null, `queued runs: ${this.status.queuedRuns.toString()}`),
        el('span', null, `active runs: ${this.status.activeRuns.toString()}`),
      );
      return section;
    }, force);
  }

  // ----- Repositories view --------------------------------------------------

  private renderRepoRegion(force: boolean): void {
    this.setRegion('repo-region', () => {
      const container = el('div', null, null);
      const toolbar = el('div', { class: 'toolbar' }, null);
      const create = el('button', { class: 'primary', type: 'button' }, 'New repository');
      create.addEventListener('click', () => void this.repoDialog(null));
      toolbar.append(create);
      if (this.listError !== null) {
        toolbar.append(alertBox(`Repository list failed to update.\n${this.listError}\nData shown below may be stale.`));
      }
      container.append(toolbar, this.repoTable());
      return container;
    }, force);
  }

  private repoTable(): HTMLElement {
    if (this.repositories.length === 0) {
      return emptyBox('No repositories yet.');
    }
    const wrap = el('div', { class: 'table-wrap' }, null);
    const table = el('table', { 'aria-label': 'Repositories' }, null);
    table.append(el('thead', null, el('tr', null,
      el('th', null, 'ID'),
      el('th', null, 'Forge'),
      el('th', null, 'Host / project'),
      el('th', null, 'Base branch'),
      el('th', null, 'Credential'),
      el('th', null, 'Your role'),
      el('th', null, 'Actions'),
    )));
    const body = el('tbody', null, null);
    for (const repo of this.repositories) {
      const actions = el('div', { class: 'actions' }, null);
      const open = el('button', { type: 'button' }, 'Rites');
      open.addEventListener('click', () => this.openRites(repo.id));
      actions.append(open);
      if (this.isOwner(repo)) {
        const edit = el('button', { type: 'button' }, 'Edit');
        edit.addEventListener('click', () => void this.repoDialog(repo));
        const grants = el('button', { type: 'button' }, 'Grants');
        grants.addEventListener('click', () => void this.grantsDialog(repo));
        const remove = el('button', { type: 'button', class: 'danger' }, 'Delete');
        remove.addEventListener('click', () => void this.deleteRepositoryFlow(repo));
        actions.append(edit, grants, remove);
      }
      const role = this.myRole(repo);
      body.append(el('tr', null,
        el('td', null, mono(repo.id)),
        el('td', null, repo.forge),
        el('td', null, `${repo.host}/${repo.project}`),
        el('td', null, repo.baseBranch),
        el('td', null, this.credentialName(repo.credentialId)),
        el('td', null, role === null ? muted('none') : badge(role)),
        el('td', null, actions),
      ));
    }
    table.append(body);
    wrap.append(table);
    return wrap;
  }

  // ----- Credentials view ---------------------------------------------------

  private renderCredRegion(force: boolean): void {
    this.setRegion('cred-region', () => {
      const container = el('div', null, null);
      const toolbar = el('div', { class: 'toolbar' }, null);
      const create = el('button', { class: 'primary', type: 'button' }, 'New credential');
      create.addEventListener('click', () => void this.credentialDialog(null));
      toolbar.append(create);
      if (this.listError !== null) {
        toolbar.append(alertBox(`Credential list failed to update.\n${this.listError}`));
      }
      container.append(toolbar);
      if (this.credentials.length === 0) {
        container.append(emptyBox('No credentials yet.'));
        return container;
      }
      const wrap = el('div', { class: 'table-wrap' }, null);
      const table = el('table', { 'aria-label': 'Credentials' }, null);
      table.append(el('thead', null, el('tr', null,
        el('th', null, 'Name'),
        el('th', null, 'Forge'),
        el('th', null, 'Host'),
        el('th', null, 'Mode'),
        el('th', null, 'Expiry (UTC)'),
        el('th', null, 'Refresh'),
        el('th', null, 'Updated'),
        el('th', null, 'Actions'),
      )));
      const body = el('tbody', null, null);
      for (const cred of this.credentials) {
        const actions = el('div', { class: 'actions' }, null);
        const edit = el('button', { type: 'button' }, 'Edit');
        edit.addEventListener('click', () => void this.credentialDialog(cred));
        const remove = el('button', { type: 'button', class: 'danger' }, 'Delete');
        remove.addEventListener('click', () => void this.deleteCredentialFlow(cred));
        actions.append(edit, remove);
        const refreshCell = el('td', null, null);
        if (cred.refreshHealth === undefined) {
          refreshCell.append(muted('—'));
        } else {
          refreshCell.append(badge(cred.refreshHealth));
          if (cred.refreshHealth === RefreshHealth.Uncertain || cred.refreshHealth === RefreshHealth.Failed) {
            refreshCell.append(el('div', { class: 'muted' }, 'owner: replace'));
          }
        }
        body.append(el('tr', null,
          el('td', null, cred.name),
          el('td', null, cred.forge),
          el('td', null, cred.host),
          el('td', null, cred.mode === CredentialMode.Oauth ? badge('OAuth') : badge('Token')),
          el('td', null, cred.expiresAt === undefined ? muted('—') : cred.expiresAt),
          refreshCell,
          el('td', null, cred.updatedAt),
          el('td', null, actions),
        ));
      }
      table.append(body);
      wrap.append(table);
      container.append(wrap);
      return container;
    }, force);
  }

  // ----- Rites view ---------------------------------------------------------

  private openRites(repoId: string): void {
    this.activeRepoId = repoId;
    this.historyRiteId = null;
    this.view = 'rites';
    this.render();
    void this.refreshRites(repoId).then(() => this.renderRitesRegion(false));
  }

  private ritesView(): HTMLElement {
    const container = el('div', null, null);
    const repo = this.activeRepoId === null ? null : this.repositoryById(this.activeRepoId);
    const back = el('button', { type: 'button' }, 'Back to repositories');
    back.addEventListener('click', () => {
      this.view = 'repositories';
      this.historyRiteId = null;
      this.render();
      void this.refreshRepositories().then(() => this.renderRepoRegion(false));
      void this.refreshStatus().then(() => this.renderStatusRegion(false));
    });
    const heading = el('div', { class: 'toolbar' }, null);
    heading.append(back, el('h1', null, 'Rites'));
    container.append(heading);
    if (repo === null) {
      container.append(emptyBox('Repository not found.'));
      return container;
    }
    const info = el('p', null, null);
    info.append(
      mono(`${repo.host}/${repo.project}`),
      document.createTextNode(' on '),
      mono(repo.baseBranch),
      document.createTextNode(' · credential '),
      document.createTextNode(this.credentialName(repo.credentialId)),
      document.createTextNode(' · your role '),
      badge(this.myRole(repo) ?? 'none'),
    );
    container.append(info);
    const toolbar = el('div', { class: 'toolbar' }, null);
    if (this.canManageRites(repo)) {
      const create = el('button', { class: 'primary', type: 'button' }, 'New rite');
      create.addEventListener('click', () => void this.riteDialog(repo, null));
      toolbar.append(create);
    } else {
      toolbar.append(muted('Read-only access: viewer role.'));
    }
    if (this.listError !== null) {
      toolbar.append(alertBox(`Data failed to update.\n${this.listError}\nData shown below may be stale.`));
    }
    container.append(toolbar);
    const ritesRegion = el('section', { id: 'rites-region', 'aria-label': 'Rites' }, null);
    const runsRegion = el('section', { id: 'runs-region', 'aria-label': 'Run history' }, null);
    container.append(ritesRegion, runsRegion);
    this.renderRitesRegion(false);
    this.renderRunsRegion(false);
    return container;
  }

  private renderRitesRegion(force: boolean): void {
    this.setRegion('rites-region', () => {
      const repoId = this.activeRepoId;
      if (repoId === null) return el('div', null, null);
      const repo = this.repositoryById(repoId);
      const items = this.rites.get(repoId) ?? [];
      if (items.length === 0) {
        return emptyBox('No rites configured for this repository.');
      }
      const wrap = el('div', { class: 'table-wrap' }, null);
      const table = el('table', { 'aria-label': 'Rites' }, null);
      table.append(el('thead', null, el('tr', null,
        el('th', null, 'ID'),
        el('th', null, 'Schedule (UTC)'),
        el('th', null, 'Prompt path'),
        el('th', null, 'Model'),
        el('th', null, 'Enabled'),
        el('th', null, 'Actions'),
      )));
      const body = el('tbody', null, null);
      for (const rite of items) {
        const manage = repo !== null && this.canManageRites(repo);
        const actions = el('div', { class: 'actions' }, null);
        const history = el('button', { type: 'button' }, this.historyRiteId === rite.id ? 'Hide history' : 'History');
        history.addEventListener('click', () => this.toggleHistory(rite.id));
        actions.append(history);
        if (manage) {
          if (this.runPending.has(rite.id)) {
            const pending = el('button', { type: 'button', disabled: true }, 'Running…');
            actions.append(pending);
          } else {
            const intentKey = this.runIntentKey(repoId, rite.id);
            const uncertain = intentKey !== null && this.runIntents.has(intentKey);
            if (uncertain) {
              const retry = el('button', { type: 'button', class: 'primary' }, 'Retry run');
              retry.addEventListener('click', () => void this.manualRun(repoId, rite.id, false));
              const fresh = el('button', { type: 'button' }, 'New run');
              fresh.addEventListener('click', () => void this.manualRun(repoId, rite.id, true));
              actions.append(retry, fresh);
            } else {
              const run = el('button', { type: 'button' }, 'Run now');
              run.addEventListener('click', () => void this.manualRun(repoId, rite.id, false));
              actions.append(run);
            }
          }
          const edit = el('button', { type: 'button' }, 'Edit');
          edit.addEventListener('click', () => {
            const currentRepo = this.repositoryById(repoId);
            if (currentRepo !== null) void this.riteDialog(currentRepo, rite);
          });
          const remove = el('button', { type: 'button', class: 'danger' }, 'Delete');
          remove.addEventListener('click', () => void this.deleteRiteFlow(repoId, rite));
          actions.append(edit, remove);
        }
        body.append(el('tr', null,
          el('td', null, mono(rite.id)),
          el('td', null, mono(rite.schedule)),
          el('td', null, mono(rite.promptPath)),
          el('td', null, rite.modelId),
          el('td', null, rite.enabled ? badge('enabled') : muted('disabled')),
          el('td', null, actions),
        ));
      }
      table.append(body);
      wrap.append(table);
      return wrap;
    }, force);
  }

  private toggleHistory(riteId: string): void {
    if (this.historyRiteId === riteId) {
      this.historyRiteId = null;
      this.renderRunsRegion(false);
      return;
    }
    this.historyRiteId = riteId;
    const repoId = this.activeRepoId;
    if (repoId === null) return;
    this.runs.delete(`${repoId}/${riteId}`);
    this.renderRunsRegion(false);
    void this.refreshRuns(repoId, riteId).then(() => this.renderRunsRegion(false));
  }

  private renderRunsRegion(force: boolean): void {
    this.setRegion('runs-region', () => {
      const repoId = this.activeRepoId;
      const riteId = this.historyRiteId;
      if (repoId === null || riteId === null) return el('div', null, null);
      const runs = this.runs.get(`${repoId}/${riteId}`);
      if (runs === undefined) {
        return el('p', { class: 'muted' }, 'Loading run history…');
      }
      const heading = el('h2', null, `Run history for ${riteId}`);
      if (runs.length === 0) {
        return el('div', null, heading, emptyBox('No runs recorded.'));
      }
      const wrap = el('div', { class: 'table-wrap' }, null);
      const table = el('table', { 'aria-label': 'Run history' }, null);
      table.append(el('thead', null, el('tr', null,
        el('th', null, 'State'),
        el('th', null, 'Trigger'),
        el('th', null, 'Created'),
        el('th', null, 'Finished'),
        el('th', null, 'Base revision'),
        el('th', null, 'Prompt digest'),
        el('th', null, 'Branch'),
        el('th', null, 'Proposal'),
      )));
      const body = el('tbody', null, null);
      for (const run of runs) {
        const stateCell = el('td', null, badge(run.state));
        if (run.failureCode !== undefined && run.failureCode !== null) {
          stateCell.append(el('div', { class: 'muted' }, `code ${run.failureCode}`));
        }
        body.append(el('tr', null,
          stateCell,
          el('td', null, run.trigger),
          el('td', null, run.createdAt),
          el('td', null, run.finishedAt ?? muted('—')),
          el('td', null, run.baseRevision === undefined ? muted('—') : mono(run.baseRevision)),
          el('td', null, run.promptDigest === undefined ? muted('—') : mono(run.promptDigest)),
          el('td', null, run.branch === undefined ? muted('—') : mono(run.branch)),
          el('td', null, this.proposalCell(run.proposalUrl)),
        ));
      }
      table.append(body);
      wrap.append(table);
      return el('div', null, heading, wrap);
    }, force);
  }

  private proposalCell(url: string | undefined): HTMLElement {
    const cell = el('div', null, null);
    if (url === undefined || url === null) {
      cell.append(muted('—'));
      return cell;
    }
    const safe = safeHttpUrl(url);
    if (safe !== null) {
      const anchor = el('a', { target: '_blank', rel: 'noopener noreferrer' }, url);
      anchor.setAttribute('href', safe.href); // only after the scheme check
      cell.append(anchor);
      return cell;
    }
    cell.append(mono(url), el('div', { class: 'muted' }, 'link suppressed: unsupported scheme'));
    return cell;
  }

  // ----- Manual run with uncertain-outcome retry ----------------------------

  private async manualRun(repositoryId: string, riteId: string, fresh: boolean): Promise<void> {
    if (this.me === null) return;
    if (this.runPending.has(riteId)) return;
    const intentKey = this.runIntentKey(repositoryId, riteId);
    if (intentKey === null) return;
    let requestId = this.runIntents.get(intentKey) ?? null;
    if (fresh || requestId === null) {
      // A new user intent mints a new idempotency key. An explicit retry of an
      // uncertain outcome reuses the recorded key so the server dedupes.
      requestId = this.uuid.random();
      this.runIntents.set(intentKey, requestId);
    }
    this.runPending.add(riteId);
    this.renderRitesRegion(true);
    try {
      const result = await this.startRun(new ManualRunRequest(repositoryId, riteId, requestId));
      // Response known: the intent is complete.
      this.runIntents.delete(intentKey);
      if (this.historyRiteId === riteId && this.activeRepoId === repositoryId) {
        await this.refreshRuns(repositoryId, riteId);
        this.renderRunsRegion(true);
      }
      this.showNotice(`Run ${result.run.id} is ${result.run.state}.`, null);
    } catch (error) {
      if (error instanceof StaleResponseError) return;
      if (error instanceof IdentityMismatchError) {
        this.identityLost();
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        this.authLost();
        return;
      }
      if (error instanceof ApiError && error.status === 0) {
        // Outcome unknown: the server may have accepted the run. Keep the
        // intent so an explicit retry sends the same requestId.
        this.showNotice(
          'Run outcome unknown: no response was received.\nThe run may already be queued; retrying reuses the same run request.',
          {
            label: 'Retry run',
            run: () => void this.manualRun(repositoryId, riteId, false),
          },
        );
        return;
      }
      // A definitive server response: the intent is known failed.
      this.runIntents.delete(intentKey);
      this.showNotice(`Manual run failed.\n${describeError(error)}`, null);
    } finally {
      this.runPending.delete(riteId);
      this.renderRitesRegion(true);
    }
  }

  // ----- Dialogs ------------------------------------------------------------

  private openDialog(
    title: string,
    build: (body: HTMLElement, done: (result: unknown) => void, fail: (message: string) => void) => void,
  ): Promise<unknown> {
    return new Promise(resolve => {
      const dialog = el('dialog', { 'aria-label': title }, null);
      const heading = el('h2', null, title);
      const error = el('p', { class: 'error', role: 'alert', hidden: true }, null);
      const body = el('div', null, null);
      let settled: { value: unknown } | null = null;
      const done = (result: unknown): void => {
        settled = { value: result };
        dialog.close();
      };
      const fail = (message: string): void => {
        error.replaceChildren(message);
        error.removeAttribute('hidden');
      };
      build(body, done, fail);
      dialog.append(heading, error, body);
      dialog.addEventListener('close', () => {
        // Secret-bearing fields must be wiped on every close path (cancel,
        // Escape, success). Removing the element discards the rest.
        this.clearSecretInputs(dialog);
        dialog.remove();
        resolve(settled === null ? null : settled.value);
      });
      dialog.addEventListener('cancel', () => {
        this.clearSecretInputs(dialog);
      });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  private formDialog(
    title: string,
    buildForm: (form: HTMLFormElement, done: (result: unknown) => void, fail: (message: string) => void) => void,
  ): Promise<unknown> {
    return this.openDialog(title, (body, done, fail) => {
      const form = el('form', null, null);
      buildForm(form, done, fail);
      const cancel = el('button', { type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => {
        const dialog = form.closest('dialog');
        if (dialog instanceof HTMLDialogElement) dialog.close();
      });
      body.append(form, el('div', { class: 'actions' }, cancel));
    });
  }

  private confirmDialog(title: string, message: string, confirmLabel: string): Promise<boolean> {
    return this.openDialog(title, (body, done) => {
      body.append(el('p', { style: 'white-space:pre-line' }, message));
      const confirm = el('button', { class: 'danger', type: 'button' }, confirmLabel);
      confirm.addEventListener('click', () => done(true));
      const cancel = el('button', { type: 'button' }, 'Cancel');
      cancel.addEventListener('click', () => done(false));
      body.append(el('div', { class: 'actions' }, confirm, cancel));
    }).then(result => result === true);
  }

  private setBusy(form: HTMLFormElement, busy: boolean): void {
    for (const button of Array.from(form.querySelectorAll('button'))) {
      if (button.getAttribute('type') !== 'button') {
        button.disabled = busy;
      }
    }
  }

  // ----- Credentials --------------------------------------------------------

  private async credentialDialog(existing: CredentialInfo | null): Promise<void> {
    await this.formDialog(existing === null ? 'New credential' : `Edit credential ${existing.name}`, (form, done, fail) => {
      const name = el('input', { type: 'text', name: 'name', required: true });
      if (existing !== null) name.value = existing.name;
      const mode = el('select', { name: 'mode' });
      mode.append(el('option', { value: CredentialMode.Token }, 'Token (static secret)'));
      mode.append(el('option', { value: CredentialMode.Oauth }, 'OAuth (renewable, GitLab)'));
      mode.value = existing === null ? CredentialMode.Token : existing.mode;
      const forge = el('select', { name: 'forge' });
      for (const kind of [ForgeKind.Github, ForgeKind.Gitlab]) {
        const option = el('option', { value: kind }, kind);
        if (existing !== null && existing.forge === kind) option.setAttribute('selected', '');
        forge.append(option);
      }
      const host = el('input', { type: 'text', name: 'host', required: true });
      if (existing !== null) host.value = existing.host;
      // Write-only tokens: always blank, never prefilled, never displayed.
      const secret = el('input', { type: 'password', name: 'secret', autocomplete: 'new-password', required: true });
      const secretLabel = el('span', null, 'Secret (write-only, never displayed)');
      const basicFields = el('div', { class: 'fields' }, null);
      basicFields.append(
        el('label', null, 'Mode', mode, el('small', null, 'OAuth credentials renew automatically; only supported for GitLab.')),
        el('label', null, 'Name', name),
        el('label', null, 'Forge', forge),
        el('label', null, 'Host', host),
        el('label', null, secretLabel, secret, el('small', null, existing === null ? 'Stored once, never retrievable.' : 'Re-enter the token: it is write-only.')),
      );

      const client = el('select', { name: 'oauthClientId' });
      for (const candidate of this.oauthClients) {
        if (candidate.forge !== ForgeKind.Gitlab) continue;
        client.append(el('option', { value: candidate.id }, `${candidate.label} (${candidate.host})`));
      }
      if (existing !== null && existing.oauthClientId !== undefined) client.value = existing.oauthClientId;
      const refreshToken = el('input', { type: 'password', name: 'refreshToken', autocomplete: 'new-password' });
      const expiresAt = el('input', { type: 'text', name: 'expiresAt', placeholder: '2026-12-01T00:00:00Z' });
      if (existing !== null && existing.expiresAt !== undefined) expiresAt.value = existing.expiresAt;
      const oauthFields = el('div', { class: 'fields' }, null);
      oauthFields.append(
        el('label', null, 'OAuth client', client, el('small', null, 'Operator-configured client; referenced by id only.')),
        el('label', null, 'Refresh token (write-only, never displayed)', refreshToken, el('small', null, 'Used for automatic renewal; never retrievable.')),
        el('label', null, 'Access token expiry (UTC)', expiresAt, el('small', null, 'ISO 8601 instant, e.g. 2026-12-01T00:00:00Z.')),
      );

      const applyMode = (): void => {
        const isOauth = mode.value === CredentialMode.Oauth;
        if (isOauth) {
          // OAuth credentials are GitLab-only; the forge is locked.
          forge.value = ForgeKind.Gitlab;
          forge.setAttribute('disabled', '');
        } else {
          forge.removeAttribute('disabled');
        }
        oauthFields.setAttribute('data-oauth', isOauth ? 'on' : 'off');
        oauthFields.style.display = isOauth ? '' : 'none';
        if (isOauth) refreshToken.setAttribute('required', '');
        else refreshToken.removeAttribute('required');
        secretLabel.textContent = isOauth ? 'Access token (write-only, never displayed)' : 'Secret (write-only, never displayed)';
      };
      mode.addEventListener('change', applyMode);
      applyMode();

      const submit = el('button', { class: 'primary', type: 'submit' }, existing === null ? 'Create' : 'Save');
      form.append(basicFields, oauthFields, submit);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        fail('');
        const isOauth = mode.value === CredentialMode.Oauth;
        if (name.value.trim() === '' || host.value.trim() === '' || secret.value === '') {
          fail('All fields are required.');
          return;
        }
        if (isOauth) {
          if (client.value === '') {
            fail('No OAuth client is configured for GitLab; ask the operator.');
            return;
          }
          if (refreshToken.value === '') {
            fail('A refresh token is required for OAuth credentials.');
            return;
          }
        }
        this.setBusy(form, true);
        try {
          const payload = new SaveCredentialRequest(
            existing === null ? undefined : existing.id,
            name.value.trim(),
            forge.value === ForgeKind.Gitlab ? ForgeKind.Gitlab : ForgeKind.Github,
            host.value.trim(),
            secret.value,
            existing === null ? 0 : existing.revision,
            isOauth ? CredentialMode.Oauth : CredentialMode.Token,
            isOauth ? client.value : undefined,
            isOauth ? refreshToken.value : undefined,
            isOauth && expiresAt.value.trim() !== '' ? expiresAt.value.trim() : undefined,
          );
          const result = await this.saveCredential(payload);
          // Clear both write-only tokens immediately after a successful submit.
          secret.value = '';
          refreshToken.value = '';
          await this.refreshCredentials();
          this.renderCredRegion(true);
          done(result);
          this.showNotice(`Credential saved (revision ${result.credential.revision}).`, null);
        } catch (error) {
          if (error instanceof StaleResponseError) return;
          if (error instanceof IdentityMismatchError) {
            this.identityLost();
            return;
          }
          if (error instanceof ApiError && error.status === 401) {
            this.authLost();
            return;
          }
          if (error instanceof ApiError && error.status === 409) {
            secret.value = '';
            refreshToken.value = '';
            done(null);
            this.conflictNotice('credential');
            await this.refreshCredentials();
            this.renderCredRegion(true);
            return;
          }
          fail(describeError(error));
        } finally {
          this.setBusy(form, false);
        }
      });
    });
  }

  private async deleteCredentialFlow(cred: CredentialInfo): Promise<void> {
    const ok = await this.confirmDialog(
      `Delete credential ${cred.name}`,
      `Delete credential ${cred.name} (${cred.forge}, ${cred.host})?\nRepositories using it will stop working.`,
      'Delete credential',
    );
    if (!ok) return;
    try {
      await this.deleteCredential(cred.id, cred.revision);
    } catch (error) {
      if (error instanceof StaleResponseError) return;
      if (error instanceof IdentityMismatchError) {
        this.identityLost();
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        this.authLost();
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        this.conflictNotice('credential');
      } else if (error instanceof ApiError && error.status === 404) {
        this.showNotice('Credential was already deleted elsewhere.\nThe list has been refreshed.', null);
      } else {
        this.showNotice(`Delete failed.\n${describeError(error)}`, null);
      }
    }
    await this.refreshCredentials();
    this.renderCredRegion(true);
  }

  // ----- Repositories -------------------------------------------------------

  private async repoDialog(existing: RepositoryInfo | null): Promise<void> {
    await this.formDialog(existing === null ? 'New repository' : `Edit repository ${existing.id}`, (form, done, fail) => {
      const id = el('input', { type: 'text', name: 'id', required: true });
      if (existing !== null) {
        id.value = existing.id; // IDs are immutable when editing
        id.setAttribute('readonly', '');
      }
      const forge = el('select', { name: 'forge' });
      for (const kind of [ForgeKind.Github, ForgeKind.Gitlab]) {
        const option = el('option', { value: kind }, kind);
        if (existing !== null && existing.forge === kind) option.setAttribute('selected', '');
        forge.append(option);
      }
      const host = el('input', { type: 'text', name: 'host', required: true });
      if (existing !== null) host.value = existing.host;
      const project = el('input', { type: 'text', name: 'project', required: true });
      if (existing !== null) project.value = existing.project;
      const baseBranch = el('input', { type: 'text', name: 'baseBranch', required: true });
      if (existing !== null) baseBranch.value = existing.baseBranch;
      const credential = el('select', { name: 'credentialId' });
      for (const cred of this.credentials) {
        const option = el('option', { value: cred.id }, `${cred.name} (${cred.forge}, ${cred.host})`);
        if (existing !== null && existing.credentialId === cred.id) option.setAttribute('selected', '');
        credential.append(option);
      }
      const fields = el('div', { class: 'fields' }, null);
      fields.append(
        el('label', null, 'Repository ID', id, el('small', null, existing === null ? 'Stable identifier; cannot be changed later.' : 'Immutable.')),
        el('label', null, 'Forge', forge),
        el('label', null, 'Host', host),
        el('label', null, 'Project', project),
        el('label', null, 'Base branch', baseBranch),
        el('label', null, 'Credential (your own only)', credential, el('small', null, 'Only credentials you own can be bound.')),
      );
      const submit = el('button', { class: 'primary', type: 'submit' }, existing === null ? 'Create' : 'Save');
      form.append(fields, submit);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        fail('');
        if (this.credentials.length === 0) {
          fail('Create a credential first: a repository must be bound to one of your own credentials.');
          return;
        }
        if (id.value.trim() === '' || host.value.trim() === '' || project.value.trim() === '' || baseBranch.value.trim() === '') {
          fail('All fields are required.');
          return;
        }
        this.setBusy(form, true);
        try {
          const payload = new SaveRepositoryRequest(
            id.value.trim(),
            forge.value === ForgeKind.Gitlab ? ForgeKind.Gitlab : ForgeKind.Github,
            host.value.trim(),
            project.value.trim(),
            baseBranch.value.trim(),
            credential.value,
            existing === null ? 0 : existing.revision,
          );
          const result = await this.saveRepository(payload);
          await this.refreshRepositories();
          this.renderRepoRegion(true);
          done(result);
          this.showNotice(`Repository saved (revision ${result.repository.revision}).`, null);
        } catch (error) {
          if (error instanceof StaleResponseError) return;
          if (error instanceof IdentityMismatchError) {
            this.identityLost();
            return;
          }
          if (error instanceof ApiError && error.status === 401) {
            this.authLost();
            return;
          }
          if (error instanceof ApiError && error.status === 409) {
            done(null);
            this.conflictNotice('repository');
            await this.refreshRepositories();
            this.renderRepoRegion(true);
            return;
          }
          fail(describeError(error));
        } finally {
          this.setBusy(form, false);
        }
      });
    });
  }

  private async deleteRepositoryFlow(repo: RepositoryInfo): Promise<void> {
    const ok = await this.confirmDialog(
      `Delete repository ${repo.id}`,
      `Delete repository ${repo.id} (${repo.host}/${repo.project})?\nIts rites and their run history are not recoverable.`,
      'Delete repository',
    );
    if (!ok) return;
    try {
      await this.deleteRepository(repo.id, repo.revision);
    } catch (error) {
      if (error instanceof StaleResponseError) return;
      if (error instanceof IdentityMismatchError) {
        this.identityLost();
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        this.authLost();
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        this.conflictNotice('repository');
      } else {
        this.showNotice(`Delete failed.\n${describeError(error)}`, null);
      }
    }
    await this.refreshRepositories();
    this.renderRepoRegion(true);
  }

  // ----- Grants -------------------------------------------------------------

  private async grantsDialog(initial: RepositoryInfo): Promise<void> {
    const stored = this.repositoryById(initial.id);
    let repo: RepositoryInfo = stored === null ? initial : stored;
    const dialogRepo: RepositoryInfo = repo;
    await this.openDialog(`Grants for ${dialogRepo.id}`, (body, done) => {
      const render = (): void => {
        body.replaceChildren();
        const wrap = el('div', { class: 'table-wrap' }, null);
        const table = el('table', { 'aria-label': 'Repository grants' }, null);
        table.append(el('thead', null, el('tr', null,
          el('th', null, 'User'),
          el('th', null, 'Role'),
          el('th', null, 'Change'),
        )));
        const tableBody = el('tbody', null, null);
        for (const grant of repo.grants) {
          const change = el('div', { class: 'actions' }, null);
          if (grant.role === GrantRole.Owner) {
            change.append(muted('Owner is immutable'));
          } else {
            const roleSelect = el('select', { 'aria-label': `Role for ${grant.login}` });
            for (const role of [GrantRole.Editor, GrantRole.Viewer]) {
              const option = el('option', { value: role }, role);
              if (grant.role === role) option.setAttribute('selected', '');
              roleSelect.append(option);
            }
            const apply = el('button', { type: 'button' }, 'Apply');
            apply.addEventListener('click', () => {
              apply.disabled = true;
              void this.applyGrant(repo, grant, roleSelect.value === GrantRole.Editor ? GrantRole.Editor : GrantRole.Viewer, updated => {
                repo = updated;
                render();
              }).finally(() => {
                apply.disabled = false;
              });
            });
            const remove = el('button', { type: 'button', class: 'danger' }, 'Remove');
            remove.addEventListener('click', () => {
              remove.disabled = true;
              void this.applyGrant(repo, grant, undefined, updated => {
                repo = updated;
                render();
              }).finally(() => {
                remove.disabled = false;
              });
            });
            change.append(roleSelect, apply, remove);
          }
          tableBody.append(el('tr', null,
            el('td', null, grant.login),
            el('td', null, badge(grant.role)),
            el('td', null, change),
          ));
        }
        table.append(tableBody);
        wrap.append(table);
        body.append(wrap);

        const grantedIds = new Set(repo.grants.map(g => g.userId));
        const candidates = this.users.filter(u => !grantedIds.has(u.id));
        if (candidates.length > 0) {
          const userSelect = el('select', { 'aria-label': 'User to grant' });
          for (const user of candidates) {
            userSelect.append(el('option', { value: user.id }, user.login));
          }
          const roleSelect = el('select', { 'aria-label': 'Role for new grant' });
          for (const role of [GrantRole.Editor, GrantRole.Viewer]) {
            roleSelect.append(el('option', { value: role }, role));
          }
          const add = el('button', { type: 'button', class: 'primary' }, 'Add grant');
          add.addEventListener('click', () => {
            add.disabled = true;
            const chosen = this.users.find(u => u.id === userSelect.value);
            if (chosen === undefined) return;
            void this.addGrant(repo, chosen, roleSelect.value === GrantRole.Editor ? GrantRole.Editor : GrantRole.Viewer, updated => {
              repo = updated;
              render();
            }).finally(() => {
              add.disabled = false;
            });
          });
          const row = el('div', { class: 'actions' }, null);
          row.append(userSelect, roleSelect, add);
          body.append(row);
        }
        const close = el('button', { type: 'button' }, 'Done');
        close.addEventListener('click', () => done(true));
        body.append(el('div', { class: 'actions' }, close));
      };
      render();
    });
  }

  private async applyGrant(
    repo: RepositoryInfo,
    grant: GrantInfo,
    role: GrantRole | undefined,
    onUpdate: (updated: RepositoryInfo) => void,
  ): Promise<void> {
    try {
      // role undefined encodes null, which removes a non-owner grant
      const result = await this.setGrant(new SetGrantRequest(repo.id, grant.userId, role, repo.revision));
      if (result.repository.id === repo.id) {
        this.upsertRepository(result.repository);
        onUpdate(result.repository);
      }
    } catch (error) {
      this.handleGrantError(error);
    }
  }

  private async addGrant(
    repo: RepositoryInfo,
    user: UserInfo,
    role: GrantRole,
    onUpdate: (updated: RepositoryInfo) => void,
  ): Promise<void> {
    try {
      const result = await this.setGrant(new SetGrantRequest(repo.id, user.id, role, repo.revision));
      this.upsertRepository(result.repository);
      onUpdate(result.repository);
    } catch (error) {
      this.handleGrantError(error);
    }
  }

  private handleGrantError(error: unknown): void {
    if (error instanceof StaleResponseError) return;
    if (error instanceof IdentityMismatchError) {
      this.identityLost();
      return;
    }
    if (error instanceof ApiError && error.status === 401) {
      this.authLost();
      return;
    }
    if (error instanceof ApiError && error.status === 409) {
      this.conflictNotice('repository grants');
      void this.refreshRepositories().then(() => this.renderRepoRegion(false));
      return;
    }
    this.showNotice(`Grant change failed.\n${describeError(error)}`, null);
  }

  private upsertRepository(repo: RepositoryInfo): void {
    const index = this.repositories.findIndex(r => r.id === repo.id);
    if (index === -1) this.repositories.push(repo);
    else this.repositories[index] = repo;
  }

  // ----- Rites --------------------------------------------------------------

  private async riteDialog(repo: RepositoryInfo, existing: RiteInfo | null): Promise<void> {
    await this.formDialog(existing === null ? `New rite for ${repo.id}` : `Edit rite ${existing.id}`, (form, done, fail) => {
      const id = el('input', { type: 'text', name: 'id', required: true });
      if (existing !== null) {
        id.value = existing.id; // immutable when editing
        id.setAttribute('readonly', '');
      }
      const schedule = el('input', { type: 'text', name: 'schedule', required: true });
      if (existing !== null) schedule.value = existing.schedule;
      const promptPath = el('input', { type: 'text', name: 'promptPath', required: true });
      if (existing !== null) promptPath.value = existing.promptPath;
      const model = el('select', { name: 'modelId' });
      for (const m of this.models) {
        const option = el('option', { value: m.id }, `${m.provider}/${m.model}${m.thinkingLevel === '' ? '' : ` (${m.thinkingLevel})`}`);
        if (existing !== null && existing.modelId === m.id) option.setAttribute('selected', '');
        model.append(option);
      }
      const enabled = el('input', { type: 'checkbox', name: 'enabled' });
      enabled.checked = existing === null ? true : existing.enabled;
      const fields = el('div', { class: 'fields' }, null);
      fields.append(
        el('label', null, 'Rite ID', id, el('small', null, existing === null ? 'Stable identifier; cannot be changed later.' : 'Immutable.')),
        el('label', null, 'Schedule (UTC cron)', schedule, el('small', null, 'Five space-separated fields, evaluated in UTC, e.g. 0 9 * * 1-5.')),
        el('label', null, 'Prompt path', promptPath),
        el('label', null, 'Model', model),
        el('label', null, el('span', null, 'Enabled'), enabled),
      );
      const submit = el('button', { class: 'primary', type: 'submit' }, existing === null ? 'Create' : 'Save');
      form.append(fields, submit);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        fail('');
        if (id.value.trim() === '' || schedule.value.trim() === '' || promptPath.value.trim() === '') {
          fail('All fields are required.');
          return;
        }
        this.setBusy(form, true);
        try {
          const payload = new SaveRiteRequest(
            repo.id,
            id.value.trim(),
            schedule.value.trim(),
            promptPath.value.trim(),
            model.value,
            enabled.checked,
            existing === null ? 0 : existing.revision,
          );
          const result = await this.saveRite(payload);
          await this.refreshRites(repo.id);
          this.renderRitesRegion(true);
          done(result);
          this.showNotice(`Rite saved (revision ${result.rite.revision}).`, null);
        } catch (error) {
          if (error instanceof StaleResponseError) return;
          if (error instanceof IdentityMismatchError) {
            this.identityLost();
            return;
          }
          if (error instanceof ApiError && error.status === 401) {
            this.authLost();
            return;
          }
          if (error instanceof ApiError && error.status === 409) {
            done(null);
            this.conflictNotice('rite');
            await this.refreshRites(repo.id);
            this.renderRitesRegion(true);
            return;
          }
          fail(describeError(error));
        } finally {
          this.setBusy(form, false);
        }
      });
    });
  }

  private async deleteRiteFlow(repositoryId: string, rite: RiteInfo): Promise<void> {
    const ok = await this.confirmDialog(
      `Delete rite ${rite.id}`,
      `Delete rite ${rite.id} from repository ${repositoryId}?`,
      'Delete rite',
    );
    if (!ok) return;
    try {
      await this.deleteRite(repositoryId, rite.id, rite.revision);
    } catch (error) {
      if (error instanceof StaleResponseError) return;
      if (error instanceof IdentityMismatchError) {
        this.identityLost();
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        this.authLost();
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        this.conflictNotice('rite');
      } else {
        this.showNotice(`Delete failed.\n${describeError(error)}`, null);
      }
    }
    await this.refreshRites(repositoryId);
    this.renderRitesRegion(true);
  }

  // ----- Boot + polling -----------------------------------------------------

  private async loadVersion(): Promise<void> {
    try {
      this.version = await this.getVersion();
    } catch {
      this.version = null;
    }
  }

  private async enterApp(): Promise<void> {
    try {
      await this.loadCore();
      this.phase = 'app';
      this.render();
      await this.refreshStatus();
      this.renderStatusRegion(false);
    } catch (error) {
      if (error instanceof StaleResponseError) return;
      if (error instanceof IdentityMismatchError) {
        this.identityLost();
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        this.authLost();
        return;
      }
      this.listError = describeError(error);
      this.phase = 'load-failed';
      this.render();
    }
  }

  private async boot(): Promise<void> {
    this.generation += 1;
    this.phase = 'connecting';
    this.render();
    try {
      const me = await this.getMe();
      this.me = me;
      this.phase = 'loading';
      this.render();
      await this.enterApp();
    } catch (error) {
      if (error instanceof StaleResponseError) return;
      if (error instanceof IdentityMismatchError) {
        this.identityLost();
        return;
      }
      if (error instanceof ApiError && error.status === 401) {
        this.me = null;
        this.phase = 'login';
        await this.loadVersion();
        this.render();
        return;
      }
      this.phase = 'unreachable';
      await this.loadVersion();
      this.render();
    }
  }

  private async tick(): Promise<void> {
    if (this.phase !== 'app' || document.hidden || this.polling) return;
    this.polling = true;
    try {
      if (this.view === 'repositories') {
        await this.refreshStatus();
        this.renderStatusRegion(false);
        await this.refreshRepositories();
        this.renderRepoRegion(false);
      } else if (this.view === 'rites' && this.activeRepoId !== null) {
        await this.refreshRites(this.activeRepoId);
        this.renderRitesRegion(false);
        if (this.historyRiteId !== null) {
          await this.refreshRuns(this.activeRepoId, this.historyRiteId);
          this.renderRunsRegion(false);
        }
      }
    } finally {
      this.polling = false;
    }
  }
}

// Bootstrap with explicit dependency injection.
const browserTransport: AppTransport = {
  fetch: (input: string, init: RequestInit) => window.fetch(input, init),
};
const browserScheduler: AppScheduler = {
  every: (handler: () => void, ms: number) => {
    window.setInterval(handler, ms);
  },
};
const browserUuid: AppUuid = {
  random: () => window.crypto.randomUUID(),
};
const application = new Application(
  browserTransport,
  browserScheduler,
  browserUuid,
);
application.start();
