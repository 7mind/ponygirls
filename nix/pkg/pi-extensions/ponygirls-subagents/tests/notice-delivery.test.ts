import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { NoticeDelivery, type NoticeMessage, type NoticeSink, type NoticeSource } from "../src/notice-delivery.ts";

class Journal implements NoticeSource {
  private readonly lines: Array<string | null> = [];

  append(line: string | null): void { this.lines.push(line); }

  noticesSince(cursor: number, limit: number): { lines: string[]; cursor: number } {
    const lines: string[] = [];
    while (cursor < this.lines.length) {
      const line = this.lines[cursor]!;
      if (line !== null && lines.length === limit) break;
      cursor++;
      if (line !== null) lines.push(line);
    }
    return { lines, cursor };
  }
}

class Sink implements NoticeSink {
  readonly messages: NoticeMessage[] = [];
  readonly errors: unknown[] = [];
  reject = false;
  submit(message: NoticeMessage): void {
    if (this.reject) throw new Error("fixture rejection");
    this.messages.push(message);
  }
  error(error: unknown): void { this.errors.push(error); }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

test("journal changes coalesce, drain every page, and do not redeliver on later changes", async () => {
  const journal = new Journal();
  const sink = new Sink();
  const delivery = new NoticeDelivery(journal, sink, 0);
  for (let i = 0; i < 47; i++) {
    journal.append(`notice ${i}`);
    journal.append(null);
    delivery.changed();
  }
  assert.equal(sink.messages.length, 0, "publication must not re-enter the supervisor");
  await tick();
  assert.equal(sink.messages.length, 3);
  assert.deepEqual(sink.messages.flatMap((m) => m.content[0]!.text.split("\n").slice(1)), Array.from({ length: 47 }, (_, i) => `notice ${i}`));
  assert.equal(sink.messages.at(-1)!.details.cursor, 94);
  delivery.changed();
  await tick();
  assert.equal(sink.messages.length, 3);
});

test("an attachment starts after its history, including when the first change has no notice", async () => {
  const journal = new Journal();
  const sink = new Sink();
  journal.append("old notice");
  const delivery = new NoticeDelivery(journal, sink, 1);
  journal.append(null);
  delivery.changed();
  await tick();
  assert.equal(sink.messages.length, 0);
  journal.append("new notice");
  delivery.changed();
  await tick();
  assert.equal(sink.messages[0]!.content[0]!.text, "[subagents]\nnew notice");
  assert.equal(sink.messages[0]!.details.cursor, 3);
});

test("a synchronous sink rejection is visible and does not skip its page or spin", async () => {
  const journal = new Journal();
  const sink = new Sink();
  const delivery = new NoticeDelivery(journal, sink, 0);
  journal.append("first");
  delivery.changed();
  await tick();
  sink.reject = true;
  journal.append("second");
  delivery.changed();
  await tick();
  assert.equal(sink.messages.length, 1);
  assert.equal(sink.errors.length, 1);
  sink.reject = false;
  delivery.changed();
  await tick();
  assert.deepEqual(sink.messages.map((m) => m.details.cursor), [1, 2]);
  assert.match(sink.messages[1]!.content[0]!.text, /second/);
});

test("a change published during submission is drained without reentrancy or duplication", async () => {
  const journal = new Journal();
  const sink = new Sink();
  const delivery = new NoticeDelivery(journal, {
    submit(message) {
      sink.submit(message);
      if (sink.messages.length === 1) {
        journal.append("arrived during submission");
        delivery.changed();
      }
    },
    error: (error) => sink.error(error),
  }, 0);
  journal.append("first");
  delivery.changed();
  await tick();
  assert.deepEqual(sink.messages.map((m) => m.details.cursor), [1, 2]);
});

test("disposal fences scheduled and future delivery", async () => {
  const journal = new Journal();
  const sink = new Sink();
  const delivery = new NoticeDelivery(journal, sink, 0);
  journal.append("old session");
  delivery.changed();
  delivery.dispose();
  delivery.dispose();
  await tick();
  delivery.changed();
  await tick();
  assert.deepEqual(sink.messages, []);
});

test("a transient rejection retries autonomously without another journal change", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const journal = new Journal();
  const sink = new Sink();
  const delivery = new NoticeDelivery(journal, sink, 0);
  t.after(() => delivery.dispose());
  sink.reject = true;
  journal.append("terminal");
  delivery.changed();
  await tick();
  assert.equal(sink.errors.length, 1);
  sink.reject = false;
  t.mock.timers.tick(100);
  await tick();
  assert.equal(sink.messages.length, 1);
  assert.equal(sink.messages[0]!.details.cursor, 1);
});

test("permanent rejection has a finite retry budget and later activity can retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const journal = new Journal();
  const sink = new Sink();
  const delivery = new NoticeDelivery(journal, sink, 0);
  t.after(() => delivery.dispose());
  sink.reject = true;
  journal.append("terminal");
  delivery.changed();
  await tick();
  for (let i = 0; i < 2; i++) { t.mock.timers.tick(100); await tick(); }
  assert.equal(sink.errors.length, 3);
  t.mock.timers.tick(10_000);
  await tick();
  assert.equal(sink.errors.length, 3, "do not spin or retry indefinitely");
  assert.equal(sink.messages.length, 0);
  sink.reject = false;
  journal.append("later question");
  delivery.changed();
  await tick();
  assert.equal(sink.messages.length, 1);
  assert.equal(sink.messages[0]!.details.cursor, 2);
  assert.match(sink.messages[0]!.content[0]!.text, /terminal\nlater question/);
});

test("rejected later pages retry without replaying an accepted prefix", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const journal = new Journal();
  const sink = new Sink();
  let attempts = 0;
  const delivery = new NoticeDelivery(journal, {
    submit(message) {
      if (++attempts === 2) throw new Error("second page rejected");
      sink.submit(message);
    },
    error: (error) => sink.error(error),
  }, 0);
  t.after(() => delivery.dispose());
  for (let i = 0; i < 47; i++) journal.append(`notice ${i}`);
  delivery.changed();
  await tick();
  assert.deepEqual(sink.messages.map((message) => message.details.cursor), [20]);
  t.mock.timers.tick(100);
  await tick();
  assert.deepEqual(sink.messages.map((message) => message.details.cursor), [20, 40, 47]);
  assert.deepEqual(sink.messages.flatMap((message) => message.content[0]!.text.split("\n").slice(1)), Array.from({ length: 47 }, (_, i) => `notice ${i}`));
});

test("disposal cancels an armed retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const journal = new Journal();
  const sink = new Sink();
  const delivery = new NoticeDelivery(journal, sink, 0);
  sink.reject = true;
  journal.append("old session terminal");
  delivery.changed();
  await tick();
  delivery.dispose();
  sink.reject = false;
  t.mock.timers.tick(1_000);
  await tick();
  assert.equal(sink.errors.length, 1);
  assert.deepEqual(sink.messages, []);
});

test("a throwing error observer cannot terminate ingress retry", () => {
  const moduleUrl = new URL("../src/notice-delivery.ts", import.meta.url).href;
  const program = `
    import { NoticeDelivery } from ${JSON.stringify(moduleUrl)};
    let attempts = 0;
    const delivery = new NoticeDelivery({ noticesSince: (cursor) => ({ lines: cursor === 0 ? ["terminal"] : [], cursor: 1 }) }, {
      submit() { if (++attempts === 1) throw new Error("ingress rejection"); process.stdout.write("delivered"); delivery.dispose(); },
      error() { throw new Error("reporter rejection"); },
    }, 0);
    delivery.changed();
    setTimeout(() => process.exit(2), 1_500).unref();
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { encoding: "utf8", timeout: 5_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "delivered");
});
