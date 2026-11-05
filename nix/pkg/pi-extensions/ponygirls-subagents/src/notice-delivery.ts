import { sanitizeDisplay } from "./display.ts";

export const CUSTOM_NOTICE = "pi-subagents-notice";
const NOTICE_BATCH = 20;
const NOTICE_TEXT_MAX = 48_000;
const NOTICE_RETRY_DELAY_MS = 100;
const NOTICE_MAX_ATTEMPTS = 3;

export interface NoticeSource {
  noticesSince(cursor: number, limit: number): { lines: string[]; cursor: number };
}

export interface NoticeMessage {
  customType: typeof CUSTOM_NOTICE;
  content: Array<{ type: "text"; text: string }>;
  display: true;
  details: { schemaVersion: 1; cursor: number; volatile?: true };
}

export interface NoticeSink {
  /** Returning transfers ownership to Pi; throwing leaves the page with this pump. */
  submit(message: NoticeMessage): void;
  error(error: unknown): void;
}

/** One attachment's journal cursor; submission is not a durable session receipt. */
export class NoticeDelivery {
  private cursor: number;
  private scheduled = false;
  private disposed = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly source: NoticeSource;
  private sink: NoticeSink;
  private attached = true;
  private pendingFailure: string | null = null;
  private deliveredFailure: string | null = null;

  constructor(source: NoticeSource, sink: NoticeSink, cursor: number) {
    this.source = source;
    this.sink = sink;
    this.cursor = cursor;
  }

  /** Out-of-band health: never invent a journal sequence for an unwritable store. */
  storageFailed(message: string): void {
    if (this.disposed || message === this.deliveredFailure || message === this.pendingFailure) return;
    this.pendingFailure = message;
    this.changed();
  }

  changed(): void {
    if (this.scheduled || this.disposed || !this.attached) return;
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.scheduled = true;
    // Publishing a journal record may still be updating supervisor state.
    queueMicrotask(() => {
      try {
        while (!this.disposed && this.attached) {
          if (this.pendingFailure !== null) {
            const failure = this.pendingFailure;
            this.sink.submit({
              customType: CUSTOM_NOTICE,
              content: [{ type: "text", text: sanitizeDisplay(`[subagents: volatile storage failure]\nSTORE_FAILED: ${failure}`, NOTICE_TEXT_MAX) }],
              display: true,
              details: { schemaVersion: 1, cursor: this.cursor, volatile: true },
            });
            this.deliveredFailure = failure;
            this.pendingFailure = null;
          }
          const { lines, cursor } = this.source.noticesSince(this.cursor, NOTICE_BATCH);
          if (lines.length > 0) {
            this.sink.submit({
              customType: CUSTOM_NOTICE,
              content: [{ type: "text", text: sanitizeDisplay(`[subagents]\n${lines.join("\n")}`, NOTICE_TEXT_MAX) }],
              display: true,
              details: { schemaVersion: 1, cursor },
            });
          }
          this.cursor = cursor;
          this.failures = 0;
          if (lines.length === 0) break;
        }
      } catch (error) {
        try { this.sink.error(error); }
        catch (reporterError) { console.error("subagents: notice delivery error reporter failed:", error, reporterError); }
        this.failures++;
        if (this.failures < NOTICE_MAX_ATTEMPTS && !this.disposed && this.attached) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            this.changed();
          }, NOTICE_RETRY_DELAY_MS);
        }
      } finally {
        this.scheduled = false;
      }
    });
  }

  detach(): void {
    this.attached = false;
    if (this.retryTimer !== undefined) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  attach(sink: NoticeSink): void {
    if (this.disposed) return;
    this.sink = sink;
    this.attached = true;
    this.failures = 0;
    this.changed();
  }

  dispose(): void {
    this.disposed = true;
    this.detach();
  }
}
