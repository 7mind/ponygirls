/** One in-memory write lane per authenticated browser session. An ambiguous
 * response never grants permission to mint a new operation ID or alter bytes.
 * The lane survives component/navigation changes, but not logout/auth loss.
 */
export interface WriteOperation {
  readonly key: string;
  readonly documentJson: string;
  readonly expectedRevision: number;
  readonly requestId: string;
}
export class PendingWriteBlocked extends Error {
  constructor() { super("An uncertain write must be replayed before a different write can be sent."); this.name = "PendingWriteBlocked"; }
}
export class WriteCoordinator<T> {
  private pending: Readonly<WriteOperation> | undefined;
  private flight: Promise<T> | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly send: (op: WriteOperation) => Promise<T>;
  private readonly terminal: (error: unknown) => boolean;
  constructor(send: (op: WriteOperation) => Promise<T>, terminal: (error: unknown) => boolean) { this.send = send; this.terminal = terminal; }
  snapshot = (): Readonly<WriteOperation> | undefined => this.pending;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(): void { for (const listener of this.listeners) listener(); }
  clear(): void { this.pending = undefined; this.flight = undefined; this.publish(); }
  execute(operation: WriteOperation): Promise<T> {
    if (this.pending && (this.pending.key !== operation.key || this.pending.documentJson !== operation.documentJson ||
        this.pending.expectedRevision !== operation.expectedRevision)) return Promise.reject(new PendingWriteBlocked());
    if (!this.pending) { this.pending = Object.freeze({ ...operation }); this.publish(); }
    return this.retry();
  }
  retry(): Promise<T> {
    if (this.flight) return this.flight;
    const operation = this.pending;
    if (!operation) return Promise.reject(new Error("No pending write"));
    const flight = Promise.resolve().then(() => this.send(operation)).then((result) => {
      if (this.pending === operation) this.clear();
      return result;
    }, (error: unknown) => {
      if (this.pending === operation) {
        this.flight = undefined;
        if (this.terminal(error)) this.clear(); else this.publish();
      }
      throw error;
    });
    this.flight = flight;
    return flight;
  }
}
