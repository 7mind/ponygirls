/**
 * Measuring the token ratios of src/tokens.ts again: a fixed sample of tool
 * declarations and prompt lines, what a pi run reports for a request, and the
 * ratio the two give. calibration/live-calibration.ts drives the runs and
 * calibration/probe.ts declares the sample inside them. Nothing here touches
 * pi or the network.
 */
import type { JsonSchema, PromptLines, ToolDeclaration } from "./registry.ts";
import { basisFor, declarationText, promptLineText, type TokenBasis } from "./tokens.ts";

export interface CorpusTool extends ToolDeclaration {
  promptLines: PromptLines;
}

export interface Corpus {
  tools: readonly CorpusTool[];
}

/** Sample tools are declared under this prefix, so they cannot collide with the tools of the run. */
export const CALIBRATION_PREFIX = "cal_";
/** The environment variable that tells calibration/probe.ts where the sample is. */
export const CORPUS_VARIABLE = "PI_TOOLS_EXPLORER_CALIBRATION_CORPUS";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function corpusTool(value: unknown, index: number): CorpusTool {
  const fail = (what: string): never => { throw new Error(`Calibration corpus: tool ${index} ${what}`); };
  if (!isRecord(value)) return fail("is not an object");
  const { name, description, parameters, promptLines } = value;
  if (typeof name !== "string" || name === "") return fail("has no name");
  if (typeof description !== "string") return fail("has no description");
  if (!isRecord(parameters)) return fail("has no parameter schema");
  if (!isRecord(promptLines)) return fail("has no prompt lines");
  const { snippet, guidelines } = promptLines;
  if (snippet !== null && typeof snippet !== "string") return fail("has a snippet that is not text");
  if (!Array.isArray(guidelines) || !guidelines.every((guideline): guideline is string => typeof guideline === "string")) return fail("has guidelines that are not text");
  return { name, description, parameters: parameters as JsonSchema, promptLines: { snippet, guidelines } };
}

export function parseCorpus(json: string): Corpus {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value) || !Array.isArray(value.tools) || value.tools.length === 0) throw new Error("Calibration corpus: no tools");
  const tools = value.tools.map(corpusTool);
  const names = new Set(tools.map((tool) => tool.name));
  if (names.size !== tools.length) throw new Error("Calibration corpus: tool names repeat");
  return { tools };
}

/** The sample as it is declared in a measuring run. */
export function calibrationDeclarations(corpus: Corpus): ToolDeclaration[] {
  return corpus.tools.map((tool) => ({ name: `${CALIBRATION_PREFIX}${tool.name}`, description: tool.description, parameters: tool.parameters }));
}

/** Characters of the sample's declarations, counted as the estimates count them. */
export function declarationCharacters(corpus: Corpus): number {
  return calibrationDeclarations(corpus).reduce((sum, declaration) => sum + declarationText(declaration).length, 0);
}

/** The prompt lines of the sample's tools, as pi writes them into the system prompt. */
export function promptLineBlock(corpus: Corpus): string {
  return corpus.tools.map((tool) => promptLineText(tool.name, tool.promptLines)).join("");
}

/** What one pi run reported for its first model request. */
export interface RunUsage {
  provider: string;
  model: string;
  /** The API that served the request, as pi names it. */
  api: string;
  /** Tokens of the request as the provider counted them, cached or not. */
  promptTokens: number;
}

function numberOf(usage: Record<string, unknown>, field: string): number {
  const value = usage[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`pi reported no usable ${field} token count`);
  return value;
}

/** Read the first assistant message from the event lines of `pi --mode json`. */
export function runUsage(stdout: string): RunUsage {
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") continue;
    const event: unknown = JSON.parse(line);
    if (!isRecord(event) || event.type !== "message_end" || !isRecord(event.message) || event.message.role !== "assistant") continue;
    const message = event.message;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      throw new Error(`The model request failed: ${typeof message.errorMessage === "string" ? message.errorMessage : String(message.stopReason)}`);
    }
    const { provider, model, api, usage } = message;
    if (typeof provider !== "string" || typeof model !== "string" || typeof api !== "string" || !isRecord(usage)) throw new Error("pi's assistant message names no provider, model, API or usage");
    return { provider, model, api, promptTokens: numberOf(usage, "input") + numberOf(usage, "cacheRead") + numberOf(usage, "cacheWrite") };
  }
  throw new Error("pi's output has no assistant message");
}

/** Characters added to a request and the tokens the provider counted for them. */
export interface Measurement {
  characters: number;
  tokens: number;
}

/** What a sample added to the baseline request. */
export function measured(characters: number, baseline: RunUsage, withSample: RunUsage): Measurement {
  const tokens = withSample.promptTokens - baseline.promptTokens;
  if (characters <= 0 || tokens <= 0) throw new Error(`The sample added ${characters} characters and ${tokens} tokens: nothing to derive a ratio from`);
  return { characters, tokens };
}

export function charactersPerToken(measurement: Measurement): number {
  return measurement.characters / measurement.tokens;
}

export interface Calibration {
  provider: string;
  model: string;
  api: string;
  declarations: Measurement;
  promptLines: Measurement;
  /** Tokens by which the request without the sample differed between the first run and the last. */
  baselineDrift: number;
}

/** The four runs of a calibration, in the order they are made. */
export interface CalibrationRuns {
  baseline: RunUsage;
  /** With the sample's tools declared. */
  declared: RunUsage;
  /** With the sample's prompt lines in the system prompt. */
  prompted: RunUsage;
  /** The baseline once more: what the same request costs after the other runs. */
  control: RunUsage;
}

/** A baseline that moves by more than this share of a sample makes the ratios coarser than tokens.ts states them. */
export const MAX_DRIFT_SHARE = 0.01;

/**
 * The ratios the runs give. They only mean something when all four runs were
 * answered by one model and the request without the sample costs the same
 * before and after: otherwise something else than the sample changed.
 */
export function calibrate(runs: CalibrationRuns, declarationChars: number, promptLineChars: number): Calibration {
  const { baseline, declared, prompted, control } = runs;
  for (const run of [declared, prompted, control]) {
    if (run.provider !== baseline.provider || run.model !== baseline.model || run.api !== baseline.api) {
      throw new Error(`The runs were answered by different models: ${baseline.provider}/${baseline.model} and ${run.provider}/${run.model}`);
    }
  }
  const declarations = measured(declarationChars, baseline, declared);
  const promptLines = measured(promptLineChars, baseline, prompted);
  const baselineDrift = Math.abs(control.promptTokens - baseline.promptTokens);
  const smallest = Math.min(declarations.tokens, promptLines.tokens);
  if (baselineDrift > smallest * MAX_DRIFT_SHARE) {
    throw new Error(`The request without the sample cost ${baseline.promptTokens} tokens before the measurement and ${control.promptTokens} after it: `
      + "this pi configuration changes its prompt between runs, so the differences do not measure the sample");
  }
  return { provider: baseline.provider, model: baseline.model, api: baseline.api, declarations, promptLines, baselineDrift };
}

const RATIO_DIGITS = 2;
const PERCENT = 100;
const COLUMN_GAP = "  ";
const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** How far a measured ratio is from the one the estimates use, as a share of the latter. */
export function deviation(measurement: Measurement, inUse: number): number {
  return (charactersPerToken(measurement) - inUse) / inUse;
}

function signedPercent(share: number): string {
  const percent = (share * PERCENT).toFixed(1);
  return `${share > 0 ? "+" : ""}${percent}%`;
}

function table(rows: readonly (readonly string[])[]): string[] {
  const widths = rows[0]!.map((_cell, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows.map((row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!))).join(COLUMN_GAP).trimEnd());
}

/** The measurement beside the ratios the estimates use now. */
export function calibrationText(result: Calibration): string {
  const current: TokenBasis = basisFor(result.model);
  const row = (label: string, measurement: Measurement, now: number): string[] => [
    label, GROUPED.format(measurement.characters), GROUPED.format(measurement.tokens), charactersPerToken(measurement).toFixed(RATIO_DIGITS), String(now),
    signedPercent(deviation(measurement, now)),
  ];
  const basis = current.measuredFor === null ? `src/tokens.ts has no ratios for ${result.model}: its estimates use pi's rule.`
    : `src/tokens.ts has these ratios for ${current.measuredFor} models.`;
  const control = result.baselineDrift === 0 ? "The request without the sample cost the same before and after."
    : `The request without the sample moved by ${GROUPED.format(result.baselineDrift)} tokens between the first run and the last.`;
  return [
    `Model: ${result.provider}/${result.model} (${result.api})`,
    "",
    ...table([
      ["", "characters", "tokens", "chars/token", "in use", "difference"],
      row("declarations", result.declarations, current.declaration),
      row("prompt lines", result.promptLines, current.promptLine),
    ]),
    "",
    control,
    basis,
  ].join("\n");
}

/** The same for programs. */
export function calibrationJson(result: Calibration): string {
  const current = basisFor(result.model);
  const part = (measurement: Measurement, now: number) => ({ ...measurement, charactersPerToken: charactersPerToken(measurement), inUse: now, deviation: deviation(measurement, now) });
  return JSON.stringify({
    provider: result.provider,
    model: result.model,
    api: result.api,
    measuredFor: current.measuredFor,
    declarations: part(result.declarations, current.declaration),
    promptLines: part(result.promptLines, current.promptLine),
    baselineDrift: result.baselineDrift,
  });
}
