/** The /tools command in a real pi session: its text answers, the pane it opens, and the packaged extension file. */
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { initTheme, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { PLAIN_THEME } from "@ponygirls/pi-ui";
import { toolsExplorer } from "../index.ts";
import { assertInert, plain } from "./fixtures.ts";
import { requestedTools, startPiSession, type NotifyLevel, type PiSession, type SessionUi } from "./pi-session.ts";
import { registerProbes } from "./probes.ts";

const WIDTH = 120;
const ESC = "\x1b";
const ENTER = "\r";

interface Pane {
  render(width: number): string[];
  handleInput(data: string): void;
  dispose?(): void;
}

interface Terminal {
  custom: ExtensionUIContext["custom"];
  /** The pane the next `/tools` puts on screen. */
  next(): Promise<Pane>;
}

/** The part of pi's terminal UI the command uses: it mounts what the factory returns until `done` is called. */
function terminal(t: TestContext): Terminal {
  const mounted: Pane[] = [];
  const unclaimed: Pane[] = [];
  const waiting: ((pane: Pane) => void)[] = [];
  t.after(() => { for (const pane of mounted) pane.dispose?.(); });
  const tui = { terminal: { rows: 30 }, requestRender: () => {} };
  const keys = { matches: (data: string, action: string) => action === "tui.select.cancel" && data === ESC };
  const custom = (factory: (...deps: unknown[]) => Pane | Promise<Pane>): Promise<unknown> => new Promise((resolve, reject) => {
    Promise.resolve(factory(tui, PLAIN_THEME, keys, resolve)).then((pane) => {
      mounted.push(pane);
      const claim = waiting.shift();
      if (claim === undefined) unclaimed.push(pane);
      else claim(pane);
    }, reject);
  });
  return {
    custom: custom as unknown as ExtensionUIContext["custom"],
    next: () => {
      const pane = unclaimed.shift();
      return pane === undefined ? new Promise((resolve) => { waiting.push(resolve); }) : Promise.resolve(pane);
    },
  };
}

interface Started extends PiSession {
  /** What the command wrote to the process output. */
  written: string[];
  notified: [string, NotifyLevel][];
}

async function start(t: TestContext, mode: "print" | "rpc" | Terminal): Promise<Started> {
  const written: string[] = [];
  const notified: [string, NotifyLevel][] = [];
  const notify = (message: string, level: NotifyLevel): void => { notified.push([message, level]); };
  const ui: SessionUi = mode === "print" ? { mode } : mode === "rpc" ? { mode, notify } : { mode: "tui", notify, custom: mode.custom };
  const session = await startPiSession(t, {
    extension: (pi) => {
      registerProbes(pi);
      toolsExplorer((text) => { written.push(text); })(pi);
    },
    extensionPaths: [], systemPrompt: null, toolAllowlist: null, ui,
  });
  t.after(() => assert.deepEqual(session.errors, []));
  return { ...session, written, notified };
}

test("the command is registered with a description that fits the command menu", async (t) => {
  const { pi } = await start(t, "rpc");
  const command = pi.getCommands().find((candidate) => candidate.name === "tools");
  assert.ok(command, "the /tools command exists");
  assert.equal(command.description, "Explore tools: state, source, token cost, schema");
  assert.ok(command.description.length <= 60);
  assert.equal(pi.getAllTools().some((tool) => /tools?[-_]explorer/.test(tool.name)), false, "it registers no tool for the model");
});

test("a client without the terminal UI is notified of the summary", async (t) => {
  const { session, notified, written, requests } = await start(t, "rpc");
  await session.prompt("/tools");
  assert.equal(notified.length, 1);
  const [text, level] = notified[0]!;
  assert.equal(level, "info");
  const lines = text.split("\n");
  assert.match(lines[0]!, /^Tools: \d+ registered · \d+ active, ~[\d.]+k? tok \(\d+\.\d% of 100k\) · \d+ inactive, ~[\d.]+k? tok if loaded$/);
  assert.equal(lines[1], "Estimates: 4 characters per token; pi's rule: nothing measured for scripted.");
  assert.match(lines[3]!, /^SOURCE +TOOLS +ACTIVE +ACTIVE TOK +ALL TOK$/);
  assert.ok(lines.some((line) => /^built-in +\d+ +\d+ +~/.test(line)), text);
  assert.deepEqual(written, []);
  assert.equal(requests.length, 0, "the command does not involve the model");
});

test("with words, the command lists the tools that match them", async (t) => {
  const { session, notified } = await start(t, "rpc");
  await session.prompt("/tools   probe_ deferred  ");
  const lines = notified[0]![0].split("\n");
  assert.equal(lines[0]!.replace(/of \d+$/, "of N"), 'Tools matching "probe_ deferred": 1 of N');
  assert.match(lines[3]!, /^TOOL +STATE +TOKENS +SOURCE$/);
  assert.match(lines[4]!, /^probe_deferred +○ deferred +~\d+ +\S/);
  assert.equal(lines.length, 5);
});

test("a print run gets the answer on the process output, since pi drops its notifications", async (t) => {
  const { session, written, notified, ctx } = await start(t, "print");
  assert.equal(ctx.hasUI, false);
  await session.prompt("/tools");
  assert.equal(written.length, 1);
  assert.match(written[0]!, /^Tools: \d+ registered · .*\n[\s\S]*\nbuilt-in +\d+ .*\n[\s\S]*$/);
  assert.ok(written[0]!.endsWith("\n"));
  assert.deepEqual(notified, []);
  await session.prompt("/tools probe_hidden");
  assert.match(written[1]!, /^Tools matching "probe_hidden": 1 of \d+\n/);
  assert.match(written[1]!, /\nprobe_hidden +– hidden +~\d+ /);
});

test("in the terminal UI the command opens the pane over the session's tools, and esc closes it", { timeout: 15_000 }, async (t) => {
  const screen = terminal(t);
  const { session, notified, written } = await start(t, screen);
  const running = session.prompt("/tools");
  const pane = await screen.next();
  const lines = plain(pane.render(WIDTH));
  assert.match(lines[0]!, /^── Tools {3}all \d+ {3}active \d+ {3}inactive \d+ {2}─+ ~[\d.]+k? tok active · \d+\.\d% of 100k ──$/);
  assert.match(lines[1]!, /^ {2}TOOL +STATE +TOKENS +DESCRIPTION$/);
  assert.match(lines[2]!, /^ {2}built-in {2}\d+ tools · \d+ active · /);
  assert.ok(lines.some((line) => /^[▌ ] read +● active +~\d+ +Read the contents of a file/.test(line)), lines.join("\n"));
  assert.ok(lines.some((line) => /^ {2}probe_deferred +○ deferred +~\d+ +A probe tool search can load$/.test(line)), lines.join("\n"));
  pane.handleInput(ESC);
  await running;
  assert.deepEqual([notified, written], [[], []]);
  const again = session.prompt("/tools");
  const second = await screen.next();
  assert.match(plain(second.render(WIDTH))[0]!, /^── Tools /, "the command opens the pane again after it was closed");
  second.handleInput("q");
  await again;
});

test("a tool loaded in the pane is declared by the next request; unloaded, it is dropped", { timeout: 15_000 }, async (t) => {
  const screen = terminal(t);
  const { session, request, requests } = await start(t, screen);
  await request();
  assert.equal(requestedTools(requests[0]!).includes("probe_deferred"), false);
  // The words of the filter, however they were separated: a line break here would not survive the filter's editor.
  const running = session.prompt("/tools   probe_deferred \n A  ");
  const pane = await screen.next();
  const selected = (): string => plain(pane.render(WIDTH)).find((line) => line.startsWith("▌"))!;
  assert.equal(plain(pane.render(WIDTH))[1], `  / probe_deferred A  1 of ${session.getAllTools().length}`);
  pane.handleInput("/");
  assert.equal(plain(pane.render(WIDTH))[1], `  / probe_deferred A   1 of ${session.getAllTools().length}`, "the editor holds the same words, one blank apart");
  pane.handleInput(ENTER);
  assert.equal(plain(pane.render(WIDTH))[1], `  / probe_deferred A  1 of ${session.getAllTools().length}`, "and editing nothing changes nothing");
  assert.match(selected(), /^▌ probe_deferred +○ deferred /);
  pane.handleInput("l");
  assert.match(selected(), /^▌ probe_deferred +● active /);
  assert.ok(session.getActiveToolNames().includes("probe_deferred"));
  pane.handleInput(ENTER);
  assert.equal(plain(pane.render(WIDTH))[1], "  State   active · declared to the model with the next request");
  pane.handleInput(ESC);
  pane.handleInput(ESC);
  pane.handleInput(ESC);
  await running;
  await request();
  assert.equal(requestedTools(requests[1]!).includes("probe_deferred"), true);

  const reopened = session.prompt("/tools probe_deferred");
  const second = await screen.next();
  second.handleInput(ENTER);
  assert.equal(plain(second.render(WIDTH))[1], "  State   active · declared to the model");
  second.handleInput("u");
  assert.equal(plain(second.render(WIDTH))[1], "  State   deferred · still declared to the model · dropped with the next request");
  second.handleInput(ESC);
  second.handleInput(ESC);
  second.handleInput(ESC);
  await reopened;
  await request();
  assert.equal(requestedTools(requests[2]!).includes("probe_deferred"), false);
});

// regression: found in review. Drawing such a row threw inside pi's render loop, which ends the pi process.
test("a tool whose description is not text is listed and opened like any other", { timeout: 15_000 }, async (t) => {
  initTheme("dark");
  const screen = terminal(t);
  const notified: [string, NotifyLevel][] = [];
  const session = await startPiSession(t, {
    extension: (pi) => {
      pi.registerTool({
        name: "untitled", label: "untitled", description: 42 as unknown as string,
        parameters: { type: "object", properties: {} } as TSchema, execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
      });
      toolsExplorer(() => {})(pi);
    },
    extensionPaths: [], systemPrompt: null, toolAllowlist: null,
    ui: { mode: "tui", notify: (message, level) => { notified.push([message, level]); }, custom: screen.custom },
  });
  const running = session.session.prompt("/tools untitled");
  const pane = await screen.next();
  const list = plain(pane.render(WIDTH));
  assert.match(list.find((line) => line.startsWith("▌"))!, /^▌ untitled +● active +~\d+ +42$/);
  pane.handleInput(ENTER);
  const detail = plain(pane.render(WIDTH));
  assert.ok(detail.includes("  Note    the registered description is not text · shown as JSON"), detail.join("\n"));
  assert.deepEqual(detail.slice(detail.indexOf("  Description"), detail.indexOf("  Description") + 2), ["  Description", "    42"]);
  pane.handleInput("v");
  assert.ok(plain(pane.render(WIDTH)).includes('    "description": "42",'));
  pane.handleInput(ESC);
  pane.handleInput(ESC);
  pane.handleInput(ESC);
  await running;
  assert.deepEqual([session.errors, notified], [[], []]);
});

test("the JSON view is coloured by pi's highlighter and stays inert", { timeout: 15_000 }, async (t) => {
  initTheme("dark");
  const screen = terminal(t);
  const { session } = await start(t, screen);
  const running = session.prompt("/tools probe_direct");
  const pane = await screen.next();
  pane.handleInput(ENTER);
  pane.handleInput("v");
  const lines = pane.render(WIDTH);
  assert.deepEqual(plain(lines).slice(1, 4), ["  {", '    "name": "probe_direct",', '    "description": "A directly exposed probe",']);
  assert.match(lines[2]!, /\x1b\[38;[0-9;]+m"name"\x1b\[39m/, "the key is coloured");
  assertInert(lines, "highlighted JSON");
  pane.handleInput(ESC);
  pane.handleInput(ESC);
  pane.handleInput(ESC);
  await running;
});

test("a pane left open is closed when the session reloads, and the command works afterwards", { timeout: 15_000 }, async (t) => {
  const screen = terminal(t);
  const { session } = await start(t, screen);
  const running = session.prompt("/tools");
  const pane = await screen.next();
  await session.reload();
  await running;
  const again = session.prompt("/tools");
  const second = await screen.next();
  assert.notEqual(second, pane);
  assert.match(plain(second.render(WIDTH))[0]!, /^── Tools /);
  second.handleInput(ESC);
  await again;
});

test("the packaged extension file loads in pi and answers /tools", { timeout: 15_000 }, async (t) => {
  const path = process.env.PI_TOOLS_EXPLORER_EXTENSION;
  assert.ok(path, "PI_TOOLS_EXPLORER_EXTENSION must name the packaged extension; this test may not be skipped");
  const notified: string[] = [];
  const { session, errors } = await startPiSession(t, {
    extension: () => {}, extensionPaths: [path], systemPrompt: null, toolAllowlist: null,
    ui: { mode: "rpc", notify: (message) => { notified.push(message); } },
  });
  await session.prompt("/tools");
  assert.deepEqual(errors, []);
  assert.match(notified[0]!, /^Tools: \d+ registered · /);
});
