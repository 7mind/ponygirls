import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  CALIBRATION_PREFIX, MAX_DRIFT_SHARE, calibrate, calibrationDeclarations, calibrationJson, calibrationText, charactersPerToken, declarationCharacters, deviation,
  measured, parseCorpus, promptLineBlock, runUsage, type CalibrationRuns, type Corpus, type RunUsage,
} from "../src/calibration.ts";
import { basisFor } from "../src/tokens.ts";

const CORPUS_PATH = join(import.meta.dirname, "..", "calibration", "corpus.json");

const SMALL: Corpus = {
  tools: [
    { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } }, promptLines: { snippet: "Read file contents", guidelines: ["Use read instead of cat."] } },
    { name: "list", description: "List things", parameters: { type: "object", properties: {} }, promptLines: { snippet: null, guidelines: [] } },
  ],
};

/** Event lines as `pi --mode json` printed them in the measuring runs of 2026-11-27, cut to the fields that matter. */
const CODEX_LINES = [
  '{"type":"session","version":3,"id":"01a21cdc","cwd":"/tmp/x"}',
  '{"type":"message_end","message":{"role":"system","content":"","toolsAdded":[{"name":"read"}],"timestamp":1}}',
  '{"type":"message_end","message":{"role":"user","content":"Reply with the single word OK.","timestamp":2}}',
  "",
  '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"OK"}],"api":"openai-codex-responses","provider":"openai-codex","model":"gpt-6.2-sol","usage":{"input":13062,"output":5,"cacheRead":0,"cacheWrite":0,"reasoning":0,"totalTokens":13067},"stopReason":"stop","timestamp":3}}',
  '{"type":"agent_end"}',
].join("\n");
const CLAUDE_LINE = '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"OK"}],"api":"anthropic-messages","provider":"ai-gateway-anthropic","model":"claude-haiku-5-5","usage":{"input":4,"output":4,"cacheRead":120,"cacheWrite":25305,"totalTokens":25433},"stopReason":"stop","timestamp":3}}';

function usage(promptTokens: number, overrides: Partial<RunUsage>): RunUsage {
  return { provider: "ai-gateway-anthropic", model: "claude-haiku-5-5", api: "anthropic-messages", promptTokens, ...overrides };
}

function runs(baseline: number, declared: number, prompted: number, control: number): CalibrationRuns {
  return { baseline: usage(baseline, {}), declared: usage(declared, {}), prompted: usage(prompted, {}), control: usage(control, {}) };
}

test("the committed sample parses: unique tools with a declaration and their prompt lines", () => {
  const corpus = parseCorpus(readFileSync(CORPUS_PATH, "utf8"));
  assert.equal(corpus.tools.length, 55);
  assert.equal(new Set(corpus.tools.map((tool) => tool.name)).size, 55);
  assert.ok(corpus.tools.some((tool) => tool.name === "read" && tool.promptLines.snippet === "Read file contents"));
  assert.ok(corpus.tools.some((tool) => tool.name.startsWith("mcp__")), "MCP declarations are part of the sample");
  assert.equal(corpus.tools.some((tool) => tool.name.startsWith(CALIBRATION_PREFIX)), false);
  assert.equal(declarationCharacters(corpus), 62_300, "the size the README's measurements are stated for");
  assert.equal(promptLineBlock(corpus).length, 4_076);
});

test("a malformed sample is refused with the tool that is wrong", () => {
  const withTool = (tool: unknown): string => JSON.stringify({ tools: [tool] });
  const good = { name: "t", description: "d", parameters: {}, promptLines: { snippet: null, guidelines: [] } };
  assert.equal(parseCorpus(withTool(good)).tools.length, 1);
  assert.throws(() => parseCorpus("{}"), /no tools/);
  assert.throws(() => parseCorpus('{"tools":[]}'), /no tools/);
  assert.throws(() => parseCorpus(withTool({ ...good, name: "" })), /tool 0 has no name/);
  assert.throws(() => parseCorpus(withTool({ ...good, description: 7 })), /tool 0 has no description/);
  assert.throws(() => parseCorpus(withTool({ ...good, parameters: [] })), /tool 0 has no parameter schema/);
  assert.throws(() => parseCorpus(withTool({ ...good, promptLines: null })), /tool 0 has no prompt lines/);
  assert.throws(() => parseCorpus(withTool({ ...good, promptLines: { snippet: 1, guidelines: [] } })), /snippet that is not text/);
  assert.throws(() => parseCorpus(withTool({ ...good, promptLines: { snippet: null, guidelines: [1] } })), /guidelines that are not text/);
  assert.throws(() => parseCorpus(JSON.stringify({ tools: [good, good] })), /tool names repeat/);
  assert.throws(() => parseCorpus("not json"), SyntaxError);
});

test("the sample is declared under a prefix, and its characters are counted as the estimates count them", () => {
  assert.deepEqual(calibrationDeclarations(SMALL), [
    { name: "cal_read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } },
    { name: "cal_list", description: "List things", parameters: { type: "object", properties: {} } },
  ]);
  const first = '[{"name":"cal_read","description":"Read a file","parameters":{"type":"object","properties":{"path":{"type":"string"}}}}]';
  const second = '[{"name":"cal_list","description":"List things","parameters":{"type":"object","properties":{}}}]';
  assert.equal(declarationCharacters(SMALL), first.length + second.length);
});

test("the prompt lines of the sample are the lines pi would add for its tools", () => {
  assert.equal(promptLineBlock(SMALL), "- read: Read file contents\n- Use read instead of cat.\n");
});

test("a run's usage is read from the first assistant message of pi's event lines", () => {
  assert.deepEqual(runUsage(CODEX_LINES), { provider: "openai-codex", model: "gpt-6.2-sol", api: "openai-codex-responses", promptTokens: 13_062 });
  assert.deepEqual(runUsage(`${CODEX_LINES}\n${CLAUDE_LINE}`).model, "gpt-6.2-sol", "later messages are not the measured request");
});

test("cached tokens are part of the prompt", () => {
  assert.equal(runUsage(CLAUDE_LINE).promptTokens, 4 + 120 + 25_305);
});

test("a run without a usable answer is an error, not a measurement", () => {
  assert.throws(() => runUsage('{"type":"session"}\n{"type":"agent_end"}'), /no assistant message/);
  assert.throws(() => runUsage(""), /no assistant message/);
  const failed = '{"type":"message_end","message":{"role":"assistant","content":[],"api":"a","provider":"p","model":"m","usage":{"input":0,"cacheRead":0,"cacheWrite":0},"stopReason":"error","errorMessage":"401 unauthorized"}}';
  assert.throws(() => runUsage(failed), /The model request failed: 401 unauthorized/);
  const aborted = failed.replace('"error","errorMessage":"401 unauthorized"', '"aborted"');
  assert.throws(() => runUsage(aborted), /The model request failed: aborted/);
  const noUsage = '{"type":"message_end","message":{"role":"assistant","content":[],"api":"a","provider":"p","model":"m","stopReason":"stop"}}';
  assert.throws(() => runUsage(noUsage), /names no provider, model, API or usage/);
  const noCount = '{"type":"message_end","message":{"role":"assistant","content":[],"api":"a","provider":"p","model":"m","usage":{"input":5,"cacheRead":0},"stopReason":"stop"}}';
  assert.throws(() => runUsage(noCount), /no usable cacheWrite token count/);
  assert.throws(() => runUsage("not json"), SyntaxError);
});

test("a sample's cost is what it added to the baseline, and its ratio follows", () => {
  const measurement = measured(62_300, usage(1_533, {}), usage(25_162, {}));
  assert.deepEqual(measurement, { characters: 62_300, tokens: 23_629 });
  assert.equal(charactersPerToken(measurement), 62_300 / 23_629);
  assert.throws(() => measured(100, usage(1_000, {}), usage(1_000, {})), /added 100 characters and 0 tokens/);
  assert.throws(() => measured(100, usage(1_000, {}), usage(900, {})), /nothing to derive a ratio from/);
  assert.throws(() => measured(0, usage(1_000, {}), usage(2_000, {})), /nothing to derive a ratio from/);
});

test("four runs give the two ratios when the request without the sample did not move", () => {
  const result = calibrate(runs(1_533, 25_162, 2_864, 1_533), 62_300, 4_075);
  assert.deepEqual(result, {
    provider: "ai-gateway-anthropic", model: "claude-haiku-5-5", api: "anthropic-messages",
    declarations: { characters: 62_300, tokens: 23_629 }, promptLines: { characters: 4_075, tokens: 1_331 }, baselineDrift: 0,
  });
});

test("a baseline that moved by more than a hundredth of the smaller sample voids the measurement", () => {
  assert.equal(MAX_DRIFT_SHARE, 0.01);
  // The smaller sample is 1,331 tokens: 13 tokens of drift are within a hundredth of it, 14 are not.
  assert.equal(calibrate(runs(1_533, 25_162, 2_864, 1_546), 62_300, 4_075).baselineDrift, 13);
  assert.equal(calibrate(runs(1_533, 25_162, 2_864, 1_520), 62_300, 4_075).baselineDrift, 13, "in either direction");
  assert.throws(() => calibrate(runs(1_533, 25_162, 2_864, 1_547), 62_300, 4_075),
    /cost 1533 tokens before the measurement and 1547 after it: this pi configuration changes its prompt between runs/);
});

test("runs answered by different models are not compared", () => {
  const base = runs(1_000, 5_000, 2_000, 1_000);
  for (const run of ["declared", "prompted", "control"] as const) {
    assert.throws(() => calibrate({ ...base, [run]: usage(base[run].promptTokens, { model: "claude-fable-5-2" }) }, 100, 100),
      /answered by different models: ai-gateway-anthropic\/claude-haiku-5-5 and ai-gateway-anthropic\/claude-fable-5-2/, run);
  }
  assert.throws(() => calibrate({ ...base, declared: usage(5_000, { api: "openai-completions" }) }, 100, 100), /different models/);
  assert.throws(() => calibrate({ ...base, control: usage(1_000, { provider: "anthropic" }) }, 100, 100), /different models/);
});

test("the report puts the measurement beside the ratios in use, with how far apart they are", () => {
  const result = calibrate(runs(1_533, 25_162, 2_864, 1_533), 62_300, 4_075);
  assert.equal(basisFor("claude-haiku-5-5").declaration, 2.7);
  assert.equal(calibrationText(result), [
    "Model: ai-gateway-anthropic/claude-haiku-5-5 (anthropic-messages)",
    "",
    "              characters  tokens  chars/token  in use  difference",
    "declarations      62,300  23,629         2.64     2.7       -2.3%",
    "prompt lines       4,075   1,331         3.06     3.1       -1.2%",
    "",
    "The request without the sample cost the same before and after.",
    "src/tokens.ts has these ratios for Claude models.",
  ].join("\n"));
  assert.ok(Math.abs(deviation(result.declarations, 2.7) - (62_300 / 23_629 - 2.7) / 2.7) < 1e-12);
});

test("the report says when the estimates for that model use pi's rule, and when the baseline moved", () => {
  const other = { provider: "kimi-coding", model: "kimi-k2.6" };
  const moved = calibrate({
    baseline: usage(1_000, other), declared: usage(21_000, other), prompted: usage(2_000, other), control: usage(1_004, other),
  }, 100_000, 3_000);
  const lines = calibrationText(moved).split("\n");
  assert.equal(lines[3], "declarations     100,000  20,000         5.00       4      +25.0%");
  assert.equal(lines[4], "prompt lines       3,000   1,000         3.00       4      -25.0%");
  assert.equal(lines[6], "The request without the sample moved by 4 tokens between the first run and the last.");
  assert.equal(lines[0], "Model: kimi-coding/kimi-k2.6 (anthropic-messages)");
  assert.equal(lines[7], "src/tokens.ts has no ratios for kimi-k2.6: its estimates use pi's rule.");
});

test("the same result is available to programs", () => {
  const result = calibrate(runs(1_533, 25_162, 2_864, 1_533), 62_300, 4_075);
  assert.deepEqual(JSON.parse(calibrationJson(result)), {
    provider: "ai-gateway-anthropic", model: "claude-haiku-5-5", api: "anthropic-messages", measuredFor: "Claude",
    declarations: { characters: 62_300, tokens: 23_629, charactersPerToken: 62_300 / 23_629, inUse: 2.7, deviation: deviation(result.declarations, 2.7) },
    promptLines: { characters: 4_075, tokens: 1_331, charactersPerToken: 4_075 / 1_331, inUse: 3.1, deviation: deviation(result.promptLines, 3.1) },
    baselineDrift: 0,
  });
  assert.equal(calibrationJson(result).includes("\n"), false, "one line");
});
