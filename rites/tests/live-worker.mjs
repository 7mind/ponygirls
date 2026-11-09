import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeRunResult, encodeRunRequest } from "../target/protocol/protocol/protocol.js";
import { RunRequest } from "../target/protocol/generated/typescript/rites/worker/RunRequest.js";
import { ModelSelection } from "../target/protocol/generated/typescript/rites/worker/ModelSelection.js";

const MAX_STREAM_BYTES = 1024 * 1024;
const CLEANUP_GRACE_MS = 15_000;
const MAX_SELECTION_BYTES = 4096;
const CHECKOUT = resolve(fileURLToPath(new URL("../../", import.meta.url)));

function outsideCheckout(path) {
  return path !== CHECKOUT && !path.startsWith(`${CHECKOUT}/`) && !path.startsWith("/nix/store/");
}

async function privateFile(path) {
  assert(isAbsolute(path), "private file paths must be absolute");
  const canonical = await realpath(path);
  assert(outsideCheckout(canonical), "private settings must be outside the checkout and Nix store");
  const info = await stat(canonical);
  assert(info.isFile() && (info.mode & 0o077) === 0 && info.uid === process.getuid(), "private file ownership/permissions are unsafe");
  return canonical;
}

async function fingerprint(directory) {
  const result = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else {
        assert(entry.isFile(), "unexpected nonregular file in live fixture");
        result.push([relative(directory, child), createHash("sha256").update(await readFile(child)).digest("hex")]);
      }
    }
  }
  await visit(directory);
  return result.sort(([left], [right]) => left.localeCompare(right));
}

function execute(worker, workspace, modelConfig, selection, prompt, timeoutSeconds) {
  const runId = randomUUID();
  const frame = encodeRunRequest(new RunRequest(RunRequest.BaboonDomainVersion, runId, prompt,
    new ModelSelection(selection.provider, selection.model, selection.thinkingLevel)));
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(worker, [workspace, modelConfig, String(timeoutSeconds)], { detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let violation = false;
    let closed = false;
    const kill = () => {
      if (!closed && typeof child.pid === "number") {
        try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") violation = true; }
      }
    };
    const watchdog = setTimeout(() => {
      violation = true;
      kill();
      rejectRun(new Error("worker did not finish before the outer deadline"));
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }, timeoutSeconds * 1000 + CLEANUP_GRACE_MS);
    child.stdout.on("data", chunk => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STREAM_BYTES) { violation = true; kill(); }
      else chunks.push(chunk);
    });
    child.stderr.on("data", chunk => { stderrBytes += chunk.length; if (stderrBytes > MAX_STREAM_BYTES) { violation = true; kill(); } });
    child.stdin.on("error", () => {});
    child.on("error", () => { closed = true; clearTimeout(watchdog); rejectRun(new Error("worker failed to start")); });
    child.on("close", code => {
      closed = true;
      clearTimeout(watchdog);
      try {
        assert(code === 0 && !violation, "worker process/output/deadline acceptance failed");
        const result = decodeRunResult(Buffer.concat(chunks));
        assert.equal(result.runId, runId, "worker result run identity mismatch");
        assert.equal(result.outcome, "Completed", "worker did not complete");
        resolveRun({ runId, outcome: "Completed", stdoutBytes });
      } catch { rejectRun(new Error("worker terminal acceptance failed")); }
    });
    child.stdin.end(frame);
  });
}

async function main() {
  const [workerArgument, modelArgument, selectionArgument, privateRootArgument, secondsArgument] = process.argv.slice(2);
  assert.equal(process.argv.length, 7, "usage: node live-worker.mjs WORKER MODEL_CONFIG SELECTION_JSON PRIVATE_REPORT_DIR TIMEOUT_SECONDS");
  assert(isAbsolute(workerArgument), "worker path must be absolute");
  const worker = await realpath(workerArgument);
  await access(worker, constants.X_OK);
  const modelConfig = await privateFile(modelArgument);
  const selectionFile = await privateFile(selectionArgument);
  assert((await stat(selectionFile)).size <= MAX_SELECTION_BYTES, "private selection file too large");
  const selection = JSON.parse(await readFile(selectionFile, "utf8"));
  assert.deepEqual(Object.keys(selection).sort(), ["model", "provider", "thinkingLevel"]);
  for (const key of ["provider", "model", "thinkingLevel"]) assert(typeof selection[key] === "string" && selection[key].length > 0);
  const timeoutSeconds = Number(secondsArgument);
  assert(Number.isInteger(timeoutSeconds) && timeoutSeconds > 0 && timeoutSeconds <= 900, "invalid live execution deadline");
  assert(isAbsolute(privateRootArgument), "private report path must be absolute");
  await mkdir(privateRootArgument, { recursive: true, mode: 0o700 });
  const privateRoot = await realpath(privateRootArgument);
  const rootInfo = await stat(privateRoot);
  assert(outsideCheckout(privateRoot) && (rootInfo.mode & 0o077) === 0 && rootInfo.uid === process.getuid(), "unsafe private report directory");
  const workspace = await mkdtemp(join(privateRoot, "live-workspace-"));
  const input = { nonce: randomUUID(), items: [{ name: "cedar", score: 7 }, { name: "lichen", score: 11 }, { name: "sparrow", score: 3 }] };
  await writeFile(join(workspace, "source.json"), JSON.stringify(input), { mode: 0o600 });
  const extensionMarker = join(privateRoot, `extension-executed-${randomUUID()}`);
  await mkdir(join(workspace, ".pi", "extensions"), { recursive: true });
  await writeFile(join(workspace, ".pi", "extensions", "must-not-run.js"),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(extensionMarker)}, 'unexpected'); export default () => {};\n`);
  const started = Date.now();
  const edit = await execute(worker, workspace, modelConfig, selection,
    "# Task\nRead only source.json, then create answer.json containing exactly the fields nonce, ordered, total. Copy nonce unchanged; ordered must be the item names sorted by descending numeric score; total is the sum of the scores. Use the available repository tools. Do not load project extensions or other instructions. Do not change source.json or any other existing file. No Markdown fences in answer.json.\n", timeoutSeconds);
  const answer = JSON.parse(await readFile(join(workspace, "answer.json"), "utf8"));
  assert.deepEqual(answer, { nonce: input.nonce, ordered: ["lichen", "cedar", "sparrow"], total: 21 }, "live model produced incorrect fixture output");
  await assert.rejects(stat(extensionMarker), error => error.code === "ENOENT");
  const before = await fingerprint(workspace);
  const readOnly = await execute(worker, workspace, modelConfig, selection,
    "# Task\nRead source.json and answer.json. Verify that answer.json copies the nonce, lists names by descending score and gives the correct sum. Do not modify, create or delete any file. Do not load project extensions or other instructions. Report completion after verification.\n", timeoutSeconds);
  assert.deepEqual(await fingerprint(workspace), before, "read-only live follow-up changed fixture files");
  await assert.rejects(stat(extensionMarker), error => error.code === "ENOENT");
  const summary = {
    kind: "controlled-live-model-worker", tests: 2, failures: 0, errors: 0, skipped: 0,
    workerLauncherSha256: createHash("sha256").update(await readFile(worker)).digest("hex"),
    cases: [{ name: "fixture-edit", ...edit }, { name: "read-only-follow-up", ...readOnly }],
    elapsedMs: Date.now() - started,
    limitations: "Two synthetic workflow smoke cases, not a semantic-quality benchmark or native-coordinator/forge acceptance.",
  };
  await writeFile(join(privateRoot, "live-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main().catch(() => {
  process.stderr.write("Controlled live-worker acceptance failed; no model configuration, credential, provider identity or transcript was printed.\n");
  process.exitCode = 1;
});
