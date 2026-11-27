/**
 * Measures, against a live model, how many characters of tool declarations
 * and of prompt lines make one token: the ratios of src/tokens.ts. It runs pi
 * four times in JSON mode with the same one-word request: without the sample,
 * with the sample's tools declared, with the sample's prompt lines appended
 * to the system prompt, and without the sample again. The differences in the
 * prompt tokens the provider reports give the ratios; the last run shows that
 * nothing but the sample changed. README.md, "Token estimates".
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  CALIBRATION_PREFIX, CORPUS_VARIABLE, calibrate, calibrationJson, calibrationText, declarationCharacters, parseCorpus, promptLineBlock, runUsage,
  type RunUsage,
} from "../src/calibration.ts";

const TOOL = "live-calibration";
const USAGE = `Usage: node calibration/${TOOL}.ts --model <provider/model> [--pi <path>] [--json]

Measures the characters per token of tool declarations and prompt lines for
one model, by four pi runs that differ only in a fixed sample
(calibration/corpus.json), and prints them beside the ratios in src/tokens.ts.
The runs use the pi configuration of the current user, without its MCP
servers, and send the sample to the model's provider: four requests of about
30,000 tokens together.

  --model <provider/model>  the model to measure, as pi's --model takes it
  --pi <path>               the pi executable (default: pi on PATH)
  --json                    print the result as JSON
  -h, --help                show this text
`;
const USAGE_ERROR = 2;
const FAILURE = 1;
const SYSTEM_PROMPT = "You are a calibration probe. Answer in one word and never call a tool.";
const REQUEST = "Reply with the single word OK.";
/** pi wraps appended text in a section; a one-character placeholder keeps that wrapper in every run. */
const PLACEHOLDER = "x";
const BASE_TOOLS = "read";
const RUN_TIMEOUT_MS = 300_000;
const MS_PER_SECOND = 1000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

function usageError(message: string): never {
  process.stderr.write(`${TOOL}: ${message}\nTry '${TOOL} --help'.\n`);
  process.exit(USAGE_ERROR);
}

interface Options {
  model: string;
  pi: string;
  json: boolean;
}

function options(argv: readonly string[]): Options {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  let values: { model?: string; pi?: string; json?: boolean };
  try {
    ({ values } = parseArgs({ args: [...argv], options: { model: { type: "string" }, pi: { type: "string" }, json: { type: "boolean" } }, allowPositionals: false }));
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error));
  }
  if (values.model === undefined || !/^[^/\s]+\/\S+$/.test(values.model)) return usageError("--model <provider/model> is required");
  if (values.pi === "") return usageError("--pi needs a path");
  return { model: values.model, pi: values.pi ?? "pi", json: values.json === true };
}

interface Run {
  /** Tools the run declares, as pi's --tools takes them. */
  tools: string;
  /** File whose text is appended to the system prompt. */
  appended: string;
}

function measure(settings: Options, corpusPath: string, cwd: string, run: Run): Promise<RunUsage> {
  const args = [
    // MCP servers connect in the background and change the prompt when they do.
    "--no-session", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-mcp",
    "--system-prompt", SYSTEM_PROMPT, "--append-system-prompt", run.appended,
    "--thinking", "off", "--model", settings.model, "--mode", "json",
    "-e", join(import.meta.dirname, "probe.ts"),
    "--tools", run.tools,
    "-p", REQUEST,
  ];
  return new Promise((resolve, reject) => {
    const child = execFile(settings.pi, args, { cwd, env: { ...process.env, [CORPUS_VARIABLE]: corpusPath }, timeout: RUN_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
      if (error !== null) {
        const why = error.killed ? `no answer within ${RUN_TIMEOUT_MS / MS_PER_SECOND} s` : `exit ${String(error.code)}`;
        reject(new Error(`pi did not complete (${why})${stderr.trim() === "" ? "" : `:\n${stderr.trim()}`}`));
        return;
      }
      try {
        resolve(runUsage(stdout));
      } catch (failure) {
        reject(failure);
      }
    });
    // A print run reads piped input to its end before it prompts.
    child.stdin?.end();
  });
}

async function main(): Promise<void> {
  const settings = options(process.argv.slice(2));
  const corpusPath = join(import.meta.dirname, "corpus.json");
  const corpus = parseCorpus(readFileSync(corpusPath, "utf8"));
  const lines = promptLineBlock(corpus);
  const work = mkdtempSync(join(tmpdir(), "tools-explorer-calibration-"));
  try {
    const placeholder = join(work, "placeholder.txt");
    const promptLines = join(work, "prompt-lines.txt");
    writeFileSync(placeholder, PLACEHOLDER);
    writeFileSync(promptLines, lines);
    const plain: Run = { tools: BASE_TOOLS, appended: placeholder };
    const baseline = await measure(settings, corpusPath, work, plain);
    const declared = await measure(settings, corpusPath, work, { tools: `${BASE_TOOLS},${CALIBRATION_PREFIX}*`, appended: placeholder });
    const prompted = await measure(settings, corpusPath, work, { tools: BASE_TOOLS, appended: promptLines });
    const control = await measure(settings, corpusPath, work, plain);
    const result = calibrate({ baseline, declared, prompted, control }, declarationCharacters(corpus), lines.length - PLACEHOLDER.length);
    process.stdout.write(`${settings.json ? calibrationJson(result) : calibrationText(result)}\n`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${TOOL}: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(FAILURE);
});
