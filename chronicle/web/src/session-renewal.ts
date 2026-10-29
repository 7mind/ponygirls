import { BaboonCodecContext, UserInfo_JsonCodec, type UserInfo } from './api.ts';
import type { Lifecycle, Scheduler } from './transport/types.ts';

export interface SessionScope { accountId: string; generation: number; activeId: number }
export interface RenewalDependencies {
  fetch: typeof fetch;
  scheduler: Scheduler;
  lifecycle: Lifecycle;
  error(message: string | null): void;
  unauthorized(): void;
  accountChanged(): void;
}
const DAY = 86_400_000;
const REQUEST_TIMEOUT = 15_000;
export function renewalDelay(header: string | null): number {
  if (header === null || !/^[1-9][0-9]*$/.test(header)) throw new Error('Session renewal returned an invalid TTL header');
  const ttl = Number(header);
  if (!Number.isSafeInteger(ttl) || ttl > 2_147_483_647) throw new Error('Session renewal returned an invalid TTL header');
  return Math.min(DAY, ttl * 500);
}

/** Cookie-only renewal. Availability failures stop until an explicit retry or a new verified connection. */
export class SessionRenewal {
  private scope: SessionScope | null = null;
  private epoch = 0;
  private due = Infinity;
  private timer: number | null = null;
  private request: AbortController | null = null;
  private disposed = false;
  private paused = false;
  private readonly unsubscribe: () => void;
  constructor(private readonly deps: RenewalDependencies) {
    this.unsubscribe = deps.lifecycle.subscribe(event => {
      if (event === 'hidden' || event === 'freeze' || event === 'pagehide') { this.paused = true; this.cancel(); }
      else if (event === 'visible' || event === 'focus' || event === 'resume' || event === 'pageshow') { this.paused = false; this.schedule(); }
    });
  }
  setScope(scope: SessionScope | null): void {
    if (this.disposed) return;
    if (scope?.accountId === this.scope?.accountId && scope?.generation === this.scope?.generation && scope?.activeId === this.scope?.activeId) return;
    this.cancel(); this.scope = scope; this.due = scope === null ? Infinity : this.deps.scheduler.now();
    this.deps.error(null); this.schedule();
  }
  retry(): void {
    if (this.disposed || this.scope === null || this.request !== null) return;
    this.due = this.deps.scheduler.now(); this.schedule();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel(); this.scope = null; this.unsubscribe();
  }
  private cancel(): void {
    this.epoch++;
    if (this.timer !== null) this.deps.scheduler.clearTimeout(this.timer);
    this.timer = null; this.request?.abort();
  }
  private schedule(): void {
    if (this.disposed || this.paused || this.deps.lifecycle.hidden() || this.scope === null || this.request !== null || this.timer !== null || this.due === Infinity) return;
    const delay = this.due - this.deps.scheduler.now();
    if (delay <= 0) { void this.renew(); return; }
    this.timer = this.deps.scheduler.setTimeout(() => { this.timer = null; this.schedule(); }, Math.min(DAY, delay));
  }
  private async refresh(signal: AbortSignal): Promise<{ user: UserInfo; delay: number } | null> {
    const response = await this.deps.fetch('/api/session/refresh', { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Session renewal unavailable (HTTP ${response.status})`);
    const delay = renewalDelay(response.headers.get('X-Chronicle-Session-Ttl-Seconds'));
    return { user: UserInfo_JsonCodec.instance.decode(BaboonCodecContext.Default, await response.json()), delay };
  }
  private async renew(): Promise<void> {
    const scope = this.scope!;
    const epoch = this.epoch, controller = new AbortController(); this.request = controller;
    const current = () => !this.disposed && epoch === this.epoch && !this.paused && !this.deps.lifecycle.hidden();
    let timeout = 0;
    try {
      const result = await Promise.race([
        this.refresh(controller.signal),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new Error('Session renewal cancelled')), { once: true });
          timeout = this.deps.scheduler.setTimeout(() => { reject(new Error('Session renewal timed out')); controller.abort(); }, REQUEST_TIMEOUT);
        }),
      ]);
      if (!current()) return;
      if (result === null) { this.due = Infinity; this.scope = null; this.deps.error(null); this.deps.unauthorized(); return; }
      if (result.user.id !== scope.accountId) { this.due = Infinity; this.scope = null; this.deps.error(null); this.deps.accountChanged(); return; }
      this.due = this.deps.scheduler.now() + result.delay; this.deps.error(null);
    } catch (cause) {
      if (current()) {
        this.due = Infinity;
        this.deps.error(cause instanceof Error ? cause.message : 'Session renewal unavailable');
      }
    } finally {
      this.deps.scheduler.clearTimeout(timeout); this.request = null; this.schedule();
    }
  }
}
