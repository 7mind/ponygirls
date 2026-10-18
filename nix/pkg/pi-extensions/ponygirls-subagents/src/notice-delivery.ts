import { sanitizeDisplay } from "./display.ts";

const CUSTOM_NOTICE = "pi-subagents-notice";
const NOTICE_BATCH = 20;
const NOTICE_TEXT_MAX = 48_000;

export interface NoticeSource {
  noticesSince(cursor: number, limit: number): { lines: string[]; cursor: number };
}

export interface NoticeMessage {
  customType: typeof CUSTOM_NOTICE;
  content: Array<{ type: "text"; text: string }>;
  display: true;
  details: { schemaVersion: 1; cursor: number };
}

export interface NoticeSink {
  /** Context-only delivery: Pi appends now if idle, or after the active turn's tool results. */
  submit(message: NoticeMessage): void;
  error(error: unknown): void;
}

/** One attachment's journal cursor; submission is not a durable session receipt. */
export class NoticeDelivery {
  private cursor: number;
  private scheduled = false;
  private disposed = false;
  private readonly source: NoticeSource;
  private readonly sink: NoticeSink;

  constructor(source: NoticeSource, sink: NoticeSink, cursor: number) {
    this.source = source;
    this.sink = sink;
    this.cursor = cursor;
  }

  changed(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    // Publishing a journal record may still be updating supervisor state.
    queueMicrotask(() => {
      try {
        while (!this.disposed) {
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
          if (lines.length === 0) break;
        }
      } catch (error) {
        // Keep the failed page for the next change; never spin on a rejected sink.
        this.sink.error(error);
      } finally {
        this.scheduled = false;
      }
    });
  }

  dispose(): void {
    this.disposed = true;
  }
}
