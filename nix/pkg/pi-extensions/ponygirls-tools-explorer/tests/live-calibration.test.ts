/**
 * The measuring script end to end, against a stand-in for the pi executable
 * that answers the way `pi --mode json` does. What a real provider counts is
 * not the subject here; the wiring of the four runs is.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { declarationCharacters, parseCorpus, promptLineBlock } from "../src/calibration.ts";

const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "calibration", "live-calibration.ts");
const CORPUS = parseCorpus(readFileSync(join(ROOT, "calibration", "corpus.json"), "utf8"));
/** What the stand-in charges: a fixed request, a fixed amount for the declared sample, one token per appended character. */
const BASE_TOKENS = 1_000;
const DECLARED_TOKENS = 10_000;

/**
 * Reads its input to the end first, as a print run of pi does, then reports
 * a usage that depends only on its arguments. STUB_MODE makes it misbehave.
 */
const STUB = `#!${process.execPath}
import { appendFileSync, existsSync, readFileSync } from "node:fs";
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
for await (const _chunk of process.stdin) {}
const log = process.env.STUB_LOG;
const call = existsSync(log) ? readFileSync(log, "utf8").split("\\n").filter(Boolean).length : 0;
const corpus = JSON.parse(readFileSync(process.env.PI_TOOLS_EXPLORER_CALIBRATION_CORPUS, "utf8"));
appendFileSync(log, JSON.stringify({ args, cwd: process.cwd(), corpusTools: corpus.tools.length, probe: existsSync(value("-e")) }) + "\\n");
const mode = process.env.STUB_MODE;
if (mode === "fail") { process.stderr.write("No API key for stub\\n"); process.exit(3); }
const declared = value("--tools").split(",").includes("cal_*");
let tokens = ${BASE_TOKENS} + (declared ? ${DECLARED_TOKENS} : 0) + readFileSync(value("--append-system-prompt"), "utf8").length;
if (mode === "drift" && call === 3) tokens += 500;
const [provider, model] = value("--model").split("/");
const message = { role: "assistant", content: [{ type: "text", text: "OK" }], api: "openai-completions", provider,
  model: mode === "reroute" && call === 1 ? "another-model" : model,
  usage: { input: 4, output: 1, cacheRead: tokens - 4 - 6, cacheWrite: 6 }, stopReason: "stop" };
process.stdout.write(JSON.stringify({ type: "session", version: 3 }) + "\\n");
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "user", content: "x" } }) + "\\n");
if (mode !== "silent") process.stdout.write(JSON.stringify({ type: "message_end", message }) + "\\n");
`;

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
  /** One entry per run of the stand-in. */
  calls: { args: string[]; cwd: string; corpusTools: number; probe: boolean }[];
}

function calibrate(t: TestContext, args: readonly string[], mode: string | null): Promise<Outcome> {
  const dir = mkdtempSync(join(tmpdir(), "tools-explorer-stub-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stub = join(dir, "pi-stub.mjs");
  const log = join(dir, "calls.jsonl");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const withStub = args.map((arg) => (arg === "<stub>" ? stub : arg));
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [SCRIPT, ...withStub], { env: { ...process.env, STUB_LOG: log, ...(mode === null ? {} : { STUB_MODE: mode }) } }, (error, stdout, stderr) => {
      const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Outcome["calls"][number]) : [];
      resolve({ code: error === null ? 0 : typeof error.code === "number" ? error.code : -1, stdout, stderr, calls });
    });
    child.stdin?.end();
  });
}

function flag(args: readonly string[], name: string): string {
  const index = args.indexOf(name);
  assert.notEqual(index, -1, `${name} in ${JSON.stringify(args)}`);
  return args[index + 1]!;
}

test("four runs that differ only in the sample give its two ratios", { timeout: 60_000 }, async (t) => {
  const { code, stdout, stderr, calls } = await calibrate(t, ["--model", "stub/model-1", "--pi", "<stub>", "--json"], null);
  assert.equal(stderr, "");
  assert.equal(code, 0);
  const lines = promptLineBlock(CORPUS).length;
  const result = JSON.parse(stdout) as { provider: string; model: string; api: string; measuredFor: string | null; baselineDrift: number; declarations: Record<string, number>; promptLines: Record<string, number> };
  assert.deepEqual([result.provider, result.model, result.api, result.measuredFor, result.baselineDrift], ["stub", "model-1", "openai-completions", null, 0]);
  assert.deepEqual([result.declarations.characters, result.declarations.tokens], [declarationCharacters(CORPUS), DECLARED_TOKENS]);
  assert.deepEqual([result.promptLines.characters, result.promptLines.tokens], [lines - 1, lines - 1], "the one-character placeholder of the baseline is taken off");
  assert.equal(result.promptLines.charactersPerToken, 1);
  assert.equal(result.declarations.inUse, 4, "a model of no measured family is compared with pi's rule");

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => flag(call.args, "--tools")), ["read", "read,cal_*", "read", "read"]);
  const appended = calls.map((call) => flag(call.args, "--append-system-prompt"));
  assert.equal(appended[0], appended[1]);
  assert.equal(appended[0], appended[3], "the last run repeats the first");
  assert.notEqual(appended[2], appended[0]);
  for (const call of calls) {
    assert.equal(flag(call.args, "--model"), "stub/model-1");
    assert.equal(flag(call.args, "--mode"), "json");
    assert.equal(flag(call.args, "--thinking"), "off");
    assert.equal(flag(call.args, "-e"), join(ROOT, "calibration", "probe.ts"));
    for (const off of ["--no-session", "--no-mcp", "--no-context-files", "--no-skills", "--no-prompt-templates"]) assert.ok(call.args.includes(off), off);
    assert.deepEqual([call.probe, call.corpusTools], [true, CORPUS.tools.length], "the probe and its sample are where the run is told they are");
    assert.equal(call.cwd, calls[0]!.cwd, "every run starts in the same directory, so pi's prompt names the same one");
  }
  assert.equal(existsSync(calls[0]!.cwd), false, "the working directory is removed afterwards");
});

test("the result reads as a table by default", { timeout: 60_000 }, async (t) => {
  const { code, stdout } = await calibrate(t, ["--model", "stub/model-1", "--pi", "<stub>"], null);
  assert.equal(code, 0);
  const lines = stdout.split("\n");
  assert.equal(lines[0], "Model: stub/model-1 (openai-completions)");
  assert.match(lines[2]!, /^ +characters +tokens +chars\/token +in use +difference$/);
  assert.match(lines[3]!, /^declarations +62,300 +10,000 +6\.23 +4 +\+55\.8%$/);
  assert.equal(lines[7], "src/tokens.ts has no ratios for model-1: its estimates use pi's rule.");
});

test("a pi run that fails ends the measurement with what pi said", { timeout: 60_000 }, async (t) => {
  const { code, stdout, stderr, calls } = await calibrate(t, ["--model", "stub/model-1", "--pi", "<stub>"], "fail");
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "live-calibration: pi did not complete (exit 3):\nNo API key for stub\n");
  assert.equal(calls.length, 1, "no further runs after a failure");
});

test("an answer from another model, a moving baseline or no answer are reported, not measured", { timeout: 60_000 }, async (t) => {
  const rerouted = await calibrate(t, ["--model", "stub/model-1", "--pi", "<stub>"], "reroute");
  assert.deepEqual([rerouted.code, rerouted.stdout], [1, ""]);
  assert.equal(rerouted.stderr, "live-calibration: The runs were answered by different models: stub/model-1 and stub/another-model\n");
  const drifting = await calibrate(t, ["--model", "stub/model-1", "--pi", "<stub>"], "drift");
  assert.deepEqual([drifting.code, drifting.stdout], [1, ""]);
  assert.match(drifting.stderr, /^live-calibration: The request without the sample cost 1001 tokens before the measurement and 1501 after it: /);
  const silent = await calibrate(t, ["--model", "stub/model-1", "--pi", "<stub>"], "silent");
  assert.deepEqual([silent.code, silent.stderr], [1, "live-calibration: pi's output has no assistant message\n"]);
});

test("wrong arguments are refused before anything runs", { timeout: 60_000 }, async (t) => {
  for (const args of [[], ["--model", "no-slash"], ["--model", "a/b", "--bogus"], ["--model", "a/b", "extra"], ["--model", "a/b", "--pi", ""]]) {
    const { code, stdout, stderr, calls } = await calibrate(t, args, null);
    assert.equal(code, 2, JSON.stringify(args));
    assert.equal(stdout, "");
    assert.match(stderr, /^live-calibration: .+\nTry 'live-calibration --help'\.\n$/);
    assert.equal(calls.length, 0);
  }
});

test("--help prints the usage and runs nothing", { timeout: 60_000 }, async (t) => {
  for (const args of [["--help"], ["-h"], ["--bogus", "--help"]]) {
    const { code, stdout, stderr, calls } = await calibrate(t, args, null);
    assert.deepEqual([code, stderr, calls.length], [0, "", 0]);
    assert.match(stdout, /^Usage: node calibration\/live-calibration\.ts --model <provider\/model> \[--pi <path>\] \[--json\]\n/);
  }
});
