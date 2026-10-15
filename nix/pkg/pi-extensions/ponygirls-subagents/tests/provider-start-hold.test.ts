/**
 * Provider-start hold FIXED proof (real WorkerHandle / public SDK, strict types).
 * DISTINCT from preserved RED scaffold (ignored copy `provider-start-hold-RED-*`
 * + parent debug; RED mandated a forbidden second success and CANNOT remain active).
 *
 * ENTRY evidence comes from the ORIGINAL PUBLIC-REGISTERED test-sim provider
 * callback (narrow typed ENTRY observer in owned `src/deterministic.ts`,
 * authorized fixture seam; registration/script/responses/model/context/options
 * unchanged). Each streamSimple invocation appends one typed JSON line BEFORE
 * step/response to `provider-entries.jsonl` confined in the worker's own
 * agentDir (no new writable path/grants). Persisted assistant stopReason rows
 * are completion evidence ONLY — never ENTRY counts (error rows and duplicate
 * copies excluded by construction: one log line per callback ENTRY).
 * Causal ASK+DENIAL traced separately via public
 * `setProviderAdmissionRequestHandler` wrapper (calls captured original
 * handler unchanged; records body/envelope/response; no priSup mutation).
 *
 * Scope (user-authorized): recovery holds deny ALL NEW provider starts
 * (continuations; retry/direct/compaction share the SAME streamFunction
 * wrapper — Agent.js passes it to every runAgentLoop/Continue and AgentSession
 * passes the SAME object to compaction halves; long-context compaction is not
 * fixture-triggered by short deterministic contexts — disclosed, not
 * fabricated; ambient-extension direct ModelRuntime calls disabled and
 * governing-JS parent calls outside trust boundary — disclosed).
 * Denial = visible typed routing error (error stream + failing terminal with
 * hold code), NOT parking/hang. Admitted settles truthfully; resume only
 * after genuine recovery. Missing infrastructure (no admission handler)
 * denies visibly with UNSUPPORTED (never legacy allow).
 *
 * Required pinned SDK fails loudly (no skips). Constructor DI only; bare
 * joined cleanup preserving primary AND secondary errors (no catch{} swallow,
 * no truthiness-drop of unknown errors). No sleeps-as-proof (deadline polls),
 * no `any`/required-optional chains.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { WorkerHandle, type ProviderAdmissionHandler } from "../src/worker-launch.ts";
import { bindChannel } from "../src/protocol.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";
import { Supervisor } from "../src/supervisor.ts";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { DummyToolExecutor, HostToolExecutor } from "../src/sandbox.ts";
import { InMemoryRunStore, type JournalRecord, type JournalKind, type RunStore } from "../src/store.ts";
import type { TaskRunId } from "../src/types.ts";
import { CtlWorker, gateSpec } from "./ctl-worker.ts";
import { decodeLatch } from "../src/deterministic.ts";

const SDK_ROOT = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;
const CG = "mcp__codegraph__codegraph_explore";
const HOLD_CODE = "RECOVERY_OWNER_UNCONFIRMED";
const UNSUPPORTED_CODE = "UNSUPPORTED";

const EXPECTED_INPUT = 5;
const EXPECTED_OUTPUT = 7;
const OPERATIVE_TIMEOUT_MS = 60000;
const TERMINAL_TIMEOUT_MS = 90000;
const READ_PATH = "hello.txt";
const ENTRY_LOG = "provider-entries.jsonl";
const EXPOSED_WITNESS_LOG = "exposed-result-states.jsonl";

interface ExposedState {
  taskRunId: string;
  generation: number;
  seq: number;
  event: string;
}

function readExposedStates(agentDir: string): ExposedState[] {
  const p: string = join(agentDir, EXPOSED_WITNESS_LOG);
  assert.ok(existsSync(p), `EXPOSED_WITNESS_MISSING: ${p} absent when exposed states required (not valid zero)`);
  const out: ExposedState[] = [];
  const lines: string[] = readFileSync(p, "utf8").split("\n");
  for (let li = 0; li < lines.length; li += 1) {
    const line: string = lines[li] as string;
    if (line.trim().length === 0) continue;
    const rec: unknown = JSON.parse(line) as unknown;
    assert.ok(typeof rec === "object" && rec !== null, `EXPOSED_WITNESS_CORRUPT: line ${li + 1} must be an object`);
    const r = rec as Record<string, unknown>;
    assert.ok(typeof r["taskRunId"] === "string" && (r["taskRunId"] as string).length > 0, `EXPOSED_WITNESS_CORRUPT: line ${li + 1} taskRunId must be nonempty`);
    assert.ok(typeof r["generation"] === "number" && Number.isInteger(r["generation"]), `EXPOSED_WITNESS_CORRUPT: line ${li + 1} generation must be an integer`);
    assert.ok(typeof r["seq"] === "number" && Number.isInteger(r["seq"]), `EXPOSED_WITNESS_CORRUPT: line ${li + 1} seq must be an integer`);
    assert.ok(r["event"] === "exposed-entered" || r["event"] === "exposed-settled-ok" || r["event"] === "exposed-settled-err", `EXPOSED_WITNESS_CORRUPT: line ${li + 1} event must be exposed-entered/settled-ok/settled-err`);
    out.push({ taskRunId: r["taskRunId"] as string, generation: r["generation"] as number, seq: r["seq"] as number, event: r["event"] as string });
  }
  return out;
}
const NONZERO_SUMMARY_USAGE = JSON.stringify({
  history: { input: 13, output: 14, cacheRead: 15, cacheWrite: 16, totalTokens: 58, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } },
  prefix: { input: 23, output: 24, cacheRead: 25, cacheWrite: 26, totalTokens: 98, cost: { input: 11, output: 12, cacheRead: 13, cacheWrite: 14, total: 20 } },
});

const tick = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

function requireSdkRoot(): string {
  assert.ok(SDK_ROOT, "PI_SUBAGENTS_SDK_ROOT must be set (pinned production SDK 1.2.0)");
  const root: string = SDK_ROOT;
  assert.ok(existsSync(root), `pinned SDK root missing: ${root}`);
  const pkgPath = join(root, "package.json");
  assert.ok(existsSync(pkgPath), `pinned SDK package.json missing: ${pkgPath}`);
  const version: unknown = (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown }).version;
  assert.equal(version, "1.2.0", `pinned SDK must be 1.2.0 (got ${String(version)})`);
  return root;
}

function records(sup: Supervisor): JournalRecord[] {
  return sup.runStore.readSince(0, 100000).records;
}
function strBody(r: JournalRecord, key: string): string | null {
  const v: unknown = r.body[key];
  return typeof v === "string" ? v : null;
}
function sumUsage(recs: JournalRecord[]): { input: number; output: number } {
  const acc = { input: 0, output: 0 };
  for (const r of recs) {
    const input: unknown = r.body["input"];
    const output: unknown = r.body["output"];
    if (typeof input === "number" && Number.isFinite(input)) acc.input += input;
    if (typeof output === "number" && Number.isFinite(output)) acc.output += output;
  }
  return acc;
}
function extReports(sup: Supervisor, op?: string): JournalRecord[] {
  return records(sup).filter((r) => r.kind === "usage.reported" && r.body["external"] === true && (op === undefined || strBody(r, "operationId") === op));
}
function modelReports(sup: Supervisor, agentId?: string): JournalRecord[] {
  return records(sup).filter((r) => {
    if (r.kind !== "usage.reported" || r.body["external"] === true) return false;
    if (agentId === undefined) return true;
    return strBody(r, "agentId") === agentId;
  });
}
function toolResultTexts(sessionsDir: string, agentId: string): string[] {
  assert.ok(typeof sessionsDir === "string" && sessionsDir.length > 0, "sessionsDir asserted");
  assert.ok(typeof agentId === "string" && agentId.length > 0, "agentId asserted");
  const out: string[] = [];
  const base = join(sessionsDir, agentId);
  assert.ok(existsSync(base), "session dir missing (setup failure): " + base);
  const walk = (d: string): void => {
    const ents = readdirSync(d, { withFileTypes: true });
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const text: string = readFileSync(p, "utf8");
        const lines: string[] = text.split("\n");
        for (let li = 0; li < lines.length; li += 1) {
          const line: string = lines[li] as string;
          if (line.trim().length === 0) continue;
          let rec: unknown;
          try {
            rec = JSON.parse(line) as unknown;
          } catch (parseError: unknown) {
            const detail = parseError instanceof Error ? parseError.message : String(parseError);
            throw new Error("SESSION_CORRUPT: " + p + " line " + String(li + 1) + ": " + detail);
          }
          let entry: unknown = rec;
          if (typeof rec === "object" && rec !== null && "entry" in (rec as Record<string, unknown>)) entry = (rec as Record<string, unknown>)["entry"];
          if (typeof entry !== "object" || entry === null) continue;
          const entryRec = entry as Record<string, unknown>;
          const message: unknown = entryRec["message"];
          if (typeof message !== "object" || message === null) continue;
          const msgRec = message as Record<string, unknown>;
          if (msgRec["role"] !== "toolResult") continue;
          const content: unknown = msgRec["content"];
          if (!Array.isArray(content)) continue;
          for (const block of content) {
            if (typeof block === "object" && block !== null && (block as Record<string, unknown>)["type"] === "text" && typeof (block as Record<string, unknown>)["text"] === "string") {
              out.push((block as Record<string, unknown>)["text"] as string);
            }
          }
        }
      }
    }
  };
  walk(base);
  return out;
}
interface SummaryUsageRecord {
  turn: number;
  kind: string;
  usage: unknown;
}
interface LifecycleRecord {
  phase: string;
  reason: string | null;
  isCompacting: boolean | null;
  at: number;
  completed?: boolean;
  errorMessage?: string | null;
}
function readLifecycle(agentDir: string): LifecycleRecord[] {
  assert.ok(typeof agentDir === "string" && agentDir.length > 0, "agentDir asserted");
  const p: string = join(agentDir, "compaction-lifecycle.jsonl");
  assert.ok(existsSync(p), "compaction lifecycle file missing (setup failure, not valid zero): " + p);
  const text: string = readFileSync(p, "utf8");
  const out: LifecycleRecord[] = [];
  const lines: string[] = text.split("\n");
  for (let li = 0; li < lines.length; li += 1) {
    const line: string = lines[li] as string;
    if (line.trim().length === 0) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line) as unknown;
    } catch (parseError: unknown) {
      const detail = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error("LIFECYCLE_CORRUPT: " + p + " line " + String(li + 1) + ": " + detail);
    }
    assert.ok(typeof rec === "object" && rec !== null, "lifecycle record asserted object");
    const r = rec as Record<string, unknown>;
    assert.ok(r["phase"] === "start" || r["phase"] === "end", "lifecycle phase asserted");
    assert.ok(r["reason"] === null || typeof r["reason"] === "string", "lifecycle reason asserted");
    assert.ok(typeof r["isCompacting"] === "boolean", "lifecycle isCompacting asserted boolean");
    assert.ok(typeof r["at"] === "number", "lifecycle at asserted");
    out.push(rec as LifecycleRecord);
  }
  return out;
}
function readSummaryUsage(agentDir: string): SummaryUsageRecord[] {
  assert.ok(typeof agentDir === "string" && agentDir.length > 0, "agentDir asserted");
  const p: string = join(agentDir, "summary-usage.jsonl");
  assert.ok(existsSync(p), "summary usage file missing (setup failure, not valid zero): " + p);
  const text: string = readFileSync(p, "utf8");
  const out: SummaryUsageRecord[] = [];
  const lines: string[] = text.split("\n");
  for (let li = 0; li < lines.length; li += 1) {
    const line: string = lines[li] as string;
    if (line.trim().length === 0) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line) as unknown;
    } catch (parseError: unknown) {
      const detail = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error("SUMMARY_USAGE_CORRUPT: " + p + " line " + String(li + 1) + ": " + detail);
    }
    assert.ok(typeof rec === "object" && rec !== null, "summary usage record asserted object");
    const r = rec as Record<string, unknown>;
    assert.ok(typeof r["turn"] === "number", "summary usage turn asserted");
    assert.ok(typeof r["kind"] === "string", "summary usage kind asserted");
    assert.ok(typeof r["usage"] === "object" && r["usage"] !== null, "summary usage payload asserted");
    out.push({ turn: r["turn"] as number, kind: r["kind"] as string, usage: r["usage"] });
  }
  return out.sort((a, b) => a.turn - b.turn);
}
function sumFullUsage(recs: JournalRecord[]): { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number | null; unknown: boolean } {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost: number | null = null;
  let unknown = false;
  for (const r of recs) {
    const body = r.body as Record<string, unknown>;
    const vInput: unknown = body["input"];
    const vOutput: unknown = body["output"];
    const vCacheRead: unknown = body["cacheRead"];
    const vCacheWrite: unknown = body["cacheWrite"];
    const vCost: unknown = body["cost"];
    const vUnknown: unknown = body["unknown"];
    assert.ok(typeof vInput === "number" && Number.isFinite(vInput), "journal input asserted finite");
    assert.ok(typeof vOutput === "number" && Number.isFinite(vOutput), "journal output asserted finite");
    assert.ok(typeof vCacheRead === "number" && Number.isFinite(vCacheRead), "journal cacheRead asserted finite");
    assert.ok(typeof vCacheWrite === "number" && Number.isFinite(vCacheWrite), "journal cacheWrite asserted finite");
    assert.ok(vCost === null || (typeof vCost === "number" && Number.isFinite(vCost)), "journal cost asserted");
    assert.ok(typeof vUnknown === "boolean", "journal unknown asserted boolean");
    input += vInput as number;
    output += vOutput as number;
    cacheRead += vCacheRead as number;
    cacheWrite += vCacheWrite as number;
    if (vCost !== null) cost = (cost ?? 0) + (vCost as number);
    if (vUnknown === true) unknown = true;
  }
  return { input, output, cacheRead, cacheWrite, cost, unknown };
}
async function joinWorkerExits(handles: Array<{ exit: { code: number | null; signal: string | null } | null }>, timeoutMs: number, secondaries: Array<{ phase: string; error: unknown }>): Promise<void> {
  const t0: number = Date.now();
  for (const h of handles) {
    while (h.exit === null && Date.now() - t0 < timeoutMs) await tick(50);
    if (h.exit === null) secondaries.push({ phase: "worker-exit-join", error: new Error("worker exit never joined (teardown failure)") });
  }
}
function throwCombined(primaryThrown: boolean, primary: unknown, secondaries: Array<{ phase: string; error: unknown }>): void {
  if (!primaryThrown && secondaries.length === 0) return;
  const parts: string[] = [];
  if (primaryThrown) parts.push("primary: " + String(primary));
  for (const s of secondaries) parts.push(s.phase + ": " + String(s.error));
  throw new Error(parts.join("; "));
}
function compactionEntries(sessionsDir: string, agentId: string): Array<Record<string, unknown>> {
  assert.ok(typeof sessionsDir === "string" && sessionsDir.length > 0, "sessionsDir asserted");
  assert.ok(typeof agentId === "string" && agentId.length > 0, "agentId asserted");
  const out: Array<Record<string, unknown>> = [];
  const base = join(sessionsDir, agentId);
  assert.ok(existsSync(base), "session dir missing (setup failure): " + base);
  const walk = (d: string): void => {
    const ents = readdirSync(d, { withFileTypes: true });
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const text: string = readFileSync(p, "utf8");
        const lines: string[] = text.split("\n");
        for (let li = 0; li < lines.length; li += 1) {
          const line: string = lines[li] as string;
          if (line.trim().length === 0) continue;
          let rec: unknown;
          try {
            rec = JSON.parse(line) as unknown;
          } catch (parseError: unknown) {
            const detail = parseError instanceof Error ? parseError.message : String(parseError);
            throw new Error("SESSION_CORRUPT: " + p + " line " + String(li + 1) + ": " + detail);
          }
          let entry: unknown = rec;
          if (typeof rec === "object" && rec !== null && "entry" in (rec as Record<string, unknown>)) entry = (rec as Record<string, unknown>)["entry"];
          if (typeof entry === "object" && entry !== null && (entry as Record<string, unknown>)["type"] === "compaction") out.push(entry as Record<string, unknown>);
        }
      }
    }
  };
  walk(base);
  return out;
}

type ProviderEntryKind = "main" | "history" | "prefix";
interface ProviderEntry {
  turn: number;
  provider: string;
  model: string;
  kind: ProviderEntryKind;
  taskRunId: string;
  generation: number;
  agentId: string;
  at: number;
}
function entryLogPath(agentDir: string): string {
  assert.ok(typeof agentDir === "string" && agentDir.length > 0, "agentDir must be a nonempty string (collector setup)");
  const p: string = join(agentDir, ENTRY_LOG);
  const rel: string = relative(agentDir, p);
  assert.ok(rel !== "" && !rel.startsWith("..") && !isAbsolute(rel), `entry log must stay confined in agentDir (got ${p})`);
  return p;
}
function assertCollectorSetup(agentDir: string): string {
  assert.ok(typeof agentDir === "string" && agentDir.length > 0, "agentDir must be set (collector setup)");
  assert.ok(existsSync(agentDir), `collector agentDir missing (setup failure, not valid zero): ${agentDir}`);
  const st = statSync(agentDir);
  assert.ok(st.isDirectory(), `collector agentDir not a directory (setup failure): ${agentDir}`);
  return entryLogPath(agentDir);
}
function parseEntryLine(line: string, lineNo: number): ProviderEntry {
  let v: unknown;
  try {
    v = JSON.parse(line) as unknown;
  } catch (parseError: unknown) {
    const detail = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`ENTRY_CORRUPT: line ${lineNo} malformed JSON: ${detail} :: ${line.slice(0, 200)}`);
  }
  if (typeof v !== "object" || v === null) throw new Error(`ENTRY_CORRUPT: line ${lineNo} must be an object`);
  const rec = v as Record<string, unknown>;
  const turn: unknown = rec["turn"];
  const provider: unknown = rec["provider"];
  const model: unknown = rec["model"];
  const taskRunId: unknown = rec["taskRunId"];
  const generation: unknown = rec["generation"];
  const agentId: unknown = rec["agentId"];
  const at: unknown = rec["at"];
  if (typeof turn !== "number" || !Number.isInteger(turn) || turn <= 0) throw new Error(`ENTRY_CORRUPT: line ${lineNo} turn must be a positive integer`);
  if (typeof provider !== "string" || provider.length === 0) throw new Error(`ENTRY_CORRUPT: line ${lineNo} provider must be a nonempty string`);
  if (typeof model !== "string" || model.length === 0) throw new Error(`ENTRY_CORRUPT: line ${lineNo} model must be a nonempty string`);
  const kind: unknown = rec["kind"];
  if (kind !== "main" && kind !== "history" && kind !== "prefix") throw new Error(`ENTRY_CORRUPT: line ${lineNo} kind must be main/history/prefix (identity fault)`);
  if (typeof taskRunId !== "string" || taskRunId.length === 0) throw new Error(`ENTRY_CORRUPT: line ${lineNo} taskRunId must be a nonempty string (identity fault)`);
  if (typeof generation !== "number" || !Number.isInteger(generation) || generation < 0) throw new Error(`ENTRY_CORRUPT: line ${lineNo} generation must be a nonneg integer (identity fault)`);
  if (typeof agentId !== "string" || agentId.length === 0) throw new Error(`ENTRY_CORRUPT: line ${lineNo} agentId must be a nonempty string (identity fault)`);
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) throw new Error(`ENTRY_CORRUPT: line ${lineNo} at must be a positive finite number`);
  return { turn, provider, model, kind: kind as ProviderEntryKind, taskRunId, generation, agentId, at };
}
function readEntryLog(agentDir: string): ProviderEntry[] {
  const p: string = assertCollectorSetup(agentDir);
  assert.ok(existsSync(p), `ENTRY_MISSING: log file absent when entries required (not valid zero): ${p}`);
  const text: string = readFileSync(p, "utf8");
  const out: ProviderEntry[] = [];
  const lines: string[] = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line: string = lines[i] as string;
    if (line.trim().length === 0) continue;
    out.push(parseEntryLine(line, i + 1));
  }
  return out.sort((a, b) => a.turn - b.turn);
}
function assertZeroEntriesLegitimate(agentDir: string, proof: { settled: boolean; denialObserved: boolean }): void {
  const p: string = assertCollectorSetup(agentDir);
  assert.ok(existsSync(p), `ENTRY_MISSING: configured collector log absent after setup (evidence failure, never legitimate zero): ${p}`);
  const entries: ProviderEntry[] = readEntryLog(agentDir);
  assert.equal(entries.length, 0, `expected zero entries but found ${entries.length} (actual counter)`);
  assert.equal(proof.settled, true, "zero entries require settled run proof");
  assert.equal(proof.denialObserved, true, "zero entries require observed denial proof");
}
async function waitEntryCount(agentDir: string, n: number, timeoutMs: number): Promise<ProviderEntry[]> {
  assert.ok(Number.isInteger(n) && n > 0, "wait count must be a positive integer");
  assert.ok(typeof agentDir === "string" && agentDir.length > 0, "agentDir must be set (wait setup)");
  const p: string = entryLogPath(agentDir);
  const t0: number = Date.now();
  let cur: ProviderEntry[] = [];
  while (Date.now() - t0 < timeoutMs) {
    if (!existsSync(agentDir)) {
      await tick(50);
      continue;
    }
    if (existsSync(p)) {
      cur = readEntryLog(agentDir);
      if (cur.length >= n) break;
    }
    await tick(50);
  }
  return cur;
}

interface AdmissionTrace {
  reason: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  taskRunId: string | null;
  generation: number | null;
  ok: boolean;
  code: string;
  at: number;
}
/** Public-setter fixture wrapper: records each admission query/denial, calls
 * the captured Supervisor handler unchanged (no priSup mutation). */
function traceableHandle(handle: WorkerHandle, trace: AdmissionTrace[]): WorkerHandle {
  const orig = handle.setProviderAdmissionRequestHandler.bind(handle);
  handle.setProviderAdmissionRequestHandler = ((cb: ProviderAdmissionHandler): void => {
    orig(async (payload, env) => {
      const res = await cb(payload, env);
      assert.ok(typeof payload.reason === "string" && payload.reason.length > 0, "admission payload.reason must be nonempty (trace setup)");
      assert.ok(typeof payload.provider === "string" && payload.provider.length > 0, "admission payload.provider must be nonempty (trace setup)");
      assert.ok(typeof payload.modelId === "string" && payload.modelId.length > 0, "admission payload.modelId must be nonempty (trace setup)");
      assert.ok(typeof payload.thinkingLevel === "string", "admission payload.thinkingLevel must be a string (trace setup)");
      const envTask: unknown = env?.taskRunId;
      const envGen: unknown = env?.executionGeneration;
      assert.ok(typeof envTask === "string" && envTask.length > 0, `admission envelope taskRunId must be nonempty (got ${String(envTask)})`);
      assert.ok(typeof envGen === "number" && Number.isInteger(envGen) && envGen >= 0, `admission envelope generation must be nonneg integer (got ${String(envGen)})`);
      const code: unknown = res.ok ? "OK" : res.code;
      assert.ok(typeof code === "string" && code.length > 0, `admission denial code must be nonempty (got ${String(code)})`);
      trace.push({
        reason: payload.reason,
        provider: payload.provider,
        modelId: payload.modelId,
        thinkingLevel: payload.thinkingLevel,
        taskRunId: envTask as string,
        generation: envGen as number,
        ok: res.ok,
        code: code as string,
        at: Date.now(),
      });
      return res;
    });
  }) as typeof handle.setProviderAdmissionRequestHandler;
  return handle;
}

interface AssistantResponse {
  role: unknown;
  provider: unknown;
  model: unknown;
  stopReason: unknown;
  errorMessage: unknown;
  usage: unknown;
  content: unknown;
}
function assistantEntries(sessionsDir: string, agentId: string): AssistantResponse[] {
  assert.ok(typeof sessionsDir === "string" && sessionsDir.length > 0, "sessionsDir must be set (session setup)");
  assert.ok(typeof agentId === "string" && agentId.length > 0, "agentId must be set (session setup)");
  const out: AssistantResponse[] = [];
  const base = join(sessionsDir, agentId);
  assert.ok(existsSync(base), `session dir missing (setup failure, not valid zero): ${base}`);
  const walk = (d: string): void => {
    const ents = readdirSync(d, { withFileTypes: true });
    for (const e of ents) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) {
        const text: string = readFileSync(p, "utf8");
        const lines: string[] = text.split("\n");
        for (let li = 0; li < lines.length; li += 1) {
          const line: string = lines[li] as string;
          if (line.trim().length === 0) continue;
          let rec: unknown;
          try {
            rec = JSON.parse(line) as unknown;
          } catch (parseError: unknown) {
            const detail = parseError instanceof Error ? parseError.message : String(parseError);
            throw new Error(`SESSION_CORRUPT: ${p} line ${li + 1} malformed JSON: ${detail}`);
          }
          let msg: unknown;
          if (typeof rec === "object" && rec !== null && "message" in (rec as Record<string, unknown>)) {
            msg = (rec as Record<string, unknown>)["message"];
          } else {
            msg = rec;
          }
          if (typeof msg === "object" && msg !== null && (msg as Record<string, unknown>)["role"] === "assistant") out.push(msg as AssistantResponse);
        }
      }
    }
  };
  walk(base);
  return out.filter((m) => m.provider === "test-sim" && m.model === "sim-1");
}
/** Physical completions only (toolUse/stop); routing-error rows excluded. */
function physicalEntries(sessionsDir: string, agentId: string): AssistantResponse[] {
  return assistantEntries(sessionsDir, agentId).filter((m) => m.stopReason === "toolUse" || m.stopReason === "stop");
}
function errorEntries(sessionsDir: string, agentId: string): AssistantResponse[] {
  return assistantEntries(sessionsDir, agentId).filter((m) => m.stopReason === "error");
}
function usageOf(m: AssistantResponse): { input: number; output: number } {
  const u: unknown = m.usage;
  assert.ok(typeof u === "object" && u !== null, "assistant usage must be an object (asserted record)");
  const rec = u as Record<string, unknown>;
  const input: unknown = rec["input"];
  const output: unknown = rec["output"];
  assert.ok(typeof input === "number" && Number.isFinite(input), `usage input must be finite number (got ${String(input)})`);
  assert.ok(typeof output === "number" && Number.isFinite(output), `usage output must be finite number (got ${String(output)})`);
  return { input, output };
}
function assertTerminalRecord(term: Record<string, unknown> | null, what: string): Record<string, unknown> {
  assert.ok(term !== null, `${what} terminal never observed (setup failure)`);
  const outcome: unknown = term["outcome"];
  assert.ok(typeof outcome === "string" && outcome.length > 0, `${what} terminal outcome must be a nonempty string (asserted record)`);
  return term;
}
function terminalOutcome(term: Record<string, unknown>): string {
  const outcome: unknown = term["outcome"];
  assert.ok(typeof outcome === "string", "terminal outcome must be string (asserted record)");
  return outcome;
}
function terminalDetail(term: Record<string, unknown>): string {
  const detail: unknown = term["detail"];
  const err: unknown = term["error"];
  if (typeof detail === "string" && detail.length > 0) return detail;
  if (typeof err === "string" && err.length > 0) return err;
  return JSON.stringify(term);
}
function seqOf(rec: JournalRecord | undefined, what: string): number {
  assert.ok(rec !== undefined, `${what} record missing (setup failure)`);
  assert.ok(typeof rec.seq === "number" && Number.isInteger(rec.seq) && rec.seq > 0, `${what} seq must be positive integer (asserted record)`);
  return rec.seq;
}
function errorText(m: AssistantResponse, what: string): string {
  assert.ok(typeof m.errorMessage === "string" && (m.errorMessage as string).length > 0, `${what} errorMessage must be nonempty string (asserted record)`);
  return m.errorMessage as string;
}
function assertFirstEntry(entries: ProviderEntry[], what: string): ProviderEntry {
  assert.ok(entries.length >= 1, `${what} ENTRY never observed (setup failure)`);
  const first: ProviderEntry = entries[0] as ProviderEntry;
  assert.ok(typeof first.provider === "string" && first.provider.length > 0, `${what} ENTRY provider asserted`);
  return first;
}
async function waitTerminal(sup: Supervisor, taskRunId: TaskRunId, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const t0 = Date.now();
  let term: Record<string, unknown> | null = null;
  while (term === null && Date.now() - t0 < timeoutMs) {
    const found = records(sup).find((r) => r.kind === "task.terminal" && strBody(r, "taskRunId") === taskRunId);
    term = found ? found.body : null;
    if (term === null) await tick(100);
  }
  return term;
}
async function operativeCgOp(sup: Supervisor, taskRunId: TaskRunId, timeoutMs: number): Promise<{ op: string } | null> {
  const t0 = Date.now();
  let found: { op: string } | null = null;
  while (found === null && Date.now() - t0 < timeoutMs) {
    const recs = records(sup);
    const intents = recs.filter((r) => r.kind === "tool.intent" && r.body["external"] === true && strBody(r, "tool") === CG && strBody(r, "taskRunId") === taskRunId);
    for (const i of intents) {
      const op: string | null = strBody(i, "operationId");
      if (op === null || op.length === 0) continue;
      if (recs.some((r) => r.kind === "tool.outcome" && strBody(r, "operationId") === op)) {
        found = { op };
        break;
      }
    }
    if (found === null) {
      if (recs.some((r) => r.kind === "task.terminal" && strBody(r, "taskRunId") === taskRunId)) break;
      await tick(50);
    }
  }
  return found;
}

const cgUsage = async (): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, never>; usage: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } } }> => ({
  content: [{ type: "text", text: "x" }],
  details: {},
  usage: { input: EXPECTED_INPUT, output: EXPECTED_OUTPUT, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

function faultableRunStore(base: InMemoryRunStore, st: { armed: boolean; firedOp: string | null; count: number }): RunStore {
  return new Proxy(base, {
    get(tgt: RunStore, prop: string | symbol): unknown {
      if (prop === "append") {
        return (kind: JournalKind, body: Record<string, unknown>): JournalRecord => {
          if (st.armed && kind === "usage.reported" && body["external"] === true) {
            st.armed = false;
            const op: unknown = body["operationId"];
            st.firedOp = typeof op === "string" ? op : "?";
            st.count += 1;
            throw Object.assign(new Error("STORE_FAILED: injected preappend crash on CG billing commit"), { code: "STORE_FAILED" });
          }
          return tgt.append(kind, body);
        };
      }
      const value: unknown = Reflect.get(tgt, prop, tgt);
      return typeof value === "function" ? value.bind(tgt) : value;
    },
  });
}

function agentsOf(sup: Supervisor): Map<string, { worker: unknown; runnableLease: unknown; residentLease: unknown }> {
  return (sup as unknown as { agents: Map<string, { worker: unknown; runnableLease: unknown; residentLease: unknown }> }).agents;
}

test("provider-start hold: worker continuation ASK denied BEFORE entry while held (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdfix-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const SCRIPT = [{ tool: CG, args: { q: "x" } }, { text: "done" }];
      const base = new InMemoryRunStore("root-provholdfix");
      const st = { armed: true, firedOp: null as string | null, count: 0 };
      const store = faultableRunStore(base, st);
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdfix",
        rootDir: join(dir, "root"),
        store,
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
      });
      try {
        const g1 = await sup.spawn("governor", { taskName: "two-turn", message: "do CG then text", profile: "writer", isolation: "none" }, "provholdfix-1");
        const agentDir1 = join(dir, "worker-home", g1.agentId);
        // First ENTRY pre-hold: callback ENTRY 1 + journal causality (intent<outcome<fault).
        const e1 = await waitEntryCount(agentDir1, 1, OPERATIVE_TIMEOUT_MS);
        assert.ok(e1.length >= 1, "ENTRY 1 never observed (setup failure)");
        assert.equal(e1[0].provider, "test-sim", "ENTRY 1 provider (setup failure)");
        assert.equal(e1[0].taskRunId, g1.taskRunId, "ENTRY 1 task ownership (setup failure)");
        const found = await operativeCgOp(sup, g1.taskRunId, OPERATIVE_TIMEOUT_MS);
        assert.ok(found, "no outcome-backed CG op (setup failure)");
        assert.equal(st.firedOp, found.op, "fault fired for genuine op (setup failure)");
        assert.equal(st.count, 1, "exactly one preappend firing (setup failure)");
        const recs = records(sup);
        const intentSeq = seqOf(recs.find((r) => r.kind === "tool.intent" && strBody(r, "tool") === CG && strBody(r, "taskRunId") === g1.taskRunId), "intent");
        const outcomeSeq = seqOf(recs.find((r) => r.kind === "tool.outcome" && strBody(r, "operationId") === found.op), "outcome");
        const faultSeq = seqOf(recs.find((r) => r.kind === "recovery.event" && strBody(r, "phase") === "controller_error"), "fault");
        assert.ok(intentSeq > 0 && outcomeSeq > intentSeq && faultSeq > outcomeSeq, "ENTRY 1 pre-hold via journal order (setup failure)");
        assert.equal(sup.needsRecovery, true, "hold true after billing fault (setup failure)");
        // Continuation ASK denied BEFORE provider entry: terminal fails with hold
        // code; ZERO new callback entries; trace shows ASK+deny while held.
        const term1 = await waitTerminal(sup, g1.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.ok(term1, "terminal never observed (setup failure)");
        const term1R = assertTerminalRecord(term1, "terminal");
        assert.notEqual(terminalOutcome(term1R), "succeeded", "held continuation must NOT succeed (fixed denies)");
        assert.match(terminalDetail(term1R), new RegExp(HOLD_CODE), "terminal carries visible hold code (actual reason)");
        assert.equal(readEntryLog(agentDir1).length, 1, "zero additional provider entries while held (actual ENTRY counter)");
        const denied = trace.filter((q) => q.taskRunId === g1.taskRunId && q.ok === false);
        assert.ok(denied.length >= 1, "admission ASK traced while held (setup failure)");
        assert.ok(denied.some((q) => q.code === HOLD_CODE), `typed denial carries exact hold code (actual: ${denied.map((q) => q.code).join(",")})`);
        const completions = physicalEntries(sessionsDir, g1.agentId);
        assert.ok(completions.length <= 1, "no second physical completion while held");
        const errs = errorEntries(sessionsDir, g1.agentId);
        assert.ok(errs.length >= 1, "typed routing denial recorded (setup failure)");
        assert.match(errorText(errs[0], "denial"), new RegExp(HOLD_CODE), "denial exact hold code (actual reason)");
        // Hold persists through idle filesystem healing (no timer clears it).
        await tick(800);
        assert.equal(sup.needsRecovery, true, "hold persists across idle");
        assert.equal(readEntryLog(agentDir1).length, 1, "idle adds no entries");
        // Held NEW task denied (current policy control, actual code).
        await assert.rejects(
          () => sup.spawn("governor", { taskName: "held-new", message: "m", profile: "writer", isolation: "none" }, "provholdfix-2"),
          new RegExp(HOLD_CODE),
        );
        // Explicit recovery bills debt once (real assertion), clears hold.
        await sup.recover();
        const debt = extReports(sup, found.op);
        assert.equal(debt.length, 1, "recover bills debt exactly once (actual count)");
        assert.deepEqual(sumUsage(debt), { input: EXPECTED_INPUT, output: EXPECTED_OUTPUT }, "debt exact 5/7 (actual sum)");
        assert.equal(sup.needsRecovery, false, "hold cleared after genuine recovery");
        // Fresh current-generation model enters exactly once post-recovery.
        const g2 = await sup.spawn("governor", { taskName: "after", message: "go", profile: "writer", isolation: "none" }, "provholdfix-3");
        const agentDir2 = join(dir, "worker-home", g2.agentId);
        const eAfter = await waitEntryCount(agentDir2, 2, TERMINAL_TIMEOUT_MS);
        assert.ok(eAfter.length >= 2, "post-recovery two-turn positive (setup failure)");
        assert.ok(eAfter.every((e) => e.taskRunId === g2.taskRunId), "post-recovery entries task-owned");
        const term2 = await waitTerminal(sup, g2.taskRunId, TERMINAL_TIMEOUT_MS);
        const term2R = assertTerminalRecord(term2, "terminal");
        assert.equal(terminalOutcome(term2R), "succeeded", "post-recovery run settles; generation/task/teardown survive");
      } finally {
        await sup.shutdown();
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: healthy two-turn enters (control, passes)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdfixh-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const SCRIPT = [{ tool: CG, args: { q: "x" } }, { text: "done" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdfixh",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdfixh"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "two-turn", message: "go", profile: "writer", isolation: "none" }, "provholdfixh-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const entries = await waitEntryCount(agentDir, 2, TERMINAL_TIMEOUT_MS);
        assert.ok(entries.length >= 2, "healthy two-turn entries missing (setup failure)");
        assert.ok(entries.every((e) => e.taskRunId === g.taskRunId), "entries task-owned");
        assert.ok(trace.filter((q) => q.taskRunId === g.taskRunId && q.ok === true).length >= 2, "both queries allowed healthy (actual trace)");
        assert.equal(sup.needsRecovery, false, "healthy hold false");
        const term = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const termR = assertTerminalRecord(term, "terminal");
        assert.equal(terminalOutcome(termR), "succeeded", "healthy settles");
      } finally {
        await sup.shutdown();
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: healthy retryable-error retries through guard (control, passes)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdretry-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      // Retry-classified provider error (pinned pi-ai retry.ts: "overloaded"
      // + "retry your request"; no NON_OVERFLOW/quota/billing/overflow text).
      // SDK auto-retries (reason retry, ~2s backoff) through the SAME wrapper;
      // healthy retry admitted: 3 callback ENTRYs (text, error, text-done).
      const RETRYABLE = "upstream overloaded (server busy), please retry your request";
      const RETRY_SCRIPT = [{ tool: "read", args: { path: READ_PATH } }, { error: RETRYABLE }, { text: "done" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdretry",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdretry"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: RETRY_SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "retry", message: "go", profile: "writer", isolation: "none" }, "provholdretry-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const entries = await waitEntryCount(agentDir, 3, TERMINAL_TIMEOUT_MS);
        assert.ok(entries.length >= 3, "healthy retry entries missing (setup failure: text+error+retry-text)");
        assert.ok(entries.every((e) => e.taskRunId === g.taskRunId), "entries task-owned");
        assert.ok(trace.filter((q) => q.taskRunId === g.taskRunId && q.ok === true).length >= 3, "retry-path queries allowed healthy (actual trace: initial+retry)");
        assert.equal(sup.needsRecovery, false, "healthy hold false");
        const term = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const termR = assertTerminalRecord(term, "terminal");
        assert.equal(terminalOutcome(termR), "succeeded", "healthy retry recovers and settles");
      } finally {
        await sup.shutdown();
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: managed reviewer continuation ASK denied BEFORE entry while held (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdrev-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const REVIEWER_SCRIPT = [{ tool: "read", args: { path: READ_PATH } }, { text: "review note" }];
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const base = new InMemoryRunStore("root-provholdrev");
      const st = { armed: true, firedOp: null as string | null, count: 0 };
      const store = faultableRunStore(base, st);
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const gates = new Map<string, () => void>();
      const hung = (_spec: { operationId: string }): Promise<{ stdout: string; stderr: string; exitCode: number; signal: null; timedOut: boolean; truncated: boolean }> =>
        new Promise((resolve) => {
          gates.set(_spec.operationId, () => resolve({ stdout: "hello-model-bytes", stderr: "", exitCode: 0, signal: null, timedOut: false, truncated: false }));
        });
      executors.host.handler = hung as unknown as DummyToolExecutor["handler"];
      executors.sandbox.handler = hung as unknown as DummyToolExecutor["handler"];
      let factoryCalls = 0;
      const holders: CtlWorker[] = [];
      const candidates: CtlWorker[] = [];
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdrev",
        rootDir: join(dir, "root"),
        store,
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          factoryCalls += 1;
          if (factoryCalls === 1 || factoryCalls === 2 || factoryCalls === 4) {
            const w = new CtlWorker(o.agentId);
            if (factoryCalls === 1) holders.push(w);
            else candidates.push(w);
            return w;
          }
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: REVIEWER_SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
      });
      try {
        const holder = await sup.spawn("governor", { taskName: "holder", message: "hold", profile: "writer", isolation: "none" }, "provholdrev-h");
        await tick(100);
        const candidate = await sup.spawn("governor", { taskName: "gated", message: "go", profile: "reader", gate: { ...gateSpec(3) } }, "provholdrev-1");
        await tick(100);
        const candWorker = candidates.find((w) => w.agentId === candidate.agentId);
        assert.ok(candWorker, "candidate worker missing (setup failure)");
        candWorker.settle("succeeded", "candidate work");
        const tLink = Date.now();
        let reviewerId: string | null = null;
        while (Date.now() - tLink < OPERATIVE_TIMEOUT_MS) {
          reviewerId = sup.gateController.inspect(candidate.taskRunId)?.reviewerId ?? null;
          if (reviewerId) break;
          await tick(100);
        }
        assert.ok(reviewerId, "reviewer never linked (setup failure)");
        const revId: string = reviewerId;
        const revAgentDir = join(dir, "worker-home", revId);
        const revFirst = await waitEntryCount(revAgentDir, 1, OPERATIVE_TIMEOUT_MS);
        assert.ok(revFirst.length >= 1, "reviewer ENTRY 1 never observed (setup failure)");
        assert.equal(revFirst[0].provider, "test-sim", "reviewer ENTRY provider-owned (setup failure)");
        assert.ok(typeof revFirst[0].taskRunId === "string" && (revFirst[0].taskRunId as string).length > 0, "reviewer ENTRY task-owned (setup failure)");
        assert.equal(revFirst[0].agentId, revId, "reviewer ENTRY session-owned (setup failure)");
        assert.ok(factoryCalls >= 3, "reviewer worker launched (setup failure)");
        const holderWorker = holders.find((w) => w.agentId === holder.agentId);
        assert.ok(holderWorker, "holder worker missing (setup failure)");
        const cgRes = await holderWorker.call(CG, { q: "x" });
        assert.equal(cgRes.isError, false, "holder CG admitted pre-hold (setup failure)");
        assert.ok(st.firedOp !== null, "billing fault never fired (setup failure)");
        assert.equal(st.count, 1, "exactly one preappend firing (setup failure)");
        assert.equal(sup.needsRecovery, true, "hold true after genuine other-actor fault (setup failure)");
        for (const [, rel] of [...gates]) rel();
        gates.clear();
        const tFail = Date.now();
        while (Date.now() - tFail < TERMINAL_TIMEOUT_MS) {
          if (readEntryLog(revAgentDir).length >= 1 && errorEntries(sessionsDir, revId).some((m) => errorText(m, "denial").includes(HOLD_CODE))) break;
          const reviewStatus: unknown = sup.gateController.inspect(candidate.taskRunId)?.review?.status ?? null;
          if (reviewStatus === "interrupted") break;
          await tick(100);
        }
        assert.equal(readEntryLog(revAgentDir).length, 1, "zero additional reviewer provider entries while held (actual ENTRY counter)");
        const revErrs = errorEntries(sessionsDir, revId);
        assert.ok(revErrs.length >= 1, "typed reviewer routing denial recorded (setup failure)");
        assert.match(errorText(revErrs[0], "denial"), new RegExp(HOLD_CODE), "reviewer denial exact hold code (actual reason)");
        const revDenied = trace.filter((q) => q.ok === false);
        assert.ok(revDenied.some((q) => q.code === HOLD_CODE), `admission ASK traced with hold code (actual: ${revDenied.map((q) => q.code).join(",")})`);
        assert.equal(records(sup).filter((r) => r.kind === "tool.intent" && strBody(r, "tool") === CG && strBody(r, "agentId") === revId).length, 0, "reviewer issued no generic MCP call");
        executors.host.handler = null;
        executors.sandbox.handler = null;
        await sup.recover();
        assert.equal(sup.needsRecovery, false, "hold cleared after genuine recovery");
        const candidate2 = await sup.spawn("governor", { taskName: "gated2", message: "go", profile: "reader", gate: { ...gateSpec(3) } }, "provholdrev-4");
        await tick(100);
        const candWorker2 = candidates.find((w) => w.agentId === candidate2.agentId);
        assert.ok(candWorker2, "second candidate missing (setup failure)");
        candWorker2.settle("succeeded", "candidate work 2");
        const tLink2 = Date.now();
        let reviewerId2: string | null = null;
        while (Date.now() - tLink2 < OPERATIVE_TIMEOUT_MS) {
          reviewerId2 = sup.gateController.inspect(candidate2.taskRunId)?.reviewerId ?? null;
          if (reviewerId2) break;
          await tick(100);
        }
        assert.ok(reviewerId2, "second reviewer never linked (setup failure)");
        const revPost = await waitEntryCount(join(dir, "worker-home", reviewerId2 as string), 2, TERMINAL_TIMEOUT_MS);
        assert.ok(revPost.length >= 2, "post-recovery reviewer ENTRY resumes (setup failure)");
        await sup.shutdown();
        const rrt = agentsOf(sup).get(revId);
        assert.ok(rrt !== undefined, "reviewer runtime record must exist for lease audit (asserted record)");
        assert.equal(rrt.worker, null, "reviewer worker retired");
        assert.equal(rrt.runnableLease, null, "runnable lease freed");
        assert.equal(rrt.residentLease, null, "resident lease freed");
      } catch (e: unknown) {
        primaryThrown = true;
        primary = e;
        try {
          await sup.shutdown();
        } catch (e2: unknown) {
          throw new Error(`primary: ${String(e)}; shutdown: ${String(e2)}`);
        }
        throw e;
      }
    } catch (e: unknown) {
      if (!primaryThrown) { primaryThrown = true; primary = e; }
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: healthy reviewer two-turn enters (control, passes)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdrevh-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const REVIEWER_SCRIPT = [{ tool: "read", args: { path: READ_PATH } }, { text: "review note" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      let factoryCalls = 0;
      const candidates: CtlWorker[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdrevh",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdrevh"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          factoryCalls += 1;
          if (factoryCalls === 1) {
            const w = new CtlWorker(o.agentId);
            candidates.push(w);
            return w;
          }
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          return new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: REVIEWER_SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const candidate = await sup.spawn("governor", { taskName: "gated", message: "go", profile: "reader", gate: { ...gateSpec(3) } }, "provholdrevh-1");
        await tick(100);
        const candWorker = candidates.find((w) => w.agentId === candidate.agentId);
        assert.ok(candWorker, "candidate missing (setup failure)");
        candWorker.settle("succeeded", "candidate work");
        const tLink = Date.now();
        let reviewerId: string | null = null;
        while (Date.now() - tLink < OPERATIVE_TIMEOUT_MS) {
          reviewerId = sup.gateController.inspect(candidate.taskRunId)?.reviewerId ?? null;
          if (reviewerId) break;
          await tick(100);
        }
        assert.ok(reviewerId, "reviewer never linked (setup failure)");
        const entries = await waitEntryCount(join(dir, "worker-home", reviewerId as string), 2, TERMINAL_TIMEOUT_MS);
        assert.ok(entries.length >= 2, "healthy reviewer two-turn missing (setup failure)");
        assert.ok(entries.every((e) => e.provider === "test-sim" && e.model === "sim-1"), "entries provider-owned");
        assert.equal(sup.needsRecovery, false, "healthy hold false");
        assert.ok((sup.gateController.inspect(candidate.taskRunId)?.reviewerId ?? null) !== null, "reviewer linked healthy");
      } finally {
        await sup.shutdown();
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: missing infrastructure denies visibly with zero ENTRY (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdnoinfra-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    let handle: { kill: () => void; exit: { code: number | null; signal: string | null } | null } | null = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      // Direct WorkerHandle WITHOUT any Supervisor admission handler: the parent
      // transport answers UNSUPPORTED. Fixed behavior denies visibly with typed
      // UNSUPPORTED + zero actual callback ENTRY immediately (never legacy allow,
      // no wait for forbidden fault/success).
      const SCRIPT = [{ text: "hello direct" }];
      const { WorkerHandle: WH } = await import("../src/worker-launch.ts");
      const { bindChannel: bc } = await import("../src/protocol.ts");
      const agentDir = join(dir, "worker-home", "agent-direct");
      const binding = bc("epoch-direct", "agent-direct", "instance-direct");
      const handle0 = new WH({
        workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
        rootEpoch: "epoch-direct", agentId: "agent-direct", sdkRoot, deterministic: true,
        agentDir, sessionsDir, hostAgentDir: join(dir, "host-agent"),
        script: SCRIPT,
        extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
      }, binding);
      handle = handle0;
      const events: Array<{ kind: string }> = [];
      handle0.setEventHandler((e) => {
        events.push({ kind: e.kind });
      });
      // NOTE: no setProviderAdmissionRequestHandler — parent answers UNSUPPORTED.
      await handle0.launch();
      const ackRaw: unknown = await handle0.request("initialize", {
        taskText: "hello direct",
        profile: "reader",
        instructionHash: "",
        instructions: { contextFiles: [], skills: [] },
        model: { provider: "openai", id: "deterministic-test", thinkingLevel: "off" },
        taskRunId: "task-direct",
        executionGeneration: 1,
        workdir: dir,
        readRoots: [dir],
        writable: false,
        tools: [],
      }, { taskRunId: "task-direct", generation: 1, timeoutMs: 60000 });
      assert.ok(typeof ackRaw === "object" && ackRaw !== null, "direct initialize ack must be a record (asserted)");
      assert.equal((ackRaw as Record<string, unknown>)["ok"], true, "direct initialize admitted (setup failure)");
      const collector: unknown = (ackRaw as Record<string, unknown>)["collector"];
      assert.ok(typeof collector === "object" && collector !== null, "collector readiness asserted in initialize ack (independent of ENTRY)");
      assert.deepEqual(collector as Record<string, unknown>, { name: ENTRY_LOG, ready: true }, "collector configured name + ready (actual ack)");
      assertCollectorSetup(agentDir);
      const t0 = Date.now();
      while (Date.now() - t0 < 15000) {
        if (events.some((e) => e.kind === "settled")) break;
        await tick(100);
      }
      assert.ok(events.some((e) => e.kind === "settled"), "direct run settled (setup failure)");
      const errs = errorEntries(sessionsDir, "agent-direct");
      assert.ok(errs.length >= 1, "denial error entries must exist (asserted record)");
      const denialTexts: string[] = errs.map((m) => {
        assert.ok(typeof m.errorMessage === "string", "errorMessage must be a string (asserted record)");
        return m.errorMessage as string;
      });
      assert.ok(denialTexts.some((t) => t.includes(UNSUPPORTED_CODE)), `denial carries typed UNSUPPORTED (actual: ${denialTexts.join("|").slice(0, 200)})`);
      assertZeroEntriesLegitimate(agentDir, { settled: true, denialObserved: true });
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    let killThrown = false;
    let killError: unknown = null;
    try {
      if (handle !== null) handle.kill();
    } catch (e2: unknown) {
      killThrown = true;
      killError = e2;
    }
    if (handle !== null) {
      const t0 = Date.now();
      while (handle.exit === null && Date.now() - t0 < 15000) await tick(50);
      assert.ok(handle.exit !== null, "worker exit must join before cleanup (actual public exit)");
    }
    if (killThrown) {
      if (!primaryThrown) throw killError;
      throw new Error(`primary: ${String(primary)}; kill: ${String(killError)}`);
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: continuation-specific unavailable denies next ENTRY (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdnext-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      // Supervisor-managed worker; public setter wrapper delegates the FIRST
      // admission query to the captured original handler unchanged, then
      // returns required IPC UNSUPPORTED for the NEXT query (genuine public
      // channel setup simulating mid-run infrastructure loss). Fixed asserts
      // causal first-allow + second-query UNSUPPORTED denial + zero NEXT ENTRY
      // + truthful terminal/accounting (matching UNSUPPORTED expected, NOT
      // REC_OWNER — infrastructure unavailable is distinct from debt hold).
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const SCRIPT = [{ tool: CG, args: { q: "x" } }, { text: "done" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      let calls = 0;
      const sup = new Supervisor({
        rootId: "root-provholdnext",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdnext"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          const origSet = handle.setProviderAdmissionRequestHandler.bind(handle);
          handle.setProviderAdmissionRequestHandler = ((cb: ProviderAdmissionHandler): void => {
            origSet(async (payload, env) => {
              calls += 1;
              if (calls === 1) return cb(payload, env);
              const denied = { ok: false, code: UNSUPPORTED_CODE, error: `${UNSUPPORTED_CODE}: provider admission unavailable mid-run (injected)` } as const;
              assert.ok(typeof payload.reason === "string" && payload.reason.length > 0, "injected trace payload.reason nonempty");
              assert.ok(typeof payload.provider === "string" && payload.provider.length > 0, "injected trace payload.provider nonempty");
              assert.ok(typeof payload.modelId === "string" && payload.modelId.length > 0, "injected trace payload.modelId nonempty");
              assert.ok(typeof payload.thinkingLevel === "string", "injected trace thinkingLevel string");
              const injTask: unknown = env?.taskRunId;
              const injGen: unknown = env?.executionGeneration;
              assert.ok(typeof injTask === "string" && injTask.length > 0, `injected trace taskRunId nonempty (got ${String(injTask)})`);
              assert.ok(typeof injGen === "number" && Number.isInteger(injGen) && injGen >= 0, `injected trace generation nonneg (got ${String(injGen)})`);
              trace.push({
                reason: payload.reason,
                provider: payload.provider,
                modelId: payload.modelId,
                thinkingLevel: payload.thinkingLevel,
                taskRunId: injTask as string,
                generation: injGen as number,
                ok: false,
                code: UNSUPPORTED_CODE,
                at: Date.now(),
              });
              return denied;
            });
          }) as typeof handle.setProviderAdmissionRequestHandler;
          const traced = traceableHandle(handle, trace);
          return traced;
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
      });
      try {
        const g1 = await sup.spawn("governor", { taskName: "two-turn", message: "go", profile: "writer", isolation: "none" }, "provholdnext-1");
        const agentDir1 = join(dir, "worker-home", g1.agentId);
        const term1 = await waitTerminal(sup, g1.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.ok(term1, "terminal never observed (setup failure)");
        const term1R = assertTerminalRecord(term1, "terminal");
        assert.notEqual(terminalOutcome(term1R), "succeeded", "unavailable continuation must NOT succeed");
        const denied = trace.filter((q) => q.taskRunId === g1.taskRunId && q.ok === false);
        assert.ok(denied.length >= 1, "second-query denial traced (setup failure)");
        assert.ok(denied.some((q) => q.code === UNSUPPORTED_CODE), `denial matches UNSUPPORTED expected (actual: ${denied.map((q) => q.code).join(",")})`);
        assert.equal(readEntryLog(agentDir1).length, 1, "zero NEXT ENTRY after unavailable (actual counter)");
        assert.equal(sup.needsRecovery, false, "no debt hold (infrastructure distinct from debt)");
      } finally {
        await sup.shutdown();
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: held retry denied during backoff window (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdheldretry-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      // Retry backoff (~2s default baseDelayMs) gives a genuine parent window:
      // worker turn 2 fails retryable (admitted pre-hold), parent observes the
      // error ENTRY then creates hold via a SEPARATE genuinely admitted holder
      // actor, and the scheduled retry ASK is denied (zero 3rd ENTRY).
      const RETRYABLE = "upstream overloaded (server busy), please retry your request";
      const RETRY_SCRIPT = [{ tool: "read", args: { path: READ_PATH } }, { error: RETRYABLE }, { text: "done" }];
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const base = new InMemoryRunStore("root-provholdheldretry");
      const st = { armed: true, firedOp: null as string | null, count: 0 };
      const store = faultableRunStore(base, st);
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      let factoryCalls = 0;
      const holders: CtlWorker[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdheldretry",
        rootDir: join(dir, "root"),
        store,
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          factoryCalls += 1;
          if (factoryCalls === 1) {
            const w = new CtlWorker(o.agentId);
            holders.push(w);
            return w;
          }
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: RETRY_SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
      });
      try {
        const holder = await sup.spawn("governor", { taskName: "holder", message: "hold", profile: "writer", isolation: "none" }, "provholdheldretry-h");
        await tick(100);
        const g1 = await sup.spawn("governor", { taskName: "retry", message: "go", profile: "writer", isolation: "none" }, "provholdheldretry-1");
        const agentDir1 = join(dir, "worker-home", g1.agentId);
        // Error ENTRY admitted pre-hold (no hold exists yet: fault not fired).
        const e2 = await waitEntryCount(agentDir1, 2, OPERATIVE_TIMEOUT_MS);
        assert.ok(e2.length >= 2, "error ENTRY never observed pre-hold (setup failure)");
        assert.equal(sup.needsRecovery, false, "no hold before holder fault (setup failure)");
        // Create hold inside the retry backoff window via separate actor.
        const holderWorker = holders.find((w) => w.agentId === holder.agentId);
        assert.ok(holderWorker, "holder missing (setup failure)");
        const cgRes = await holderWorker.call(CG, { q: "x" });
        assert.equal(cgRes.isError, false, "holder CG admitted (setup failure)");
        assert.ok(st.firedOp !== null, "holder billing fault never fired (setup failure)");
        assert.equal(sup.needsRecovery, true, "hold true before scheduled retry (setup failure)");
        // Scheduled retry ASK denied: zero 3rd ENTRY, terminal failed hold code.
        const term1 = await waitTerminal(sup, g1.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.ok(term1, "terminal never observed (setup failure)");
        const term1R = assertTerminalRecord(term1, "terminal");
        assert.notEqual(terminalOutcome(term1R), "succeeded", "held retry must NOT succeed (fixed denies)");
        assert.match(terminalDetail(term1R), new RegExp(HOLD_CODE), "terminal hold code (actual reason)");
        assert.equal(readEntryLog(agentDir1).length, 2, "zero retry ENTRY while held (actual counter)");
        const denied = trace.filter((q) => q.taskRunId === g1.taskRunId && q.ok === false);
        assert.ok(denied.some((q) => q.code === HOLD_CODE), `retry ASK denied with hold code (actual: ${denied.map((q) => q.code).join(",")})`);
        await sup.recover();
        assert.equal(sup.needsRecovery, false, "hold cleared after genuine recovery");
      } finally {
        await sup.shutdown();
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: healthy overflow turn admitted, no hold (control, passes)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdcompact-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      // Explicit overflow error (pinned OVERFLOW_PATTERNS: maximum context
      // length; no NON_OVERFLOW rate-limit/quota text). Classification verified
      // true in isolation via installed pi-ai overflow util, but NO compaction
      // summaries observed in worker fixtures (ENTRY stays 2: toolUse + error;
      // exact trigger gating — retained/projection/session conditions in worker
      // context — unidentified within budget). SCOPE QUESTION for parent: halves
      // share the SAME streamFunction object by construction (AgentSession2147
      // passes this.agent.streamFunction; compaction.js halves take streamFn
      // param — inspected source), but fixture proof of halves ENTRY is MISSING;
      // is construction + overflow-turn gating sufficient, or is a new fixture
      // capability required? NOT labeled complete. This control proves overflow
      // turns traverse the guard and are admitted when healthy.
      const OVERFLOW = "maximum context length is 32768 tokens, please reduce the length of the messages";
      const SCRIPT = [{ tool: "read", args: { path: READ_PATH } }, { error: OVERFLOW }, { text: "done" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdcompact",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdcompact"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "compact", message: "go", profile: "writer", isolation: "none" }, "provholdcompact-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const term = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.ok(term, "run never settled (setup failure)");
        const entries = readEntryLog(agentDir);
        assert.ok(entries.length >= 2, "overflow error turn admitted (setup failure)");
        // Blocker evidence: NO compaction summaries observed (entries stay exactly
        // 2: toolUse + error; script text step never consumed because the error
        // ends the run). If summaries ever trigger, this fails loudly for
        // investigation (not silent green) — see SCOPE QUESTION above.
        assert.equal(entries.length, 2, "zero compaction summaries in fixture (blocker evidence; fails loudly if behavior changes)");
        assert.ok(trace.filter((q) => q.taskRunId === g.taskRunId && q.ok === true).length >= 2, "overflow-path queries allowed healthy (actual trace)");
        assert.equal(sup.needsRecovery, false, "healthy hold false");
        const termR = assertTerminalRecord(term, "terminal");
        assert.equal(terminalOutcome(termR), "failed", "overflow error ends failed (observed)");
        assert.match(terminalDetail(termR), /maximum context length/, "terminal carries overflow error (actual reason, not hold)");
      } finally {
        await sup.shutdown();
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: held overflow turn denied with zero ENTRY (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdcompactheld-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      // Self-holding overflow denial (deterministic, no cross-actor race):
      // turn 1 CG tool admitted pre-hold and its billing fault creates the hold;
      // turn 2 (overflow error step) ASK denied BEFORE entry (zero 2nd ENTRY,
      // terminal failed hold code — never reaches overflow classification).
      // Held-halves-denied mid-compaction is UNREACHABLE in fixtures: summaries
      // dispatch synchronously post-error with no parent-observable await/backoff
      // window for hold creation (deterministic microtask stream, no delay hook).
      // SCOPE QUESTION for parent: does healthy overflow-turn admission +
      // held-overflow-turn denial + shared-wrapper construction evidence suffice,
      // or is a new fixture capability (e.g. delayed summaries) required?
      // Not labeled complete.
      const OVERFLOW = "maximum context length is 32768 tokens, please reduce the length of the messages";
      const SCRIPT = [{ tool: CG, args: { q: "x" } }, { error: OVERFLOW }, { text: "done" }];
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const base = new InMemoryRunStore("root-provholdcompactheld");
      const st = { armed: true, firedOp: null as string | null, count: 0 };
      const store = faultableRunStore(base, st);
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdcompactheld",
        rootDir: join(dir, "root"),
        store,
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
      });
      try {
        const g1 = await sup.spawn("governor", { taskName: "compact", message: "go", profile: "writer", isolation: "none" }, "provholdcompactheld-1");
        const agentDir1 = join(dir, "worker-home", g1.agentId);
        const e1 = await waitEntryCount(agentDir1, 1, OPERATIVE_TIMEOUT_MS);
        assert.ok(e1.length >= 1, "ENTRY 1 never observed pre-hold (setup failure)");
        assert.equal(e1[0].provider, "test-sim", "ENTRY 1 provider-owned (setup failure)");
        const found = await operativeCgOp(sup, g1.taskRunId, OPERATIVE_TIMEOUT_MS);
        assert.ok(found, "no outcome-backed CG op (setup failure)");
        assert.equal(st.firedOp, found.op, "fault fired for genuine CG op (setup failure)");
        assert.equal(st.count, 1, "exactly one preappend firing (setup failure)");
        assert.equal(sup.needsRecovery, true, "hold true after self billing fault (setup failure)");
        const term1 = await waitTerminal(sup, g1.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.ok(term1, "terminal never observed (setup failure)");
        const term1R = assertTerminalRecord(term1, "terminal");
        assert.notEqual(terminalOutcome(term1R), "succeeded", "held overflow turn must NOT succeed (fixed denies)");
        assert.match(terminalDetail(term1R), new RegExp(HOLD_CODE), "terminal hold code (actual reason)");
        assert.equal(readEntryLog(agentDir1).length, 1, "zero overflow ENTRY while held (actual counter)");
        const denied = trace.filter((q) => q.taskRunId === g1.taskRunId && q.ok === false);
        assert.ok(denied.some((q) => q.code === HOLD_CODE), `overflow ASK denied hold code (actual: ${denied.map((q) => q.code).join(",")})`);
        await sup.recover();
        assert.equal(sup.needsRecovery, false, "hold cleared after genuine recovery");
        const debt = extReports(sup, found.op);
        assert.equal(debt.length, 1, "recover bills debt exactly once (actual count)");
      } finally {
        await sup.shutdown();
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error(`primary: ${String(primary)}; cleanup: ${String(e2)}`);
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: admission requires task-run/generation identity (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdids-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const SCRIPT = [{ tool: CG, args: { q: "x" } }, { text: "done" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      let probed = false;
      const probeResults: Record<string, { ok: boolean; code: string }> = {};
      const sup = new Supervisor({
        rootId: "root-provholdids",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdids"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          const origSet = handle.setProviderAdmissionRequestHandler.bind(handle);
          handle.setProviderAdmissionRequestHandler = ((cb: ProviderAdmissionHandler): void => {
            origSet(async (payload, env) => {
              const res = await cb(payload, env);
              const envTask: unknown = (env as { taskRunId?: unknown } | null | undefined)?.taskRunId;
              const envGen: unknown = (env as { executionGeneration?: unknown } | null | undefined)?.executionGeneration;
              trace.push({
                reason: payload.reason,
                provider: payload.provider,
                modelId: payload.modelId,
                thinkingLevel: payload.thinkingLevel,
                taskRunId: typeof envTask === "string" ? envTask : null,
                generation: typeof envGen === "number" ? envGen : null,
                ok: res.ok,
                code: res.ok ? "OK" : (typeof res.code === "string" && res.code.length > 0 ? res.code : "MISSING"),
                at: Date.now(),
              });
              if (!probed && res.ok === true) {
                probed = true;
                const goodEnv = env;
                const gp = { reason: "stream", provider: "p", modelId: "m", thinkingLevel: "off" };
                const cases: Array<[string, unknown, unknown]> = [
                  ["missBoth", null, null],
                  ["missTask", null, (goodEnv as { executionGeneration?: unknown }).executionGeneration],
                  ["missGen", (goodEnv as { taskRunId?: unknown }).taskRunId, null],
                  ["malTask", "", (goodEnv as { executionGeneration?: unknown }).executionGeneration],
                  ["malGen", (goodEnv as { taskRunId?: unknown }).taskRunId, -1],
                  ["wrongTask", "other-task", (goodEnv as { executionGeneration?: unknown }).executionGeneration],
                  ["wrongGen", (goodEnv as { taskRunId?: unknown }).taskRunId, 999],
                ];
                for (const entry of cases) {
                  const name: string = entry[0] as string;
                  const r = await cb(gp, { taskRunId: entry[1], executionGeneration: entry[2] } as unknown as Parameters<ProviderAdmissionHandler>[1]);
                  probeResults[name] = { ok: r.ok, code: typeof r.code === "string" ? r.code : "MISSING" };
                }
                const wm = await cb({ reason: "stream", provider: "p", modelId: "other", thinkingLevel: "off" }, goodEnv);
                probeResults["wrongModel"] = { ok: wm.ok, code: typeof wm.code === "string" ? wm.code : "MISSING" };
                const wt = await cb({ reason: "stream", provider: "p", modelId: "m", thinkingLevel: "high" }, goodEnv);
                probeResults["wrongThink"] = { ok: wt.ok, code: typeof wt.code === "string" ? wt.code : "MISSING" };
              }
              return res;
            });
          }) as typeof handle.setProviderAdmissionRequestHandler;
          return handle;
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "ids", message: "go", profile: "writer", isolation: "none" }, "provholdids-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const e1 = await waitEntryCount(agentDir, 2, TERMINAL_TIMEOUT_MS);
        assert.ok(e1.length >= 2, "healthy two-turn entries present (setup failure)");
        assert.ok(probed, "identity probes ran during active run (setup failure)");
        const pr = (n: string): { ok: boolean; code: string } => {
          const v: { ok: boolean; code: string } | undefined = probeResults[n];
          assert.ok(v !== undefined, "probe " + n + " missing (setup failure)");
          return v as { ok: boolean; code: string };
        };
        assert.equal(pr("missBoth").ok, false, "missing both must deny");
        assert.equal(pr("missBoth").code, "INVALID", "missing both code INVALID");
        assert.equal(pr("missTask").ok, false, "missing task must deny");
        assert.equal(pr("missTask").code, "INVALID", "missing task code INVALID");
        assert.equal(pr("missGen").ok, false, "missing generation must deny");
        assert.equal(pr("missGen").code, "INVALID", "missing generation code INVALID");
        assert.equal(pr("malTask").ok, false, "empty task must deny");
        assert.equal(pr("malTask").code, "INVALID", "empty task code INVALID");
        assert.equal(pr("malGen").ok, false, "negative generation must deny");
        assert.equal(pr("malGen").code, "INVALID", "negative generation code INVALID");
        assert.equal(pr("wrongTask").ok, false, "wrong task must deny");
        assert.equal(pr("wrongTask").code, "STALE_GENERATION", "wrong task code STALE_GENERATION");
        assert.equal(pr("wrongGen").ok, false, "wrong generation must deny");
        assert.equal(pr("wrongGen").code, "STALE_GENERATION", "wrong generation code STALE_GENERATION");
        assert.equal(pr("wrongModel").ok, false, "wrong model must deny");
        assert.equal(pr("wrongModel").code, "POLICY_DENIED", "wrong model code POLICY_DENIED");
        assert.equal(pr("wrongThink").ok, false, "wrong thinking must deny");
        assert.equal(pr("wrongThink").code, "POLICY_DENIED", "wrong thinking code POLICY_DENIED");
        const term = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const termR = assertTerminalRecord(term, "ids run");
        assert.equal(terminalOutcome(termR), "succeeded", "ids run settles");
        const entries = readEntryLog(agentDir);
        assert.ok(entries.length >= 2, "healthy two-turn entries present");
      } finally {
        await sup.shutdown();
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      if (!primaryThrown) throw e2;
      throw new Error("primary: " + String(primary) + "; cleanup: " + String(e2));
    }
    if (primaryThrown) throw primary;
  })();
});

test("provider-start hold: healthy split compaction enters twice via guard (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdcompact2-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const handles: WorkerHandle[] = [];
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const OVERFLOW = "maximum context length is 32768 tokens, please reduce the length of the messages";
    try {
      writeFileSync(join(dir, "big1.txt"), "A".repeat(15000) + "\n");
      writeFileSync(join(dir, "big2.txt"), "B".repeat(15000) + "\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [
        { tool: "read", args: { path: "big1.txt" } },
        { text: "phase one done" },
        { tool: "read", args: { path: "big1.txt" } },
        { tool: "read", args: { path: "big2.txt" } },
        { tool: "read", args: { path: "big1.txt" } },
        { error: OVERFLOW },
        { text: "phase two done", usage: { input: 11, output: 6, cacheRead: 7, cacheWrite: 8, costInput: 1, costOutput: 2, costCacheRead: 3, costCacheWrite: 4, costTotal: 5 } },
      ];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdcompact2",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdcompact2"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          mkdirSync(agentDir, { recursive: true });
          writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 128 } }));
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG, PI_SUBAGENTS_SUMMARY_USAGE: NONZERO_SUMMARY_USAGE },
          }, binding);
          handles.push(handle);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "phase1", message: "read big1", profile: "writer", isolation: "none" }, "provholdcompact2-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const term1raw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const term1 = assertTerminalRecord(term1raw, "phase1");
        assert.equal(terminalOutcome(term1), "succeeded", "phase1 settles");
        const follow = await sup.sendMessage("governor", g.agentId, "task", "follow-up with more reads", {}, "provholdcompact2-2");
        assert.ok(typeof follow.taskRunId === "string" && follow.taskRunId.length > 0, "follow-up taskRunId asserted");
        const followId: string = follow.taskRunId as string;
        const term2raw = await waitTerminal(sup, followId, TERMINAL_TIMEOUT_MS);
        const term2 = assertTerminalRecord(term2raw, "phase2");
        assert.equal(terminalOutcome(term2), "succeeded", "phase2 settles after split compaction and retry");
        const entries = readEntryLog(agentDir);
        const kinds = entries.map((e) => e.kind);
        assert.ok(entries.length >= 9, "expected mains plus two summaries plus retry (actual counter): " + kinds.join(","));
        const histIdx = kinds.indexOf("history");
        const prefIdx = kinds.indexOf("prefix");
        assert.ok(histIdx >= 0, "history summary ENTRY present: " + kinds.join(","));
        assert.ok(prefIdx === histIdx + 1, "prefix ENTRY immediately after history (sequential halves): " + kinds.join(","));
        assert.ok(entries.every((e) => e.taskRunId.length > 0 && e.agentId.length > 0), "entries task/session owned");
        const allowed = trace.filter((q) => q.ok === true);
        assert.ok(allowed.length >= entries.length, "every ENTRY admitted via public guard (actual trace): " + String(allowed.length));
        assert.equal(sup.needsRecovery, false, "healthy hold false");
        const lifecycle = readLifecycle(agentDir);
        assert.ok(lifecycle.length >= 2, "SDK compaction lifecycle bracketed (actual start/end)");
        assert.equal(lifecycle[0].phase, "start", "lifecycle opens with start");
        assert.equal(lifecycle[0].isCompacting, true, "isCompacting true during compaction");
        const histAt: number = entries[histIdx].at;
        assert.ok(lifecycle[0].at <= histAt, "compaction start precedes history ENTRY (actual chronology)");
        const endRec = lifecycle.find((r) => r.phase === "end");
        assert.ok(endRec !== undefined, "lifecycle end recorded");
        assert.equal(endRec.completed, true, "healthy compaction completed");
        const prefAt: number = entries[prefIdx].at;
        assert.ok(endRec.at >= prefAt, "lifecycle end follows prefix ENTRY (actual chronology)");
        const compactions = compactionEntries(sessionsDir, g.agentId);
        assert.ok(compactions.length >= 1, "SDK compaction entry persisted (production evidence)");
        const summary: unknown = (compactions[0] as Record<string, unknown>)["summary"];
        assert.ok(typeof summary === "string", "compaction summary asserted record");
        assert.ok((summary as string).includes("HISTORY_SUMMARY_MARKER"), "history half merged");
        assert.ok((summary as string).includes("PREFIX_SUMMARY_MARKER"), "prefix half merged");
        assert.ok((summary as string).indexOf("HISTORY_SUMMARY_MARKER") < (summary as string).indexOf("PREFIX_SUMMARY_MARKER"), "history before prefix");
        const model = modelReports(sup, g.agentId);
        const full = sumFullUsage(model);
        assert.equal(full.input, 204, "model input normalized with cache once (actual sum)");
        assert.equal(full.output, 74, "model output includes override turn plus both summaries once (actual sum)");
        assert.equal(full.cacheRead, 47, "model cacheRead breakdown preserved (actual ledger)");
        assert.equal(full.cacheWrite, 50, "model cacheWrite breakdown preserved (actual ledger)");
        assert.equal(full.cost, 35, "model cost total flows end to end (actual ledger)");
        assert.equal(full.unknown, false, "model usage fully known (actual ledger)");
        const returned = readSummaryUsage(agentDir);
        assert.equal(returned.length, 2, "two actual returned summary usages captured (actual result observation)");
        assert.equal(returned[0].kind, "history", "first returned usage is history");
        assert.equal(returned[1].kind, "prefix", "second returned usage is prefix");
        const expectedHalves: Record<string, Record<string, unknown>> = {
          history: { input: 13, output: 14, cacheRead: 15, cacheWrite: 16, totalTokens: 58, cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } },
          prefix: { input: 23, output: 24, cacheRead: 25, cacheWrite: 26, totalTokens: 98, cost: { input: 11, output: 12, cacheRead: 13, cacheWrite: 14, total: 20 } },
        };
        for (const rec of returned) {
          const want: Record<string, unknown> = expectedHalves[rec.kind] as Record<string, unknown>;
          assert.ok(want !== undefined, "known half kind: " + rec.kind);
          const u = rec.usage as Record<string, unknown>;
          assert.deepEqual(
            { input: u["input"], output: u["output"], cacheRead: u["cacheRead"], cacheWrite: u["cacheWrite"], totalTokens: u["totalTokens"], cost: u["cost"] },
            { input: want["input"], output: want["output"], cacheRead: want["cacheRead"], cacheWrite: want["cacheWrite"], totalTokens: want["totalTokens"], cost: want["cost"] },
            "returned " + rec.kind + " full usage exact",
          );
        }
        const compUsage: unknown = (compactions[0] as Record<string, unknown>)["usage"];
        assert.ok(typeof compUsage === "object" && compUsage !== null, "compaction usage asserted record");
        const compRec = compUsage as Record<string, unknown>;
        assert.equal(compRec["input"], 36, "compaction combined input (SDK persisted)");
        assert.equal(compRec["output"], 38, "compaction combined output (SDK persisted)");
        assert.equal(compRec["cacheRead"], 40, "compaction combined cacheRead (SDK persisted)");
        assert.equal(compRec["cacheWrite"], 42, "compaction combined cacheWrite (SDK persisted)");
        assert.equal(compRec["totalTokens"], 156, "compaction totalTokens (SDK persisted)");
        assert.deepEqual(compRec["cost"], { input: 12, output: 14, cacheRead: 16, cacheWrite: 18, total: 30 }, "compaction combined cost (SDK persisted)");
        const texts = toolResultTexts(sessionsDir, g.agentId);
        const big = texts.filter((t) => t.length >= 10000);
        assert.ok(big.length >= 2, "two real text-bearing tool turns (actual host bytes): " + String(texts.map((t) => t.length).join(",")));
        assert.ok(big.some((t) => t.includes("A".repeat(100))), "big1 bytes present");
        assert.ok(big.some((t) => t.includes("B".repeat(100))), "big2 bytes present");
        // Exact whole-bytes proof: the production HostToolExecutor must
        // return the complete 15000-byte fixture runs, not fragments: exact
        // full read envelope including the trailing newline (not a substring).
        assert.ok(big.some((t) => t === "A".repeat(15000) + "\n"), "big1 exact full 15001-char read envelope through host executor");
        assert.ok(big.some((t) => t === "B".repeat(15000) + "\n"), "big2 exact full 15001-char read envelope through host executor");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});


test("provider-start hold: held split compaction denies second summary (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdcompactheld2-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const handles: WorkerHandle[] = [];
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const OVERFLOW = "maximum context length is 32768 tokens, please reduce the length of the messages";
    const releaseMarker = (agentDir: string): string => join(agentDir, "summary-release");
    try {
      writeFileSync(join(dir, "big1.txt"), "A".repeat(15000) + "\n");
      writeFileSync(join(dir, "big2.txt"), "B".repeat(15000) + "\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const SCRIPT = [
        { tool: "read", args: { path: "big1.txt" } },
        { text: "phase one done" },
        { tool: "read", args: { path: "big1.txt" } },
        { tool: "read", args: { path: "big2.txt" } },
        { tool: "read", args: { path: "big1.txt" } },
        { error: OVERFLOW },
        { text: "phase two done" },
      ];
      const base = new InMemoryRunStore("root-provholdcompactheld2");
      const st = { armed: true, firedOp: null as string | null, count: 0 };
      const store = faultableRunStore(base, st);
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const workerEvents: Array<{ kind: string; taskRunId: unknown }> = [];
      let factoryCalls = 0;
      const holders: CtlWorker[] = [];
      const pendingLatch = (agentDir: string): string => join(agentDir, "summary-pending");
      const sup = new Supervisor({
        rootId: "root-provholdcompactheld2",
        rootDir: join(dir, "root"),
        store,
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          factoryCalls += 1;
          if (factoryCalls === 1) {
            const w = new CtlWorker(o.agentId);
            holders.push(w);
            return w;
          }
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          mkdirSync(agentDir, { recursive: true });
          writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 128 } }));
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG, PI_SUBAGENTS_COMPACTION_DELAY: "history", PI_SUBAGENTS_SUMMARY_USAGE: NONZERO_SUMMARY_USAGE, PI_SUBAGENTS_EXPOSED_RESULT_WITNESS: EXPOSED_WITNESS_LOG },
          }, binding);
          handles.push(handle);
          // Multicast the single-slot worker event handler (the supervisor
          // installs its own consumer after the factory returns): the test
          // observes exposure-channel events without stealing them. Events
          // carry the fenced taskRunId, so follow-up correlation is exact.
          const innerSetEventHandler = handle.setEventHandler.bind(handle);
          handle.setEventHandler = ((h: Parameters<typeof handle.setEventHandler>[0]): void => {
            innerSetEventHandler((event, envelope) => {
              workerEvents.push({ kind: event.kind, taskRunId: event.taskRunId });
              h(event, envelope);
            });
          }) as typeof handle.setEventHandler;
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
      });
      const releaseBestEffort = (agentDir: string): void => {
        try {
          if (!existsSync(releaseMarker(agentDir))) writeFileSync(releaseMarker(agentDir), "release\n");
        } catch (releaseError: unknown) {
          secondaries.push({ phase: "release", error: releaseError });
        }
      };
      const listAgentDirs = (): string[] => {
        try {
          return readdirSync(join(dir, "worker-home"));
        } catch (listError: unknown) {
          secondaries.push({ phase: "list-agent-dirs", error: listError });
          return [];
        }
      };
      try {
        const holder = await sup.spawn("governor", { taskName: "holder", message: "hold", profile: "writer", isolation: "none" }, "provholdcompactheld2-h");
        await tick(100);
        const g = await sup.spawn("governor", { taskName: "phase1", message: "read big1", profile: "writer", isolation: "none" }, "provholdcompactheld2-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const term1raw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const term1 = assertTerminalRecord(term1raw, "phase1");
        assert.equal(terminalOutcome(term1), "succeeded", "phase1 settles");
        const follow = await sup.sendMessage("governor", g.agentId, "task", "follow-up with more reads", {}, "provholdcompactheld2-2");
        assert.ok(typeof follow.taskRunId === "string" && follow.taskRunId.length > 0, "follow-up taskRunId asserted");
        const followId: string = follow.taskRunId as string;
        const tHist = Date.now();
        let sawHistory = false;
        let sawPending = false;
        while (Date.now() - tHist < OPERATIVE_TIMEOUT_MS) {
          if (existsSync(join(agentDir, ENTRY_LOG))) {
            const cur = readEntryLog(agentDir);
            if (cur.some((e) => e.kind === "history")) sawHistory = true;
          }
          if (existsSync(pendingLatch(agentDir))) sawPending = true;
          if (sawHistory && sawPending) break;
          await tick(50);
        }
        assert.ok(sawHistory, "first-summary ENTRY admitted before hold");
        assert.ok(sawPending, "first summary genuinely unsettled (typed pending latch present before hold)");
        // Causal simultaneity at the pre-hold point (not post-hoc): the
        // public session already reports compacting, the first summary has
        // a physical ENTRY, its result is still unsettled (pending latch),
        // and no terminal exists for the follow-up task yet.
        const preHoldLifecycle = readLifecycle(agentDir);
        assert.ok(
          preHoldLifecycle.length >= 1 && preHoldLifecycle[0].phase === "start" && preHoldLifecycle[0].isCompacting === true,
          "isCompacting true at pre-hold point while first summary unsettled",
        );
        assert.equal(
          records(sup).filter((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === followId).length,
          0,
          "no terminal for the follow-up task while its summary is unsettled (exposed result pending before hold)",
        );
        const latch = decodeLatch(pendingLatch(agentDir));
        assert.equal(latch.state, "pending", "latch state pending");
        assert.equal(latch.kind, "history", "latch kind history");
        assert.equal(latch.provider, "test-sim", "latch provider");
        assert.equal(latch.model, "sim-1", "latch model");
        const histEntry = readEntryLog(agentDir).find((e) => e.kind === "history");
        assert.ok(histEntry !== undefined, "history ENTRY present for latch match");
        assert.equal(latch.turn, histEntry.turn, "latch turn matches physical ENTRY turn");
        assert.equal(latch.taskRunId, followId, "latch task matches expected follow-up task");
        assert.equal(latch.taskRunId, histEntry.taskRunId, "latch task matches ENTRY task");
        assert.equal(latch.generation, histEntry.generation, "latch generation matches ENTRY generation");
        assert.equal(latch.agentId, g.agentId, "latch agent matches worker");
        assert.equal(latch.agentId, histEntry.agentId, "latch agent matches ENTRY agent");
        assert.equal(histEntry.provider, "test-sim", "ENTRY provider matches latch");
        assert.equal(histEntry.model, "sim-1", "ENTRY model matches latch");
        // Triangulate the pre-hold simultaneity across three independent
        // channels (not post-hoc): the admission trace carries the
        // SDK-current (taskRunId, generation) envelope for the admitted
        // history summary, matching latch and ENTRY; and the worker exposed
        // no settled event for the follow-up generation before the hold
        // (result unsettled on the exposure channel, not just absent from
        // the journal).
        const histAdmission = trace.find((q) => q.taskRunId === followId && q.generation === latch.generation && q.ok === true);
        assert.ok(histAdmission !== undefined, "admission trace carries the current follow-up identity for the history summary");
        // The latest follow-up admission at the pre-hold point (script
        // order: main turns, then the held summary; nothing else can admit
        // while it stays pending): current-identity envelope currency for
        // the generation. Summary specificity comes from the turn-keyed
        // witnesses below (summaries bypass the guarded streamFunction
        // while delayed, so the trace alone cannot isolate them).
        const followAdmissions = trace.filter((q) => q.taskRunId === followId);
        assert.ok(followAdmissions.length > 0, "follow-up admissions traced");
        const lastAdmission = followAdmissions[followAdmissions.length - 1]!;
        assert.equal(lastAdmission.ok, true, "latest follow-up admission admitted (current envelope, not a denial)");
        assert.equal(lastAdmission.generation, latch.generation, "latest admission generation matches latch+ENTRY");
        // Exposed ORIGINAL result state at the public StreamFn boundary,
        // correlated by (taskRunId, generation, seq): the adapted stream is
        // the runtime's OUTER object the SDK loop and guard consume (the
        // provider INNER is consumed only by the runtime forwarding loop
        // after inner iteration). While the held summary blocks progress,
        // no later adaptation can exist, so the max-seq group is its
        // stream deterministically: entered but never settled. Every other
        // follow-up adaptation completed (entered+settled pair), proving
        // the witness live and the blockade precise.
        const exposedStates = readExposedStates(agentDir).filter((s) => s.taskRunId === followId);
        assert.ok(exposedStates.length > 0, "exposed-result witness live (follow-up streams observed)");
        const bySeq = new Map<number, string[]>();
        for (const s of exposedStates) {
          assert.equal(s.generation, latch.generation, "witness generation matches latch+ENTRY");
          const group = bySeq.get(s.seq) ?? [];
          group.push(s.event);
          bySeq.set(s.seq, group);
        }
        const maxSeq = Math.max(...bySeq.keys());
        for (const [seq, events] of bySeq) {
          assert.ok(events.includes("exposed-entered"), `adaptation seq ${seq} entered`);
          if (seq === maxSeq) {
            assert.deepEqual(events, ["exposed-entered"], "latest adaptation (held summary) entered but never settled");
          } else {
            assert.ok(events.some((e) => e === "exposed-settled-ok" || e === "exposed-settled-err"), `adaptation seq ${seq} completed`);
          }
        }
        assert.ok(workerEvents.length > 0, "worker exposure channel observed before the hold");
        assert.equal(workerEvents.filter((e) => e.kind === "settled" && e.taskRunId === followId).length, 0, "no worker-settled event for the follow-up before the hold (exposed result unsettled)");
        const holderWorker = holders.find((w) => w.agentId === holder.agentId);
        assert.ok(holderWorker, "holder missing (setup failure)");
        const cgRes = await holderWorker.call(CG, { q: "x" });
        assert.equal(cgRes.isError, false, "holder CG admitted (setup failure)");
        assert.ok(st.firedOp !== null, "holder billing fault fired (setup failure)");
        assert.equal(sup.needsRecovery, true, "hold true before release (setup failure)");
        assert.equal(workerEvents.filter((e) => e.kind === "settled" && e.taskRunId === followId).length, 0, "still no worker-settled event for the follow-up at the hold point");
        writeFileSync(releaseMarker(agentDir), "release\n");
        const tRel = Date.now();
        while (existsSync(pendingLatch(agentDir)) && Date.now() - tRel < OPERATIVE_TIMEOUT_MS) await tick(50);
        assert.ok(!existsSync(pendingLatch(agentDir)), "pending latch cleared after release (first summary settled)");
        const term2raw = await waitTerminal(sup, followId, TERMINAL_TIMEOUT_MS);
        const term2 = assertTerminalRecord(term2raw, "phase2");
        assert.notEqual(terminalOutcome(term2), "succeeded", "held compaction run must not succeed");
        const entries = readEntryLog(agentDir);
        const kinds = entries.map((e) => e.kind);
        assert.ok(kinds.includes("history"), "admitted history ENTRY present: " + kinds.join(","));
        assert.ok(!kinds.includes("prefix"), "zero denied NEXT ENTRY (prefix): " + kinds.join(","));
        const denied = trace.filter((q) => q.ok === false);
        assert.ok(denied.some((q) => q.code === HOLD_CODE), "prefix ASK denied with hold code: " + denied.map((q) => q.code).join(","));
        const heldLifecycle = readLifecycle(agentDir);
        assert.ok(heldLifecycle.length >= 2, "held compaction lifecycle bracketed");
        assert.equal(heldLifecycle[0].phase, "start", "held lifecycle opens with start");
        assert.equal(heldLifecycle[0].isCompacting, true, "isCompacting true during held compaction");
        const heldHist = entries.find((e) => e.kind === "history");
        assert.ok(heldHist !== undefined, "history ENTRY for lifecycle match");
        assert.ok(heldLifecycle[0].at <= heldHist.at, "compaction start precedes history ENTRY");
        const heldEnd = heldLifecycle.find((r) => r.phase === "end");
        assert.ok(heldEnd !== undefined, "held lifecycle end recorded (failed, not silent)");
        assert.equal(heldEnd.completed, false, "held compaction did not complete");
        assert.ok(typeof heldEnd.errorMessage === "string" && heldEnd.errorMessage.includes("overflow"), "held end carries overflow recovery failure: " + String(heldEnd.errorMessage).slice(0, 160));
        assert.equal(sup.needsRecovery, true, "hold persists (idle healing alone does not clear)");
        await tick(800);
        assert.equal(sup.needsRecovery, true, "hold persists across idle");
        assert.equal(readEntryLog(agentDir).filter((e) => e.kind === "prefix").length, 0, "idle adds no prefix ENTRY");
        const model = modelReports(sup, g.agentId);
        const heldFull = sumFullUsage(model);
        assert.equal(heldFull.input, 104, "model input includes admitted history once, no retry after failed compaction (actual sum)");
        assert.equal(heldFull.output, 44, "model output includes admitted history once, no retry after failed compaction (actual sum)");
        assert.equal(heldFull.cacheRead, 15, "model cacheRead from admitted history (actual ledger)");
        assert.equal(heldFull.cacheWrite, 16, "model cacheWrite from admitted history (actual ledger)");
        assert.equal(heldFull.cost, 10, "model cost from admitted history (actual ledger)");
        assert.equal(heldFull.unknown, false, "model usage fully known (actual ledger)");
        const heldReturned = readSummaryUsage(agentDir);
        assert.equal(heldReturned.length, 1, "exactly one actual returned summary usage (history only, prefix denied before callback)");
        assert.equal(heldReturned[0].kind, "history", "returned usage is history");
        const heldUsage = heldReturned[0].usage as Record<string, unknown>;
        assert.equal(heldUsage["input"], 13, "admitted history actual input");
        assert.equal(heldUsage["output"], 14, "admitted history actual output");
        assert.equal(heldUsage["cacheRead"], 15, "admitted history actual cacheRead");
        assert.equal(heldUsage["cacheWrite"], 16, "admitted history actual cacheWrite");
        assert.equal(heldUsage["totalTokens"], 58, "admitted history actual totalTokens");
        assert.deepEqual(heldUsage["cost"], { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }, "admitted history actual cost");
        const texts = toolResultTexts(sessionsDir, g.agentId);
        const big = texts.filter((t) => t.length >= 10000);
        assert.ok(big.length >= 2, "two real text-bearing tool turns (actual host bytes)");
        assert.ok(big.some((t) => t === "A".repeat(15000) + "\n"), "held path big1 exact full 15001-char read envelope through host executor");
        assert.ok(big.some((t) => t === "B".repeat(15000) + "\n"), "held path big2 exact full 15001-char read envelope through host executor");
        await sup.recover();
        assert.equal(sup.needsRecovery, false, "genuine recovery reopens admission");
        const debt = extReports(sup, st.firedOp as string);
        assert.equal(debt.length, 1, "recover bills debt exactly once (actual count)");
        assert.deepEqual(sumUsage(debt), { input: EXPECTED_INPUT, output: EXPECTED_OUTPUT }, "debt exact 5/7 (actual sum)");
        const g2 = await sup.spawn("governor", { taskName: "after", message: "go", profile: "writer", isolation: "none" }, "provholdcompactheld2-3");
        const term3raw = await waitTerminal(sup, g2.taskRunId, TERMINAL_TIMEOUT_MS);
        const term3 = assertTerminalRecord(term3raw, "after");
        assert.equal(terminalOutcome(term3), "succeeded", "post-recovery run settles");
      } finally {
        for (const ad of listAgentDirs()) releaseBestEffort(join(dir, "worker-home", ad));
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: compaction cancellation aborts pending summary (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdcompactcancel-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const handles: WorkerHandle[] = [];
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const OVERFLOW = "maximum context length is 32768 tokens, please reduce the length of the messages";
    const releaseMarker = (agentDir: string): string => join(agentDir, "summary-release");
    try {
      writeFileSync(join(dir, "big1.txt"), "A".repeat(15000) + "\n");
      writeFileSync(join(dir, "big2.txt"), "B".repeat(15000) + "\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [
        { tool: "read", args: { path: "big1.txt" } },
        { text: "phase one done" },
        { tool: "read", args: { path: "big1.txt" } },
        { tool: "read", args: { path: "big2.txt" } },
        { tool: "read", args: { path: "big1.txt" } },
        { error: OVERFLOW },
        { text: "phase two done" },
      ];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const workerEvents: Array<{ kind: string; taskRunId: unknown }> = [];
      const pendingLatch = (agentDir: string): string => join(agentDir, "summary-pending");
      const sup = new Supervisor({
        rootId: "root-provholdcompactcancel",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdcompactcancel"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          mkdirSync(agentDir, { recursive: true });
          writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 128 } }));
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG, PI_SUBAGENTS_COMPACTION_DELAY: "history", PI_SUBAGENTS_SUMMARY_USAGE: NONZERO_SUMMARY_USAGE, PI_SUBAGENTS_EXPOSED_RESULT_WITNESS: EXPOSED_WITNESS_LOG },
          }, binding);
          handles.push(handle);
          // Multicast the single-slot worker event handler (see held test).
          const innerSetEventHandler = handle.setEventHandler.bind(handle);
          handle.setEventHandler = ((h: Parameters<typeof handle.setEventHandler>[0]): void => {
            innerSetEventHandler((event, envelope) => {
              workerEvents.push({ kind: event.kind, taskRunId: event.taskRunId });
              h(event, envelope);
            });
          }) as typeof handle.setEventHandler;
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      const releaseBestEffort = (agentDir: string): void => {
        try {
          if (!existsSync(releaseMarker(agentDir))) writeFileSync(releaseMarker(agentDir), "release\n");
        } catch (releaseError: unknown) {
          secondaries.push({ phase: "release", error: releaseError });
        }
      };
      const listAgentDirs = (): string[] => {
        try {
          return readdirSync(join(dir, "worker-home"));
        } catch (listError: unknown) {
          secondaries.push({ phase: "list-agent-dirs", error: listError });
          return [];
        }
      };
      try {
        const g = await sup.spawn("governor", { taskName: "phase1", message: "read big1", profile: "writer", isolation: "none" }, "provholdcompactcancel-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const term1raw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const term1 = assertTerminalRecord(term1raw, "phase1");
        assert.equal(terminalOutcome(term1), "succeeded", "phase1 settles");
        const follow = await sup.sendMessage("governor", g.agentId, "task", "follow-up with more reads", {}, "provholdcompactcancel-2");
        assert.ok(typeof follow.taskRunId === "string" && follow.taskRunId.length > 0, "follow-up taskRunId asserted");
        const followId: string = follow.taskRunId as string;
        const tHist = Date.now();
        let sawHistory = false;
        let sawPending = false;
        while (Date.now() - tHist < OPERATIVE_TIMEOUT_MS) {
          if (existsSync(join(agentDir, ENTRY_LOG))) {
            const cur = readEntryLog(agentDir);
            if (cur.some((e) => e.kind === "history")) sawHistory = true;
          }
          if (existsSync(pendingLatch(agentDir))) sawPending = true;
          if (sawHistory && sawPending) break;
          await tick(50);
        }
        assert.ok(sawHistory, "first-summary ENTRY admitted before cancel");
        assert.ok(sawPending, "first summary genuinely unsettled (typed pending latch present before cancel)");
        const cancelLatch = decodeLatch(pendingLatch(agentDir));
        assert.equal(cancelLatch.state, "pending", "cancel latch state pending");
        assert.equal(cancelLatch.kind, "history", "cancel latch kind history");
        assert.equal(cancelLatch.provider, "test-sim", "cancel latch provider");
        assert.equal(cancelLatch.model, "sim-1", "cancel latch model");
        assert.equal(cancelLatch.taskRunId, followId, "cancel latch task matches follow-up");
        assert.equal(cancelLatch.agentId, g.agentId, "cancel latch agent matches worker");
        const cancelEntry = readEntryLog(agentDir).find((e) => e.kind === "history");
        assert.ok(cancelEntry !== undefined, "cancel history ENTRY present for latch match");
        assert.equal(cancelLatch.turn, cancelEntry.turn, "cancel latch turn matches ENTRY turn");
        assert.equal(cancelLatch.generation, cancelEntry.generation, "cancel latch generation matches ENTRY");
        assert.equal(cancelLatch.taskRunId, cancelEntry.taskRunId, "cancel latch task matches ENTRY task");
        assert.equal(cancelEntry.provider, "test-sim", "cancel ENTRY provider matches latch");
        assert.equal(cancelEntry.model, "sim-1", "cancel ENTRY model matches latch");
        // Pre-cancel causal simultaneity (not post-hoc): the public session
        // already reports compacting while the first summary is unsettled —
        // actual SDK current identity (admission-trace envelope) matches
        // latch and ORIGINAL ENTRY, the exposed worker result is unsettled
        // (no settled event on the exposure channel, no terminal in the
        // journal), and public isCompacting is true before the interrupt.
        const preCancelLifecycle = readLifecycle(agentDir);
        assert.ok(
          preCancelLifecycle.length >= 1 && preCancelLifecycle[0].phase === "start" && preCancelLifecycle[0].isCompacting === true,
          "isCompacting true at pre-cancel point while first summary unsettled",
        );
        assert.equal(
          records(sup).filter((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === followId).length,
          0,
          "no terminal for the follow-up task before cancel (exposed result pending before peer action)",
        );
        const cancelAdmission = trace.find((q) => q.taskRunId === followId && q.generation === cancelLatch.generation && q.ok === true);
        assert.ok(cancelAdmission !== undefined, "admission trace carries the current follow-up identity for the history summary");
        // The latest follow-up admission at the pre-cancel point (same
        // currency argument as the held test; summary specificity is
        // turn-keyed below).
        const cancelFollowAdmissions = trace.filter((q) => q.taskRunId === followId);
        assert.ok(cancelFollowAdmissions.length > 0, "follow-up admissions traced");
        const cancelLastAdmission = cancelFollowAdmissions[cancelFollowAdmissions.length - 1]!;
        assert.equal(cancelLastAdmission.ok, true, "latest follow-up admission admitted (current envelope, not a denial)");
        assert.equal(cancelLastAdmission.generation, cancelLatch.generation, "latest admission generation matches latch+ENTRY");
        // Exposed ORIGINAL result state at the public StreamFn boundary
        // (same layer discipline as the held test: max-seq group entered
        // only, all earlier groups completed).
        const cancelExposed = readExposedStates(agentDir).filter((s) => s.taskRunId === followId);
        assert.ok(cancelExposed.length > 0, "exposed-result witness live (follow-up streams observed)");
        const cancelBySeq = new Map<number, string[]>();
        for (const s of cancelExposed) {
          assert.equal(s.generation, cancelLatch.generation, "witness generation matches latch+ENTRY");
          const group = cancelBySeq.get(s.seq) ?? [];
          group.push(s.event);
          cancelBySeq.set(s.seq, group);
        }
        const cancelMaxSeq = Math.max(...cancelBySeq.keys());
        for (const [seq, events] of cancelBySeq) {
          assert.ok(events.includes("exposed-entered"), `adaptation seq ${seq} entered`);
          if (seq === cancelMaxSeq) {
            assert.deepEqual(events, ["exposed-entered"], "latest adaptation (held summary) entered but never settled");
          } else {
            assert.ok(events.some((e) => e === "exposed-settled-ok" || e === "exposed-settled-err"), `adaptation seq ${seq} completed`);
          }
        }
        assert.ok(workerEvents.length > 0, "worker exposure channel observed before cancel");
        assert.equal(workerEvents.filter((e) => e.kind === "settled" && e.taskRunId === followId).length, 0, "no worker-settled event for the follow-up before cancel (exposed result unsettled)");
        await sup.interrupt("governor", g.agentId, "provholdcompactcancel-int");
        const term2raw = await waitTerminal(sup, followId, TERMINAL_TIMEOUT_MS);
        const term2 = assertTerminalRecord(term2raw, "phase2");
        assert.notEqual(terminalOutcome(term2), "succeeded", "cancelled run must not succeed");
        const entries = readEntryLog(agentDir);
        const kinds = entries.map((e) => e.kind);
        assert.ok(kinds.includes("history"), "admitted history ENTRY present: " + kinds.join(","));
        assert.ok(!kinds.includes("prefix"), "zero NEXT ENTRY after cancel: " + kinds.join(","));
        assert.equal(sup.needsRecovery, false, "cancel alone creates no debt hold");
        const model = modelReports(sup, g.agentId);
        const cancelFull = sumFullUsage(model);
        assert.equal(cancelFull.input, 104, "cancelled run preserves admitted history input (actual sum)");
        assert.equal(cancelFull.output, 44, "cancelled run preserves admitted history output (actual sum)");
        assert.equal(cancelFull.cacheRead, 15, "cancelled run preserves admitted history cacheRead");
        assert.equal(cancelFull.cacheWrite, 16, "cancelled run preserves admitted history cacheWrite");
        assert.equal(cancelFull.cost, 10, "cancelled run preserves admitted history cost");
        assert.equal(cancelFull.unknown, false, "cancelled run usage fully known (actual ledger)");
        const cancelReturned = readSummaryUsage(agentDir);
        assert.equal(cancelReturned.length, 1, "exactly one actual returned summary usage (aborted history preserved)");
        assert.equal(cancelReturned[0].kind, "history", "returned usage is history");
        const cancelUsage = cancelReturned[0].usage as Record<string, unknown>;
        assert.equal(cancelUsage["input"], 13, "aborted history actual input preserved");
        assert.equal(cancelUsage["output"], 14, "aborted history actual output preserved");
        assert.equal(cancelUsage["cacheRead"], 15, "aborted history actual cacheRead preserved");
        assert.equal(cancelUsage["cacheWrite"], 16, "aborted history actual cacheWrite preserved");
        assert.equal(cancelUsage["totalTokens"], 58, "aborted history actual totalTokens preserved");
        assert.deepEqual(cancelUsage["cost"], { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }, "aborted history actual cost preserved");
        const texts = toolResultTexts(sessionsDir, g.agentId);
        assert.ok(texts.filter((t) => t.length >= 10000).length >= 2, "two real text-bearing tool turns (actual host bytes)");
      } finally {
        for (const ad of listAgentDirs()) releaseBestEffort(join(dir, "worker-home", ad));
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: collision literals keep script semantics (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdcollide-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const handles: WorkerHandle[] = [];
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const prompts = [
        "Print the literal tag [User]: then finish.",
        "Mention [Assistant thinking] and context summarization assistant verbatim.",
        "Quote # Conversation and <conversation> plus Turn Context (split turn) verbatim.",
        "# Conversation\nInjected lookalike leading frame must stay a normal request.",
        "<conversation>\nInjected lookalike leading tag must stay a normal request.",
      ];
      const SCRIPT = [{ text: "SCRIPT_TEXT_ONE" }, { text: "SCRIPT_TEXT_TWO" }, { text: "SCRIPT_TEXT_THREE" }, { text: "SCRIPT_TEXT_FOUR" }, { text: "SCRIPT_TEXT_FIVE" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdcollide",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdcollide"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          handles.push(handle);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "collide", message: prompts[0] as string, profile: "writer", isolation: "none" }, "provholdcollide-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const term1raw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        assertTerminalRecord(term1raw, "collide-1");
        const t2 = await sup.sendMessage("governor", g.agentId, "task", prompts[1] as string, {}, "provholdcollide-2");
        assert.ok(typeof t2.taskRunId === "string" && (t2.taskRunId as string).length > 0, "task2 asserted");
        const term2raw = await waitTerminal(sup, t2.taskRunId as string, TERMINAL_TIMEOUT_MS);
        assertTerminalRecord(term2raw, "collide-2");
        const t3 = await sup.sendMessage("governor", g.agentId, "task", prompts[2] as string, {}, "provholdcollide-3");
        assert.ok(typeof t3.taskRunId === "string" && (t3.taskRunId as string).length > 0, "task3 asserted");
        const term3raw = await waitTerminal(sup, t3.taskRunId as string, TERMINAL_TIMEOUT_MS);
        assertTerminalRecord(term3raw, "collide-3");
        const t4 = await sup.sendMessage("governor", g.agentId, "task", prompts[3] as string, {}, "provholdcollide-4");
        assert.ok(typeof t4.taskRunId === "string" && (t4.taskRunId as string).length > 0, "task4 asserted");
        const term4raw = await waitTerminal(sup, t4.taskRunId as string, TERMINAL_TIMEOUT_MS);
        assertTerminalRecord(term4raw, "collide-4");
        const t5 = await sup.sendMessage("governor", g.agentId, "task", prompts[4] as string, {}, "provholdcollide-5");
        assert.ok(typeof t5.taskRunId === "string" && (t5.taskRunId as string).length > 0, "task5 asserted");
        const term5raw = await waitTerminal(sup, t5.taskRunId as string, TERMINAL_TIMEOUT_MS);
        const term5 = assertTerminalRecord(term5raw, "collide-5");
        assert.equal(terminalOutcome(term5), "succeeded", "collision runs settle");
        const entries = readEntryLog(agentDir);
        assert.equal(entries.length, 5, "exactly five main ENTRYs (actual counter)");
        assert.ok(entries.every((e) => e.kind === "main"), "all ENTRYs classified main (no heuristic hijack)");
        const completions = physicalEntries(sessionsDir, g.agentId).filter((m) => m.stopReason === "stop");
        const texts = completions.map((m) => {
          const content: unknown = m.content;
          assert.ok(Array.isArray(content), "completion content asserted array");
          return (content as Array<Record<string, unknown>>).map((b) => String(b["text"] ?? "")).join("");
        });
        assert.ok(texts.some((x) => x.includes("SCRIPT_TEXT_ONE")), "first script text verbatim");
        assert.ok(texts.some((x) => x.includes("SCRIPT_TEXT_TWO")), "second script text verbatim");
        assert.ok(texts.some((x) => x.includes("SCRIPT_TEXT_THREE")), "third script text verbatim");
        assert.ok(texts.some((x) => x.includes("SCRIPT_TEXT_FOUR")), "leading-frame lookalike keeps script text");
        assert.ok(texts.some((x) => x.includes("SCRIPT_TEXT_FIVE")), "leading-tag lookalike keeps script text");
        assert.ok(!texts.some((x) => x.includes("HISTORY_SUMMARY_MARKER") || x.includes("PREFIX_SUMMARY_MARKER")), "no summary marker substituted");
        const model = modelReports(sup, g.agentId);
        const full = sumFullUsage(model);
        assert.equal(full.input, 50, "model input exact-once 10/5 per turn (actual sum)");
        assert.equal(full.output, 25, "model output exact-once 10/5 per turn (actual sum)");
        assert.equal(full.unknown, false, "fully known (actual ledger)");
        assert.equal(compactionEntries(sessionsDir, g.agentId).length, 0, "no compaction triggered");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: original seam faults mark unknown and join settlement (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdfault-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const runMode = async (mode: string, tag: string): Promise<void> => {
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [{ text: "never served" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const handles: WorkerHandle[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdfault-" + tag,
        rootDir: join(dir, "root-" + tag),
        store: new InMemoryRunStore("root-provholdfault-" + tag),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG, PI_SUBAGENTS_ORIGINAL_FAULT: mode },
          }, binding);
          handles.push(handle);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "fault-" + tag, message: "go", profile: "writer", isolation: "none" }, "provholdfault-" + tag);
        const agentDir = join(dir, "worker-home", g.agentId);
        const termRaw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const term = assertTerminalRecord(termRaw, "fault-" + tag);
        assert.notEqual(terminalOutcome(term), "succeeded", mode + " original fault must not succeed");
        const detail = terminalDetail(term);
        assert.ok(detail.includes("WORKER_ORIGINAL_FAULT"), mode + " terminal carries original fault text: " + detail.slice(0, 200));
        assert.ok(existsSync(join(agentDir, ENTRY_LOG)), "collector file present (setup proof)");
        assert.equal(readEntryLog(agentDir).length, 0, mode + " zero provider ENTRY: fault precedes original invocation (actual counter)");
        const model = modelReports(sup, g.agentId);
        const full = sumFullUsage(model);
        assert.equal(full.unknown, true, mode + " original fault explicitly unknown (no fabricated zero)");
        assert.equal(full.input, 0, mode + " ledger input zero with unknown flag");
        assert.equal(full.output, 0, mode + " ledger output zero with unknown flag");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown-" + tag, error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    };
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      await runMode("throw-once", "throw");
      await runMode("reject-once", "reject");
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: summary identity pinned to SDK 1.2.0 construction (fixed)", async () => {
  const sdkRoot = requireSdkRoot();
  const indexMod = await import(sdkRoot + "/dist/index.js") as Record<string, unknown>;
  assert.ok(!("SUMMARIZATION_SYSTEM_PROMPT" in indexMod), "package root public API omits the constant (deep import unsupported)");
  const utilsText: string = readFileSync(join(sdkRoot, "dist", "core", "compaction", "utils.js"), "utf8");
  const compactionText: string = readFileSync(join(sdkRoot, "dist", "core", "compaction", "compaction.js"), "utf8");
  const driver = await import("../src/deterministic.ts") as Record<string, unknown>;
  const literal: unknown = driver["PINNED_SDK_1_1_0_SUMMARIZATION_SYSTEM_PROMPT"];
  assert.ok(typeof literal === "string" && literal.length > 0, "driver pinned literal asserted");
  const extracted: string[] = [];
  const pattern = /SUMMARIZATION_SYSTEM_PROMPT\s*=\s*`([\s\S]*?)`;(?=\s*\n)/g;
  let found: RegExpExecArray | null = null;
  while ((found = pattern.exec(utilsText)) !== null) extracted.push(found[1] as string);
  assert.equal(extracted.length, 1, "exactly one system prompt construction in SDK source");
  assert.equal(literal as string, extracted[0] as string, "driver literal exactly equals extracted SDK construction");
  const historyFrame: unknown = driver["PINNED_SDK_1_1_0_HISTORY_FRAME_OPEN"];
  const prefixFrame: unknown = driver["PINNED_SDK_1_1_0_PREFIX_FRAME_OPEN"];
  assert.equal(historyFrame, "<conversation>\n", "history frame opener pinned");
  assert.equal(prefixFrame, "# Conversation\n", "prefix frame opener pinned");
  assert.ok(compactionText.includes("`<conversation>\\n" + "${conversationText}"), "history frame template verified in SDK builder source");
  assert.ok(compactionText.includes("`# Conversation\\n" + "${conversationText}"), "prefix frame template verified in SDK builder source");
  assert.ok(
    compactionText.includes("`<conversation>\\n${conversationText}\\n</conversation>\\n\\n`"),
    "history full frame (opener, conversation, closer) pinned exactly",
  );
  assert.ok(
    compactionText.includes("`# Conversation\\n${conversationText}\\n\\n# Instructions\\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`"),
    "prefix full frame (opener, conversation, instructions prompt) pinned exactly",
  );
});

test("provider-start hold: unwritable collector setup fails visibly (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdreadonly-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    let handle: { kill: () => void; exit: { code: number | null; signal: string | null } | null } | null = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [{ text: "hello direct" }];
      const { WorkerHandle: WH } = await import("../src/worker-launch.ts");
      const { bindChannel: bc } = await import("../src/protocol.ts");
      const agentDir = join(dir, "worker-home", "agent-direct");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, ENTRY_LOG), "");
      chmodSync(join(agentDir, ENTRY_LOG), 0o444);
      const binding = bc("epoch-direct-ro", "agent-direct", "instance-direct-ro");
      const handle0 = new WH({
        workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
        rootEpoch: "epoch-direct-ro", agentId: "agent-direct", sdkRoot, deterministic: true,
        agentDir, sessionsDir, hostAgentDir: join(dir, "host-agent"),
        script: SCRIPT,
        extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
      }, binding);
      handle = handle0;
      await handle0.launch();
      const ackRaw: unknown = await handle0.request("initialize", {
        taskText: "hello direct",
        profile: "reader",
        instructionHash: "",
        instructions: { contextFiles: [], skills: [] },
        model: { provider: "openai", id: "deterministic-test", thinkingLevel: "off" },
        taskRunId: "task-direct-ro",
        executionGeneration: 1,
        workdir: dir,
        readRoots: [dir],
        writable: false,
        tools: [],
      }, { taskRunId: "task-direct-ro", generation: 1, timeoutMs: 60000 });
      assert.ok(typeof ackRaw === "object" && ackRaw !== null, "initialize ack asserted record");
      assert.equal((ackRaw as Record<string, unknown>)["ok"], false, "unwritable collector setup must deny initialize");
      const code: unknown = (ackRaw as Record<string, unknown>)["code"];
      assert.ok(code === "INVALID" || code === "MODEL_UNAVAILABLE", "setup denial typed, got " + String(code));
      const text: string = String((ackRaw as Record<string, unknown>)["message"] ?? (ackRaw as Record<string, unknown>)["error"] ?? "");
      assert.ok(text.includes("ENTRY_LOG") || text.includes("collector") || text.includes("EACCES") || text.includes("denied"), "denial names collector: " + text.slice(0, 200));
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    } finally {
      try {
        chmodSync(join(dir, "worker-home", "agent-direct", ENTRY_LOG), 0o644);
      } catch (restoreError: unknown) {
        secondaries.push({ phase: "chmod-restore", error: restoreError });
      }
    }
    try {
      if (handle !== null) handle.kill();
    } catch (e2: unknown) {
      secondaries.push({ phase: "kill", error: e2 });
    }
    if (handle !== null) {
      const t0 = Date.now();
      while (handle.exit === null && Date.now() - t0 < 15000) await tick(50);
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});


test("provider-start hold: external 5/7 billed once across OS process restart (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  void sdkRoot;
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdrestart-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    try {
      const storeDir = join(dir, "filestore");
      mkdirSync(storeDir, { recursive: true });
      const { spawnSync } = await import("node:child_process");
      const childEnv: Record<string, string> = {};
      for (const key of ["PATH", "HOME", "PI_SUBAGENTS_SDK_ROOT"]) {
        const v: unknown = process.env[key];
        if (typeof v === "string") childEnv[key] = v;
      }
      childEnv["PI_OFFLINE"] = "1";
      childEnv["PI_TELEMETRY"] = "0";
      const phase1Fixture = new URL("./fixtures/restart-phase1.mjs", import.meta.url).pathname;
      assert.ok(existsSync(phase1Fixture), "restart phase-1 fixture exported in owned tree (not historical path): " + phase1Fixture);
      const kid = spawnSync(process.execPath, [phase1Fixture, storeDir, dir], { env: childEnv, timeout: 120000, encoding: "utf8" });
      assert.equal(kid.status, 0, "phase-1 process must exit cleanly after hold: " + String(kid.stderr).slice(-2000));
      assert.ok(typeof kid.pid === "number" && kid.pid > 0, "phase-1 pid asserted");
      assert.notEqual(kid.pid, process.pid, "phase-1 ran in a distinct OS process (actual restart boundary)");
      const holdInfo: unknown = JSON.parse(readFileSync(join(dir, "phase1-hold"), "utf8"));
      assert.ok(typeof holdInfo === "object" && holdInfo !== null, "phase-1 hold marker asserted");
      const op: unknown = (holdInfo as Record<string, unknown>)["op"];
      assert.ok(typeof op === "string" && op.length > 0, "phase-1 fault op asserted");
      const { FileRunStore } = await import("../src/store.ts");
      const CG_HANDLE = { name: CG, description: "d", parameters: { type: "object" }, execute: cgUsage };
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [CG];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const sup = new Supervisor({
        rootId: "root-restart",
        rootDir: join(dir, "root2"),
        store: new FileRunStore(storeDir, "root-restart"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot: requireSdkRoot(), deterministic: true,
            agentDir, sessionsDir: join(dir, "sessions"), hostAgentDir,
            script: [{ text: "after restart" }],
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          return traceableHandle(handle, []);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [CG_HANDLE], getHandle: () => CG_HANDLE, baseCtx: () => ({}) }),
      });
      try {
        assert.equal(sup.needsRecovery, true, "reopened store must hold for uncommitted receipt");
        await sup.recover();
        assert.equal(sup.needsRecovery, false, "recover clears after durable commit");
        const debt = extReports(sup, op as string);
        assert.equal(debt.length, 1, "debt billed exactly once across restart");
        assert.deepEqual(sumUsage(debt), { input: EXPECTED_INPUT, output: EXPECTED_OUTPUT }, "debt exact 5/7");
        const effectCount: string = readFileSync(join(dir, "effect-count"), "utf8");
        assert.equal(effectCount.length, 1, "effect ran exactly once across restart (no rerun)");
        const g2 = await sup.spawn("governor", { taskName: "after", message: "go", profile: "writer", isolation: "none" }, "restart-after");
        const termRaw = await waitTerminal(sup, g2.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.equal(terminalOutcome(assertTerminalRecord(termRaw, "after")), "succeeded", "post-restart run settles");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: pending latch decoding rejects malformed and stale identity (fixed)", () => {
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const dir = mkdtempSync(join(tmpdir(), "subagents-provholdlatch-"));
    try {
      const { decodeLatch: decode } = await import("../src/deterministic.ts");
      const good = { state: "pending", taskRunId: "task-1", generation: 2, agentId: "agent-1", provider: "test-sim", model: "sim-1", kind: "history", turn: 7, at: 123 };
      const goodPath = join(dir, "good.jsonl");
      writeFileSync(goodPath, JSON.stringify(good) + "\n");
      const decoded = decode(goodPath);
      assert.equal(decoded.taskRunId, "task-1", "latch task decoded");
      assert.equal(decoded.generation, 2, "latch generation decoded");
      assert.equal(decoded.kind, "history", "latch kind decoded");
      assert.equal(decoded.turn, 7, "latch turn decoded");
      assert.notEqual(decoded.taskRunId, "other-task", "stale task mismatch detectable");
      assert.notEqual(decoded.generation, 99, "stale generation mismatch detectable");
      const badCases: Array<{ name: string; body: string }> = [
        { name: "malformed-json", body: "{not json\n" },
        { name: "empty", body: "\n" },
        { name: "null-generation", body: JSON.stringify({ ...good, generation: null }) + "\n" },
        { name: "missing-task", body: JSON.stringify({ state: "pending", generation: 2 }) + "\n" },
        { name: "wrong-kind", body: JSON.stringify({ ...good, kind: "main" }) + "\n" },
        { name: "string-turn", body: JSON.stringify({ ...good, turn: "7" }) + "\n" },
      ];
      for (const c of badCases) {
        const fp = join(dir, c.name + ".jsonl");
        writeFileSync(fp, c.body);
        assert.throws(() => decode(fp), /LATCH_(CORRUPT|MISSING)/, c.name + " must throw named latch error");
      }
      assert.throws(() => decode(join(dir, "absent.jsonl")), /LATCH_MISSING/, "absent latch must throw");
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: explicitly empty collector config denied (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdemptycfg-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    let handle: { kill: () => void; exit: { code: number | null; signal: string | null } | null } | null = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const { WorkerHandle: WH } = await import("../src/worker-launch.ts");
      const { bindChannel: bc } = await import("../src/protocol.ts");
      const agentDir = join(dir, "worker-home", "agent-direct");
      const binding = bc("epoch-direct-empty", "agent-direct", "instance-direct-empty");
      const handle0 = new WH({
        workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
        rootEpoch: "epoch-direct-empty", agentId: "agent-direct", sdkRoot, deterministic: true,
        agentDir, sessionsDir, hostAgentDir: join(dir, "host-agent"),
        script: [{ text: "hello direct" }],
        extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: "" },
      }, binding);
      handle = handle0;
      await handle0.launch();
      const ackRaw: unknown = await handle0.request("initialize", {
        taskText: "hello direct",
        profile: "reader",
        instructionHash: "",
        instructions: { contextFiles: [], skills: [] },
        model: { provider: "openai", id: "deterministic-test", thinkingLevel: "off" },
        taskRunId: "task-direct-empty",
        executionGeneration: 1,
        workdir: dir,
        readRoots: [dir],
        writable: false,
        tools: [],
      }, { taskRunId: "task-direct-empty", generation: 1, timeoutMs: 60000 });
      assert.ok(typeof ackRaw === "object" && ackRaw !== null, "ack asserted record");
      assert.equal((ackRaw as Record<string, unknown>)["ok"], false, "explicitly empty collector config must deny initialize");
      const text: string = String((ackRaw as Record<string, unknown>)["message"] ?? (ackRaw as Record<string, unknown>)["error"] ?? "");
      assert.ok(text.includes("ENTRY_LOG"), "denial names the collector config: " + text.slice(0, 200));
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      if (handle !== null) handle.kill();
    } catch (e2: unknown) {
      secondaries.push({ phase: "kill", error: e2 });
    }
    if (handle !== null) {
      const t0 = Date.now();
      while (handle.exit === null && Date.now() - t0 < 15000) await tick(50);
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: mid-run collector append and read faults fail loudly (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdfaults-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const handles: WorkerHandle[] = [];
    let faultAgentDir: string | null = null;
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [{ text: "one" }, { text: "two" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const sup = new Supervisor({
        rootId: "root-provholdfaults",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdfaults"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          handles.push(handle);
          return traceableHandle(handle, []);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "one", message: "go", profile: "writer", isolation: "none" }, "provholdfaults-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        faultAgentDir = agentDir;
        const term1raw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.equal(terminalOutcome(assertTerminalRecord(term1raw, "t1")), "succeeded", "first run settles");
        const before = readEntryLog(agentDir);
        assert.equal(before.length, 1, "one ENTRY before fault injection (actual counter)");
        chmodSync(join(agentDir, ENTRY_LOG), 0o444);
        let appendFaultObserved = false;
        let appendFaultDetail = "";
        try {
          const t2 = await sup.sendMessage("governor", g.agentId, "task", "second", {}, "provholdfaults-2");
          assert.ok(typeof t2.taskRunId === "string", "task2 asserted");
          const term2raw = await waitTerminal(sup, t2.taskRunId as string, TERMINAL_TIMEOUT_MS);
          const term2 = assertTerminalRecord(term2raw, "t2");
          appendFaultDetail = terminalDetail(term2);
          appendFaultObserved = terminalOutcome(term2) !== "succeeded";
        } catch (faultError: unknown) {
          appendFaultDetail = String(faultError);
          appendFaultObserved =
            appendFaultDetail.includes("ENTRY_TRACE_WRITE_FAILED") || appendFaultDetail.includes("EACCES");
          if (!appendFaultObserved) throw faultError;
        } finally {
          chmodSync(join(agentDir, ENTRY_LOG), 0o644);
        }
        assert.ok(appendFaultObserved, "mid-run append fault surfaced loudly (no silent continuation): " + appendFaultDetail.slice(0, 200));
        assert.ok(
          appendFaultDetail.includes("ENTRY_TRACE_WRITE_FAILED") || appendFaultDetail.includes("EACCES"),
          "append fault loud with named cause: " + appendFaultDetail.slice(0, 200),
        );
        chmodSync(join(agentDir, ENTRY_LOG), 0o000);
        let readFailed = false;
        try {
          readEntryLog(agentDir);
        } catch (readError: unknown) {
          readFailed = true;
          assert.ok(String(readError).includes("EACCES") || String(readError).includes("denied") || String(readError).includes("EPERM"), "read fault loud: " + String(readError).slice(0, 200));
        } finally {
          chmodSync(join(agentDir, ENTRY_LOG), 0o644);
        }
        assert.ok(readFailed, "read fault surfaced loudly (no valid-zero)");
        const after = readEntryLog(agentDir);
        assert.ok(after.length >= 1, "log intact after permission restore (no truncation)");
      } finally {
        try {
          if (faultAgentDir !== null) {
            try { chmodSync(join(faultAgentDir, ENTRY_LOG), 0o644); } catch (permError: unknown) { secondaries.push({ phase: "chmod-restore", error: permError }); }
          }
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: malformed returned usage marks unknown without fabrication (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdmalformed-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const runMode = async (mode: string, tag: string): Promise<void> => {
      const sessionsDir = join(dir, "sessions-" + tag);
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [{ text: "served despite malformed accounting" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const handles: WorkerHandle[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdmalformed-" + tag,
        rootDir: join(dir, "root-" + tag),
        store: new InMemoryRunStore("root-provholdmalformed-" + tag),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG, PI_SUBAGENTS_ORIGINAL_MUTATE_RESULT: mode },
          }, binding);
          handles.push(handle);
          return traceableHandle(handle, []);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "m-" + tag, message: "go", profile: "writer", isolation: "none" }, "provholdmalformed-" + tag);
        const agentDir = join(dir, "worker-home", g.agentId);
        const termRaw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const term = assertTerminalRecord(termRaw, "malformed-" + tag);
        assert.equal(terminalOutcome(term), "succeeded", mode + " provider truth completes; accounting fault must not rewrite outcome");
        const entries = readEntryLog(agentDir);
        assert.equal(entries.length, 1, mode + " single ENTRY (actual counter)");
        const model = modelReports(sup, g.agentId);
        const full = sumFullUsage(model);
        assert.equal(full.unknown, true, mode + " malformed usage explicitly unknown");
        assert.equal(full.input, 0, mode + " no fabricated input");
        assert.equal(full.output, 0, "no fabricated output");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown-" + tag, error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    };
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      await runMode("negative-input", "neg");
      await runMode("drop-totaltokens", "drop");
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: observer record fault fails terminal with cause, usage retained (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdobsfault-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const handles: WorkerHandle[] = [];
    const OVERFLOW = "maximum context length is 32768 tokens, please reduce the length of the messages";
    try {
      writeFileSync(join(dir, "big1.txt"), "A".repeat(15000) + "\n");
      writeFileSync(join(dir, "big2.txt"), "B".repeat(15000) + "\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [
        { tool: "read", args: { path: "big1.txt" } },
        { text: "phase one done" },
        { tool: "read", args: { path: "big1.txt" } },
        { tool: "read", args: { path: "big2.txt" } },
        { tool: "read", args: { path: "big1.txt" } },
        { error: OVERFLOW },
        { text: "phase two done" },
      ];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdobsfault",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdobsfault"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          mkdirSync(agentDir, { recursive: true });
          writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 128 } }));
          const child = new URL("./fixtures/observer-fault-child.mjs", import.meta.url).pathname;
          assert.ok(existsSync(child), "observer fault fixture exported in owned tree: " + child);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG, PI_SUBAGENTS_SUMMARY_USAGE: NONZERO_SUMMARY_USAGE, NODE_OPTIONS: "--import=" + child },
          }, binding);
          handles.push(handle);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "phase1", message: "read big1", profile: "writer", isolation: "none" }, "provholdobsfault-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const term1raw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.equal(terminalOutcome(assertTerminalRecord(term1raw, "phase1")), "succeeded", "phase1 settles");
        const follow = await sup.sendMessage("governor", g.agentId, "task", "follow-up with more reads", {}, "provholdobsfault-2");
        assert.ok(typeof follow.taskRunId === "string" && follow.taskRunId.length > 0, "follow-up asserted");
        const followId: string = follow.taskRunId as string;
        const term2raw = await waitTerminal(sup, followId, TERMINAL_TIMEOUT_MS);
        const term2 = assertTerminalRecord(term2raw, "phase2");
        assert.notEqual(terminalOutcome(term2), "succeeded", "observation fault must fail the run, not succeed silently");
        const entries = readEntryLog(agentDir);
        const kinds = entries.map((e) => e.kind);
        assert.ok(kinds.includes("history"), "history ENTRY fired (actual callback): " + kinds.join(","));
        assert.ok(kinds.includes("prefix"), "prefix ENTRY fired (actual callback): " + kinds.join(","));
        assert.ok(!existsSync(join(agentDir, "summary-usage.jsonl")), "no success records (observation faulted)");
        const errPath = join(agentDir, "summary-usage-error.jsonl");
        assert.ok(existsSync(errPath), "error checkpoint exists (loud, not silent)");
        const errLines: string[] = readFileSync(errPath, "utf8").split("\n").filter((line) => line.trim().length > 0);
        assert.equal(errLines.length, 2, "both history and prefix observation faults recorded");
        assert.ok(errLines.every((line) => line.includes("CONTROLLER_R6_POST_RESULT_USAGE_APPEND_FAULT")), "checkpoints carry fault cause");
        const errFirst: unknown = JSON.parse(errLines[0] as string) as unknown;
        assert.ok(typeof errFirst === "object" && errFirst !== null, "checkpoint decodes");
        assert.equal((errFirst as Record<string, unknown>)["kind"], "history", "first checkpoint is history");
        assert.equal((errFirst as Record<string, unknown>)["taskRunId"], followId, "checkpoint task matches follow-up");
        const errSecond: unknown = JSON.parse(errLines[1] as string) as unknown;
        assert.equal((errSecond as Record<string, unknown>)["kind"], "prefix", "second checkpoint is prefix");
        const detail = terminalDetail(term2);
        assert.ok(detail.includes("summary usage observation failed"), "terminal carries observation failure cause: " + detail.slice(0, 300));
        assert.ok(detail.includes("turn 7") && detail.includes("history"), "terminal identifies history turn: " + detail.slice(0, 300));
        assert.ok(detail.includes("CONTROLLER_R6_POST_RESULT_USAGE_APPEND_FAULT"), "terminal carries fault identity: " + detail.slice(0, 300));
        const model = modelReports(sup, g.agentId);
        const full = sumFullUsage(model);
        assert.equal(full.input, 188, "ledger retains both halves exactly once (actual sum)");
        assert.equal(full.output, 73, "ledger retains both halves output (actual sum)");
        assert.equal(full.cacheRead, 40, "ledger retains both halves cacheRead");
        assert.equal(full.cacheWrite, 42, "ledger retains both halves cacheWrite");
        assert.equal(full.cost, 30, "ledger retains both halves cost");
        assert.equal(full.unknown, false, "ledger fully known (usages valid; only file records faulted)");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: end-without-message fails explicitly without interrupt (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdendbare-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const handles: WorkerHandle[] = [];
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [{ text: "never served" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdendbare",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdendbare"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG, PI_SUBAGENTS_ORIGINAL_END_BARE: "once" },
          }, binding);
          handles.push(handle);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "bare", message: "go", profile: "writer", isolation: "none" }, "provholdendbare-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const tEntry = Date.now();
        let admitted = false;
        while (Date.now() - tEntry < OPERATIVE_TIMEOUT_MS) {
          if (trace.some((q) => q.taskRunId === g.taskRunId && q.ok === true)) { admitted = true; break; }
          await tick(50);
        }
        assert.ok(admitted, "original invocation admitted via public guard (setup failure)");
        const termRaw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const term = assertTerminalRecord(termRaw, "bare run");
        assert.notEqual(terminalOutcome(term), "succeeded", "bare-ended run must not succeed");
        const bareDetail = terminalDetail(term);
        assert.ok(bareDetail.includes("STREAM_ENDED_WITHOUT_MESSAGE"), "terminal carries explicit EOF failure: " + bareDetail.slice(0, 300));
        assert.ok(existsSync(join(agentDir, ENTRY_LOG)), "collector file present (setup proof)");
        assert.equal(readEntryLog(agentDir).length, 0, "zero provider ENTRY: fault precedes original invocation (actual counter)");
        const model = modelReports(sup, g.agentId);
        const full = sumFullUsage(model);
        assert.equal(full.unknown, true, "bare-end explicitly unknown after owned abort join");
        assert.equal(full.input, 0, "no fabricated input");
        assert.equal(full.output, 0, "no fabricated output");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("provider-start hold: lifecycle append fault fails terminal with cause, usage retained (fixed)", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdcyclefault-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    const handles: WorkerHandle[] = [];
    const OVERFLOW = "maximum context length is 32768 tokens, please reduce the length of the messages";
    try {
      writeFileSync(join(dir, "big1.txt"), "A".repeat(15000) + "\n");
      writeFileSync(join(dir, "big2.txt"), "B".repeat(15000) + "\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [
        { tool: "read", args: { path: "big1.txt" } },
        { text: "phase one done" },
        { tool: "read", args: { path: "big1.txt" } },
        { tool: "read", args: { path: "big2.txt" } },
        { tool: "read", args: { path: "big1.txt" } },
        { error: OVERFLOW },
        { text: "phase two done" },
      ];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() };
      const trace: AdmissionTrace[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdcyclefault",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdcyclefault"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          mkdirSync(agentDir, { recursive: true });
          writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 128 } }));
          const child = new URL("./fixtures/lifecycle-fault-child.mjs", import.meta.url).pathname;
          assert.ok(existsSync(child), "lifecycle fault fixture exported in owned tree: " + child);
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG, PI_SUBAGENTS_SUMMARY_USAGE: NONZERO_SUMMARY_USAGE, NODE_OPTIONS: "--import=" + child },
          }, binding);
          handles.push(handle);
          return traceableHandle(handle, trace);
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "phase1", message: "read big1", profile: "writer", isolation: "none" }, "provholdcyclefault-1");
        const agentDir = join(dir, "worker-home", g.agentId);
        const term1raw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.equal(terminalOutcome(assertTerminalRecord(term1raw, "phase1")), "succeeded", "phase1 settles");
        const follow = await sup.sendMessage("governor", g.agentId, "task", "follow-up with more reads", {}, "provholdcyclefault-2");
        assert.ok(typeof follow.taskRunId === "string" && follow.taskRunId.length > 0, "follow-up asserted");
        const followId: string = follow.taskRunId as string;
        const term2raw = await waitTerminal(sup, followId, TERMINAL_TIMEOUT_MS);
        const term2 = assertTerminalRecord(term2raw, "phase2");
        assert.notEqual(terminalOutcome(term2), "succeeded", "lifecycle fault must fail the run, not succeed silently");
        const detail = terminalDetail(term2);
        assert.ok(detail.includes("compaction lifecycle trace failed"), "terminal carries lifecycle failure cause: " + detail.slice(0, 300));
        const entries = readEntryLog(agentDir);
        assert.ok(entries.some((e) => e.kind === "history"), "history ENTRY fired");
        assert.ok(entries.some((e) => e.kind === "prefix"), "prefix ENTRY fired (provider truth intact)");
        assert.ok(!existsSync(join(agentDir, "compaction-lifecycle.jsonl")), "no lifecycle records (append faulted)");
        const returned = readSummaryUsage(agentDir);
        assert.equal(returned.length, 2, "both summary usages recorded (provider truth intact)");
        const model = modelReports(sup, g.agentId);
        const full = sumFullUsage(model);
        assert.equal(full.input, 188, "ledger retains both halves exactly once (actual sum)");
        assert.equal(full.output, 73, "ledger retains both halves output");
        assert.equal(full.cacheRead, 40, "ledger retains both halves cacheRead");
        assert.equal(full.cacheWrite, 42, "ledger retains both halves cacheWrite");
        assert.equal(full.cost, 30, "ledger retains both halves cost");
        assert.equal(full.unknown, false, "ledger fully known (usage valid; only lifecycle trace faulted)");
        const compactions = compactionEntries(sessionsDir, g.agentId);
        assert.ok(compactions.length >= 1, "SDK compaction entry persisted (provider truth intact)");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("supervisor ledger bills late ORIGINAL receipt under captured identity exactly once", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-latereceipt-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const handles: WorkerHandle[] = [];
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    try {
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [{ text: "genuine-provider-text", usage: { input: 11, output: 6, cacheRead: 7, cacheWrite: 8, costTotal: 9 }, delayMs: 2500 }];
      const localMessage = {
        role: "assistant",
        content: [{ type: "text", text: "facade-local-text" }],
        api: "openai-responses",
        provider: "test",
        model: "deterministic",
        usage: { input: 1000, output: 1000, cacheRead: 1000, cacheWrite: 1000, totalTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 1,
      };
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const sup = new Supervisor({
        rootId: "root-latereceipt",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-latereceipt"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors: { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() },
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          mkdirSync(agentDir, { recursive: true });
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_FACADE_LOCAL_END: JSON.stringify(localMessage) },
          }, binding);
          handles.push(handle);
          return handle;
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "late", message: "go", profile: "writer", isolation: "none" }, "latereceipt-1");
        const termRaw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        const term = assertTerminalRecord(termRaw, "late");
        assert.equal(terminalOutcome(term), "succeeded", "local completion settles the turn");
        const settledReports = modelReports(sup, g.agentId).filter((r) => (r.body as Record<string, unknown>)["late"] !== true);
        assert.equal(settledReports.length, 1, "exactly one settled snapshot report");
        // Poll the durable ledger for the late receipt (deadline-bounded
        // wait; values are the evidence, not the elapsed time).
        const t0 = Date.now();
        let late: JournalRecord[] = [];
        while (Date.now() - t0 < 20000) {
          late = modelReports(sup, g.agentId).filter((r) => (r.body as Record<string, unknown>)["late"] === true);
          if (late.length > 0) break;
          await tick(50);
        }
        assert.equal(late.length, 1, "exactly one late receipt in the durable ledger");
        const body = late[0]!.body as Record<string, unknown>;
        assert.equal(body["agentId"], g.agentId, "late receipt under captured agent identity");
        assert.equal(body["taskRunId"], g.taskRunId, "late receipt under captured task identity");
        assert.deepEqual(
          { input: body["input"], output: body["output"], cacheRead: body["cacheRead"], cacheWrite: body["cacheWrite"], cost: body["cost"] },
          { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, cost: 9 },
          "late receipt bills exactly the genuine breakdown, never the local 1000s",
        );
        const full = sumFullUsage(modelReports(sup, g.agentId));
        assert.deepEqual(
          { input: full.input, output: full.output, cacheRead: full.cacheRead, cacheWrite: full.cacheWrite, cost: full.cost },
          { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, cost: 9 },
          "ledger totals the genuine outcome exactly once across snapshot and receipt",
        );
        assert.equal(full.unknown, true, "turn completed with incomplete accounting at settle");
        await tick(500);
        assert.equal(modelReports(sup, g.agentId).filter((r) => (r.body as Record<string, unknown>)["late"] === true).length, 1, "still exactly one late receipt (no duplication)");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("supervisor ledger attributes late ORIGINAL to its captured generation across a newer turn", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-latenewgen-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const handles: WorkerHandle[] = [];
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    try {
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      // First turn: delayed genuine breakdown + local completion. Later
      // turns fall back to the immediate default script ({10,5,0,0}).
      const SCRIPT = [{ text: "genuine-provider-text", usage: { input: 11, output: 6, cacheRead: 7, cacheWrite: 8, costTotal: 9 }, delayMs: 2500 }];
      const localMessage = {
        role: "assistant",
        content: [{ type: "text", text: "facade-local-text" }],
        api: "openai-responses",
        provider: "test",
        model: "deterministic",
        usage: { input: 1000, output: 1000, cacheRead: 1000, cacheWrite: 1000, totalTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 1,
      };
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const sup = new Supervisor({
        rootId: "root-latenewgen",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-latenewgen"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors: { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() },
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          mkdirSync(agentDir, { recursive: true });
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_FACADE_LOCAL_END: JSON.stringify(localMessage) },
          }, binding);
          handles.push(handle);
          return handle;
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g1 = await sup.spawn("governor", { taskName: "first", message: "go", profile: "writer", isolation: "none" }, "latenewgen-1");
        const term1raw = await waitTerminal(sup, g1.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.equal(terminalOutcome(assertTerminalRecord(term1raw, "first")), "succeeded", "first turn settles locally");
        // A newer turn starts (and settles on its own fallback script)
        // while the first turn's genuine outcome is still in flight: the
        // late receipt must bill under the FIRST identity, never the new.
        const g2 = await sup.sendMessage("governor", g1.agentId, "task", "second", {}, "latenewgen-2");
        assert.ok(typeof g2.taskRunId === "string" && g2.taskRunId.length > 0, "second taskRunId asserted");
        const term2raw = await waitTerminal(sup, g2.taskRunId as string, TERMINAL_TIMEOUT_MS);
        assert.equal(terminalOutcome(assertTerminalRecord(term2raw, "second")), "succeeded", "second turn settles on its own");
        const t0 = Date.now();
        let late: JournalRecord[] = [];
        while (Date.now() - t0 < 20000) {
          late = modelReports(sup, g1.agentId).filter((r) => (r.body as Record<string, unknown>)["late"] === true);
          if (late.length > 0) break;
          await tick(50);
        }
        assert.equal(late.length, 1, "exactly one late receipt despite the newer turn");
        const body = late[0]!.body as Record<string, unknown>;
        assert.equal(body["taskRunId"], g1.taskRunId, "late receipt keeps the captured first-task identity (no misattribution)");
        assert.equal(body["generation"], g1.generation, "late receipt keeps the captured first generation");
        assert.deepEqual(
          { input: body["input"], output: body["output"], cacheRead: body["cacheRead"], cacheWrite: body["cacheWrite"], cost: body["cost"] },
          { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, cost: 9 },
          "late receipt bills the genuine first-turn breakdown only",
        );
        // Ledger: late first-turn usage plus the second turn's own fallback
        // ({10,5,0,0}) exactly once each; the second turn's settled report
        // carries only its own fallback (no misattributed genuine usage).
        const secondReports = modelReports(sup, g1.agentId).filter((r) => (r.body as Record<string, unknown>)["taskRunId"] === g2.taskRunId && (r.body as Record<string, unknown>)["late"] !== true);
        assert.equal(secondReports.length, 1, "exactly one settled report for the second turn");
        assert.deepEqual(
          { input: (secondReports[0]!.body as Record<string, unknown>)["input"], output: (secondReports[0]!.body as Record<string, unknown>)["output"] },
          { input: 10, output: 5 },
          "second turn settled on its own fallback only",
        );
        const full = sumFullUsage(modelReports(sup, g1.agentId));
        assert.deepEqual(
          { input: full.input, output: full.output, cacheRead: full.cacheRead, cacheWrite: full.cacheWrite, cost: full.cost },
          { input: 36, output: 11, cacheRead: 7, cacheWrite: 8, cost: 9 },
          "ledger totals late first-turn plus second-turn fallback exactly once each",
        );
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("failed late-report append holds admission until recovery bills exactly once", () => {
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-laterecover-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const handles: WorkerHandle[] = [];
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    try {
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const SCRIPT = [{ text: "genuine-provider-text", usage: { input: 11, output: 6, cacheRead: 7, cacheWrite: 8, costTotal: 9 }, delayMs: 2500 }];
      const localMessage = {
        role: "assistant",
        content: [{ type: "text", text: "facade-local-text" }],
        api: "openai-responses",
        provider: "test",
        model: "deterministic",
        usage: { input: 1000, output: 1000, cacheRead: 1000, cacheWrite: 1000, totalTokens: 4000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 1,
      };
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const base = new InMemoryRunStore("root-laterecover");
      // Faultable journal: the FIRST late usage.reported commit fails
      // (STORE_FAILED); everything else (including the retry) passes.
      // Armed once, then heals: recovery must bill exactly once.
      let armed = true;
      const store = new Proxy(base, {
        get(t: any, prop: string | symbol) {
          if (prop === "append") {
            return (kind: string, body: any) => {
              if (armed && kind === "usage.reported" && body?.late === true) {
                armed = false;
                throw Object.assign(new Error("STORE_FAILED: injected crash on late usage commit"), { code: "STORE_FAILED" });
              }
              return t.append(kind, body);
            };
          }
          const v: any = Reflect.get(t, prop, t);
          return typeof v === "function" ? v.bind(t) : v;
        },
      });
      const sup = new Supervisor({
        rootId: "root-laterecover",
        rootDir: join(dir, "root"),
        store: store as any,
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors: { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() },
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          mkdirSync(agentDir, { recursive: true });
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: SCRIPT,
            extraEnv: { PI_SUBAGENTS_FACADE_LOCAL_END: JSON.stringify(localMessage) },
          }, binding);
          handles.push(handle);
          return handle;
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const g = await sup.spawn("governor", { taskName: "late", message: "go", profile: "writer", isolation: "none" }, "laterecover-1");
        const termRaw = await waitTerminal(sup, g.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.equal(terminalOutcome(assertTerminalRecord(termRaw, "late")), "succeeded", "local completion settles the turn");
        // The late commit fails: debt hold engages (no silent loss), the
        // ledger carries no late receipt yet.
        const tHold = Date.now();
        while (sup.needsRecovery !== true && Date.now() - tHold < 20000) await tick(50);
        assert.equal(sup.needsRecovery, true, "failed late commit holds health");
        assert.equal(
          modelReports(sup, g.agentId).filter((r) => (r.body as Record<string, unknown>)["late"] === true).length,
          0,
          "failed commit left no durable late receipt",
        );
        await assert.rejects(
          sup.spawn("governor", { taskName: "blocked", message: "m", profile: "writer", isolation: "none" }, "laterecover-blocked"),
          /RECOVERY_OWNER_UNCONFIRMED/,
          "new admission denied while late billing uncommitted",
        );
        // Recovery retries the retained commit exactly once, then heals.
        await sup.recover();
        const late = modelReports(sup, g.agentId).filter((r) => (r.body as Record<string, unknown>)["late"] === true);
        assert.equal(late.length, 1, "recovery billed the retained late receipt exactly once");
        const body = late[0]!.body as Record<string, unknown>;
        assert.deepEqual(
          { input: body["input"], output: body["output"], cacheRead: body["cacheRead"], cacheWrite: body["cacheWrite"], cost: body["cost"] },
          { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, cost: 9 },
          "recovered receipt bills the genuine breakdown",
        );
        assert.equal(sup.needsRecovery, false, "health clears after billed reconciliation");
        // Post-recovery work uses a fresh worker (same delayed script +
        // seam): it settles locally, then bills its own late receipt under
        // its own captured identity — the pipeline works repeatedly.
        const g2 = await sup.spawn("governor", { taskName: "after", message: "go", profile: "writer", isolation: "none" }, "laterecover-2");
        const term3raw = await waitTerminal(sup, g2.taskRunId, TERMINAL_TIMEOUT_MS);
        assert.equal(terminalOutcome(assertTerminalRecord(term3raw, "after")), "succeeded", "post-recovery run settles");
        const tLate2 = Date.now();
        let late2: JournalRecord[] = [];
        while (Date.now() - tLate2 < 20000) {
          late2 = modelReports(sup).filter((r) => (r.body as Record<string, unknown>)["late"] === true);
          if (late2.length >= 2) break;
          await tick(50);
        }
        assert.equal(late2.length, 2, "exactly two late receipts (one per delayed turn), no duplication");
        const lateBodies = late2.map((r) => r.body as Record<string, unknown>);
        assert.deepEqual(
          lateBodies.map((b) => b["taskRunId"]).sort(),
          [g.taskRunId, g2.taskRunId].sort(),
          "each late receipt carries its own captured task identity",
        );
        const full = sumFullUsage(modelReports(sup));
        assert.deepEqual(
          { input: full.input, output: full.output, cacheRead: full.cacheRead, cacheWrite: full.cacheWrite, cost: full.cost },
          { input: 52, output: 12, cacheRead: 14, cacheWrite: 16, cost: 18 },
          "ledger totals both late receipts exactly once each",
        );
        assert.equal(full.unknown, true, "turns completed with incomplete accounting at settle");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("reviewer late ORIGINAL receipt bills under reviewer identity (boundary)", () => {
  // intakeLateUsage is intentionally reviewer-agnostic (handled before the
  // reviewer early-return): a late receipt for a reviewer generation bills
  // under its captured identity instead of being ignored. Emission-side
  // coverage through a dead reviewer worker is lifecycle-impossible
  // (reviewer workers are killed at settle, so no post-settle raw can ever
  // arrive); this pins the consumption contract directly through a narrow
  // white-box intake invocation in the established glassbox style, with a
  // live reviewer flow providing the true runtime and identities. No
  // production behavior is stubbed or bypassed.
  const sdkRoot = requireSdkRoot();
  const dir = mkdtempSync(join(tmpdir(), "subagents-provholdrevlate-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const handles: WorkerHandle[] = [];
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    try {
      writeFileSync(join(dir, READ_PATH), "hello-model-bytes\n");
      const sessionsDir = join(dir, "sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const REVIEWER_SCRIPT = [{ tool: "read", args: { path: READ_PATH } }, { text: "review note" }];
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      let factoryCalls = 0;
      const candidates: CtlWorker[] = [];
      const sup = new Supervisor({
        rootId: "root-provholdrevlate",
        rootDir: join(dir, "root"),
        store: new InMemoryRunStore("root-provholdrevlate"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          factoryCalls += 1;
          if (factoryCalls === 1) {
            const w = new CtlWorker(o.agentId);
            candidates.push(w);
            return w;
          }
          const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
          const hostAgentDir = join(dir, "host-agent");
          mkdirSync(hostAgentDir, { recursive: true });
          const agentDir = join(dir, "worker-home", o.agentId);
          mkdirSync(agentDir, { recursive: true });
          const handle = new WorkerHandle({
            workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
            rootEpoch: o.rootEpoch, agentId: o.agentId, sdkRoot, deterministic: true,
            agentDir, sessionsDir, hostAgentDir,
            script: REVIEWER_SCRIPT,
            extraEnv: { PI_SUBAGENTS_PROVIDER_ENTRY_LOG: ENTRY_LOG },
          }, binding);
          handles.push(handle);
          return handle;
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        const candidate = await sup.spawn("governor", { taskName: "gated", message: "go", profile: "reader", gate: { ...gateSpec(3) } }, "provholdrevlate-1");
        await tick(100);
        const candWorker = candidates.find((w) => w.agentId === candidate.agentId);
        assert.ok(candWorker, "candidate missing (setup failure)");
        candWorker.settle("succeeded", "candidate work");
        const tLink = Date.now();
        let reviewerId: string | null = null;
        while (Date.now() - tLink < OPERATIVE_TIMEOUT_MS) {
          reviewerId = sup.gateController.inspect(candidate.taskRunId)?.reviewerId ?? null;
          if (reviewerId) break;
          await tick(100);
        }
        assert.ok(reviewerId, "reviewer never linked (setup failure)");
        const reviewer = reviewerId as string;
        // The reviewer turn settles normally first (setup premise: a live
        // reviewer runtime with a settled generation exists).
        const tSettled = Date.now();
        let settledReports: JournalRecord[] = [];
        while (Date.now() - tSettled < 30000) {
          settledReports = modelReports(sup, reviewer).filter((r) => (r.body as Record<string, unknown>)["late"] !== true);
          if (settledReports.length > 0) break;
          await tick(100);
        }
        assert.ok(settledReports.length > 0, "reviewer turn settled snapshot published (setup premise)");
        // Narrow white-box intake invocation (justified: emission through a
        // dead reviewer worker is lifecycle-impossible; this executes the
        // real intake path — validation, persist-first commit, live
        // accounting, ledger — against the true reviewer runtime).
        const agents = (sup as unknown as { agents: Map<string, { record: { id: string; currentTaskRunId: string | null; executionGeneration: number } }> }).agents;
        const reviewerRt = agents.get(reviewer);
        assert.ok(reviewerRt, "reviewer runtime missing (setup failure)");
        const reviewTaskId = reviewerRt.record.currentTaskRunId;
        assert.ok(typeof reviewTaskId === "string" && reviewTaskId.length > 0, "reviewer current task asserted");
        const intake = (sup as unknown as { intakeLateUsage: (rt: unknown, detail: unknown) => void }).intakeLateUsage.bind(sup);
        const genuineUsage = { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, reasoning: null, cost: 9, unknown: false };
        assert.throws(
          () => intake(reviewerRt, { usage: null, agentId: reviewer, taskRunId: reviewTaskId, generation: reviewerRt.record.executionGeneration, receiptId: "r-bad" }),
          /malformed late usage receipt/,
          "malformed reviewer receipt fails visibly",
        );
        intake(reviewerRt, {
          usage: genuineUsage,
          agentId: reviewer,
          taskRunId: reviewTaskId,
          generation: reviewerRt.record.executionGeneration,
          receiptId: "r-reviewer-1",
        });
        const late = modelReports(sup, reviewer).filter((r) => (r.body as Record<string, unknown>)["late"] === true);
        assert.equal(late.length, 1, "exactly one late receipt for the reviewer turn");
        const body = late[0]!.body as Record<string, unknown>;
        assert.equal(body["agentId"], reviewer, "late receipt under captured reviewer identity (not candidate, not dropped)");
        assert.equal(body["taskRunId"], reviewTaskId, "late receipt under captured review task identity");
        assert.deepEqual(
          { input: body["input"], output: body["output"], cacheRead: body["cacheRead"], cacheWrite: body["cacheWrite"], cost: body["cost"] },
          { input: 26, output: 6, cacheRead: 7, cacheWrite: 8, cost: 9 },
          "reviewer late receipt bills the genuine breakdown",
        );
        const live = sup.list("governor").find((v) => v.id === reviewer);
        assert.ok(live !== undefined && (live.usage.inputTokens as number) >= 26, "reviewer live totals hold the genuine held usage");
        await tick(200);
        assert.equal(modelReports(sup, reviewer).filter((r) => (r.body as Record<string, unknown>)["late"] === true).length, 1, "still exactly one reviewer late receipt");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
        await joinWorkerExits(handles, 15000, secondaries);
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("failed late receipt survives OS-process restart via durable outbox (boundary)", () => {
  const sdkRoot = requireSdkRoot();
  void sdkRoot;
  const dir = mkdtempSync(join(tmpdir(), "subagents-latereboot-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    try {
      const storeDir = join(dir, "filestore");
      mkdirSync(storeDir, { recursive: true });
      const { spawnSync } = await import("node:child_process");
      const childEnv: Record<string, string> = {};
      for (const key of ["PATH", "HOME", "PI_SUBAGENTS_SDK_ROOT"]) {
        const v: unknown = process.env[key];
        if (typeof v === "string") childEnv[key] = v;
      }
      childEnv["PI_OFFLINE"] = "1";
      childEnv["PI_TELEMETRY"] = "0";
      const phase1Fixture = new URL("./fixtures/restart-late-phase1.mjs", import.meta.url).pathname;
      assert.ok(existsSync(phase1Fixture), "restart late phase-1 fixture exported in owned tree (not historical path): " + phase1Fixture);
      const kid = spawnSync(process.execPath, [phase1Fixture, storeDir, dir], { env: childEnv, timeout: 120000, encoding: "utf8" });
      assert.equal(kid.status, 0, "phase-1 process must exit cleanly after hold: " + String(kid.stderr).slice(-2000));
      assert.ok(typeof kid.pid === "number" && kid.pid > 0, "phase-1 pid asserted");
      assert.notEqual(kid.pid, process.pid, "phase-1 ran in a distinct OS process (actual restart boundary)");
      const holdInfo: unknown = JSON.parse(readFileSync(join(dir, "late-reboot-ready"), "utf8"));
      assert.ok(typeof holdInfo === "object" && holdInfo !== null, "phase-1 hold marker asserted");
      const hold = holdInfo as Record<string, unknown>;
      const pendingKeys = hold["pendingKeys"] as unknown;
      assert.ok(Array.isArray(pendingKeys) && pendingKeys.length === 1 && typeof pendingKeys[0] === "string", "phase-1 retained exactly one obligation");
      // Reopen in THIS process (a new supervisor instance over the same
      // durable store): the obligation must be restored with fail-closed
      // admission even though the originating memory is gone with phase-1.
      const { FileRunStore } = await import("../src/store.ts");
      const policy = defaultSupervisorPolicy();
      policy.allowedModels = [{ provider: "p", id: "m" }];
      policy.allowedTools = [];
      const executors = { sandbox: new DummyToolExecutor(), host: new DummyToolExecutor() };
      const sup = new Supervisor({
        rootId: "root-latereboot",
        rootDir: join(dir, "root2"),
        store: new FileRunStore(storeDir, "root-latereboot"),
        policy,
        governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: { contextFiles: [], skills: [] } }),
        schedulerLimits: { maxRunnable: 4, maxResidentWorkers: 8, maxAgentsCreated: 8, maxDepth: 1 },
        executors,
        workspace: new DummyWorkspaceManager(),
        workerFactory: (o) => {
          const w = new CtlWorker(o.agentId);
          return w;
        },
        governingRegistry: () => ({ isActive: () => true, listHandles: () => [], getHandle: () => undefined, baseCtx: () => ({}) }),
      });
      try {
        assert.equal(sup.needsRecovery, true, "reopened store must hold for the uncommitted late obligation");
        await assert.rejects(
          sup.spawn("governor", { taskName: "blocked", message: "m", profile: "writer", isolation: "none" }, "latereboot-blocked"),
          /RECOVERY_OWNER_UNCONFIRMED/,
          "admission held across restart until the obligation commits",
        );
        await sup.recover();
        assert.equal(sup.needsRecovery, false, "recover clears after durable commit");
        const recs = new FileRunStore(storeDir, "root-latereboot").readSince(0, Number.MAX_SAFE_INTEGER).records;
        const late = recs.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["late"] === true);
        assert.equal(late.length, 1, "recovery billed the retained obligation exactly once");
        const body = late[0]!.body as Record<string, unknown>;
        assert.equal(body["agentId"], hold["agentId"], "recovered receipt keeps captured agent identity");
        assert.equal(body["taskRunId"], hold["taskRunId"], "recovered receipt keeps captured task identity");
        assert.equal(body["receiptId"], pendingKeys[0], "recovered receipt is the retained obligation (same ID across restart)");
        assert.deepEqual(
          { input: body["input"], output: body["output"], cacheRead: body["cacheRead"], cacheWrite: body["cacheWrite"], cost: body["cost"] },
          (hold["usage"] as Record<string, unknown>),
          "recovered receipt bills the original full payloads",
        );
        // Duplicate delivery and repeated recovery stay idempotent.
        const rt = (sup as unknown as { agents: Map<string, unknown> }).agents.get(hold["agentId"] as string);
        const intake = (sup as unknown as { intakeLateUsage: (rt: unknown, detail: unknown) => void }).intakeLateUsage.bind(sup);
        intake(rt, { usage: (hold["usage"] as Record<string, unknown>), agentId: hold["agentId"], taskRunId: hold["taskRunId"], generation: hold["generation"], receiptId: pendingKeys[0] });
        await sup.recover();
        const late2 = new FileRunStore(storeDir, "root-latereboot").readSince(0, Number.MAX_SAFE_INTEGER).records.filter((r) => r.kind === "usage.reported" && (r.body as Record<string, unknown>)["late"] === true);
        assert.equal(late2.length, 1, "duplicate delivery and repeated recovery bill neither twice");
        const g2 = await sup.spawn("governor", { taskName: "after", message: "go", profile: "writer", isolation: "none" }, "latereboot-after");
        assert.ok(typeof g2.taskRunId === "string" && g2.taskRunId.length > 0, "post-recovery spawn admitted (hold cleared)");
      } finally {
        try {
          await sup.shutdown();
        } catch (shutdownError: unknown) {
          secondaries.push({ phase: "shutdown", error: shutdownError });
        }
      }
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});

test("restart fixture teardown failure exits loudly with joined worker exits", () => {
  // Injected teardown-failure control for the durable-outbox fixture:
  // faulting store.close() must surface (nonzero exit naming the cause)
  // instead of hiding behind phase-1 success, while worker exits are
  // still actually joined. Only after this control exists may teardown
  // catches stay concise.
  const dir = mkdtempSync(join(tmpdir(), "subagents-latereboot-neg-"));
  return (async (): Promise<void> => {
    let primaryThrown = false;
    let primary: unknown = null;
    const secondaries: Array<{ phase: string; error: unknown }> = [];
    try {
      const storeDir = join(dir, "filestore");
      mkdirSync(storeDir, { recursive: true });
      const { spawnSync } = await import("node:child_process");
      const childEnv: Record<string, string> = {};
      for (const key of ["PATH", "HOME", "PI_SUBAGENTS_SDK_ROOT"]) {
        const v: unknown = process.env[key];
        if (typeof v === "string") childEnv[key] = v;
      }
      childEnv["PI_OFFLINE"] = "1";
      childEnv["PI_TELEMETRY"] = "0";
      childEnv["RESTART_LATE_FAIL_TEARDOWN"] = "1";
      const phase1Fixture = new URL("./fixtures/restart-late-phase1.mjs", import.meta.url).pathname;
      assert.ok(existsSync(phase1Fixture), "fixture exported in owned tree: " + phase1Fixture);
      const kid = spawnSync(process.execPath, [phase1Fixture, storeDir, dir], { env: childEnv, timeout: 120000, encoding: "utf8" });
      assert.notEqual(kid.status, 0, "injected teardown failure must fail the process");
      const out = String(kid.stderr) + "\n" + String(kid.stdout);
      assert.match(out, /LATE_REBOOT_TEARDOWN_FAILURES/, "teardown failure named");
      assert.match(out, /STORE_FAILED/, "injected close fault cause preserved");
      assert.match(out, /LATE_REBOOT_WORKER_EXIT_JOINED/, "worker exits joined despite teardown failure");
    } catch (e: unknown) {
      primaryThrown = true;
      primary = e;
    }
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e2: unknown) {
      secondaries.push({ phase: "rm", error: e2 });
    }
    throwCombined(primaryThrown, primary, secondaries);
  })();
});
