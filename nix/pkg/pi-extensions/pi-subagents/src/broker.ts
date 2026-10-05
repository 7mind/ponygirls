/**
 * pi-subagents — supervisor-owned tool broker.
 *
 * The worker registers proxy tools only. Every invocation is validated
 * after any argument transformation, against caller authority derived from
 * the authenticated channel. The broker covers nested tool invocation as
 * well as direct model calls (nested calls arrive as tool.execute with a
 * parentOperationId and are authorized identically).
 *
 * Before a brokered side effect, the intent (op id, args, generation) is
 * durably recorded; confirmed outcomes are recorded separately. A crash
 * between effect and confirmation stays `uncertain` — never replayed.
 */

import { randomUUID } from "node:crypto";
import { err } from "./errors.ts";
import { resolveExe } from "./sandbox.ts";
import { authorizeTool } from "./policy.ts";
import type { ToolExecutor, ToolJobResult, ToolJobSpec } from "./sandbox.ts";
import type { RunStore } from "./store.ts";
import type { AgentId, GrantSet, OperationId } from "./types.ts";

export interface BrokerCaller {
  agentId: AgentId;
  taskRunId: string | null;
  generation: number | null;
  grants: GrantSet;
  worktreePath: string | null;
  readRoots: string[];
  tmpDir: string;
  sandboxProbed: boolean;
  /** Supervisor storage/sibling paths absent from the tool view. */
  hidePaths: string[];
}

export interface ToolRequest {
  operationId?: string;
  tool: string;
  args: Record<string, unknown>;
  parentOperationId?: string;
  /** Approval token for `ask`-gated operations. */
  approvalId?: string;
}

export interface ApprovalRecord {
  id: string;
  agentId: AgentId;
  generation: number | null;
  tool: string;
  normalizedArgs: Record<string, unknown>;
  policyRevision: number;
  createdAt: string;
  deadlineAt: string;
  consumed: boolean;
  revoked: boolean;
}

export interface OwnedJob {
  operationId: OperationId;
  agentId: AgentId;
  tool: string;
  startedAt: string;
  done: boolean;
}

const TOOL_TIMEOUT_MS = 120_000;
const TOOL_MAX_OUTPUT = 256 * 1024;

export class ToolBroker {
  private executor: ToolExecutor;
  private store: RunStore;
  private jobs = new Map<OperationId, OwnedJob>();
  private approvals = new Map<string, ApprovalRecord>();
  private runtimeRoots: string[];
  private baseEnv: Record<string, string>;

  constructor(executor: ToolExecutor, store: RunStore, runtimeRoots: string[] = [], baseEnv: Record<string, string> = {}) {
    this.executor = executor;
    this.store = store;
    this.runtimeRoots = runtimeRoots;
    this.baseEnv = baseEnv;
  }

  /** Active (unfinished) owned jobs for an agent. */
  activeJobs(agentId: AgentId): OwnedJob[] {
    return [...this.jobs.values()].filter((j) => j.agentId === agentId && !j.done);
  }

  /** Cancel owned tool jobs (best effort) and mark them done-uncertain. */
  async cancelJobs(agentId: AgentId): Promise<string[]> {
    const active = this.activeJobs(agentId);
    for (const job of active) {
      try {
        await this.executor.cancel?.(job.operationId);
      } catch {
        // best effort; outcome stays uncertain
      }
      job.done = true;
      this.store.append("tool.outcome", { operationId: job.operationId, status: "cancelled" });
    }
    return active.map((j) => j.operationId);
  }

  /**
   * Controller-executed check against a paused candidate view. Unlike model
   * tool calls this needs no shell grant: authority comes from the gate
   * controller, and the view is read-only (writableRoot null). Checks
   * requiring source mutation must use an isolated view or return blocked.
   */
  async runControllerCheck(opts: {
    agentId: AgentId;
    taskRunId: string | null;
    generation: number;
    readRoots: string[];
    tmpDir: string;
    hidePaths: string[];
    command: string;
    cwd: string;
  }): Promise<ToolJobResult> {
    if (!opts.command) throw err("INVALID", "check command required");
    if (opts.command.length > 32 * 1024) throw err("PAYLOAD_TOO_LARGE", "check command exceeds 32KiB");
    const operationId = randomUUID();
    const job: OwnedJob = { operationId, agentId: opts.agentId, tool: "gate-check", startedAt: new Date().toISOString(), done: false };
    this.jobs.set(operationId, job);
    this.store.append("tool.intent", {
      operationId,
      agentId: opts.agentId,
      taskRunId: opts.taskRunId,
      generation: opts.generation,
      tool: "gate-check",
    });
    try {
      const bash = resolveExe("bash");
      const result = await this.executor.exec({
        operationId,
        argv: [bash, "-c", opts.command],
        cwd: opts.cwd,
        readRoots: opts.readRoots,
        writableRoot: null,
        tmpDir: opts.tmpDir,
        hidePaths: opts.hidePaths,
        runtimeRoots: this.runtimeRoots,
        env: { ...this.baseEnv, HOME: opts.tmpDir, TMPDIR: opts.tmpDir },
        timeoutMs: TOOL_TIMEOUT_MS,
        maxOutputBytes: TOOL_MAX_OUTPUT,
        network: false,
      });
      job.done = true;
      this.store.append("tool.outcome", { operationId, status: result.exitCode === 0 ? "ok" : "error", exitCode: result.exitCode });
      return result;
    } catch (e) {
      job.done = true;
      this.store.append("tool.outcome", { operationId, status: "uncertain", error: (e as Error).message });
      throw e;
    }
  }

  /** Quiescence gate for parking: no unfinished owned jobs. */
  assertQuiescent(agentId: AgentId): void {
    const active = this.activeJobs(agentId);
    if (active.length > 0) {
      throw err("CONFLICT", `cannot park: ${active.length} owned tool job(s) still active`, { ops: active.map((j) => j.operationId) });
    }
  }

  createApproval(agentId: AgentId, generation: number | null, tool: string, args: Record<string, unknown>, policyRevision: number, ttlMs: number): ApprovalRecord {
    const now = Date.now();
    const record: ApprovalRecord = {
      id: randomUUID(),
      agentId,
      generation,
      tool,
      normalizedArgs: normalizeArgs(args),
      policyRevision,
      createdAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + ttlMs).toISOString(),
      consumed: false,
      revoked: false,
    };
    this.approvals.set(record.id, record);
    this.store.append("approval.recorded", {
      approvalId: record.id,
      agentId,
      tool,
      policyRevision,
      deadlineAt: record.deadlineAt,
    });
    return record;
  }

  revokeApprovals(agentId: AgentId): void {
    for (const a of this.approvals.values()) {
      if (a.agentId === agentId && !a.consumed) a.revoked = true;
    }
  }

  private consumeApproval(approvalId: string, caller: BrokerCaller, tool: string, args: Record<string, unknown>): void {
    const record = this.approvals.get(approvalId);
    if (!record) throw err("NOT_FOUND", `approval ${approvalId} unknown`);
    if (record.consumed) throw err("DUPLICATE_REQUEST", `approval ${approvalId} already consumed`);
    if (record.revoked) throw err("FORBIDDEN", `approval ${approvalId} revoked`);
    if (Date.parse(record.deadlineAt) <= Date.now()) throw err("INVALID", `approval ${approvalId} expired`);
    if (record.agentId !== caller.agentId) throw err("FORGED_AUTHOR", "approval bound to a different agent");
    if (record.tool !== tool) throw err("CONFLICT", "approval bound to a different tool");
    if (record.generation !== caller.generation) throw err("STALE_GENERATION", "approval bound to a different generation");
    if (JSON.stringify(record.normalizedArgs) !== JSON.stringify(args)) {
      throw err("CONFLICT", "approval arguments changed; re-approval required");
    }
    record.consumed = true;
  }

  async execute(caller: BrokerCaller, request: ToolRequest): Promise<ToolJobResult> {
    const auth = authorizeTool(caller.grants, request.tool);
    if (!auth.ok) throw auth.error;
    const args = normalizeArgs(request.args);
    // Generation-bound approvals: when the caller presents an approval
    // token, it must match agent, tool, normalized args, generation, and
    // policy revision, and be live. Consumed exactly once.
    if (request.approvalId !== undefined) {
      this.consumeApproval(request.approvalId, caller, request.tool, args);
    }
    const operationId = request.operationId ?? randomUUID();

    if (this.jobs.has(operationId)) {
      throw err("DUPLICATE_REQUEST", `tool operation ${operationId} already recorded`);
    }
    // Generation fencing: a stale generation cannot start new side effects.
    if (caller.generation === null || caller.generation === undefined) {
      throw err("STALE_GENERATION", "caller has no admitted generation");
    }

    const job: OwnedJob = { operationId, agentId: caller.agentId, tool: request.tool, startedAt: new Date().toISOString(), done: false };
    this.jobs.set(operationId, job);
    this.store.append("tool.intent", {
      operationId,
      agentId: caller.agentId,
      taskRunId: caller.taskRunId,
      generation: caller.generation,
      tool: request.tool,
      parentOperationId: request.parentOperationId ?? null,
    });

    try {
      const result = await this.runTool(caller, operationId, request.tool, args);
      job.done = true;
      this.store.append("tool.outcome", {
        operationId,
        status: result.exitCode === 0 && !result.timedOut ? "ok" : "error",
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        truncated: result.truncated,
        stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
        stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
        preview: result.stdout.slice(0, 2000),
      });
      return result;
    } catch (e) {
      job.done = true;
      this.store.append("tool.outcome", {
        operationId,
        status: "uncertain",
        error: (e as Error).message,
      });
      throw e;
    }
  }

  private async runTool(caller: BrokerCaller, operationId: string, tool: string, args: Record<string, unknown>): Promise<ToolJobResult> {
    switch (tool) {
      case "read":
      case "grep":
      case "find":
      case "ls":
        return this.execReadTool(caller, operationId, tool, args);
      case "write":
      case "edit":
        return this.execWriteTool(caller, operationId, tool, args);
      case "bash":
        return this.execBash(caller, operationId, args);
      case "ask_user":
        throw err("INVALID", "ask_user is answered through the mailbox, not the broker");
      default:
        throw err("POLICY_DENIED", `no implementation for tool ${tool}`);
    }
  }

  private async execReadTool(caller: BrokerCaller, operationId: string, tool: string, args: Record<string, unknown>): Promise<ToolJobResult> {
    const rel = typeof args["path"] === "string" ? args["path"] : "";
    const script = readScript(tool, rel, args);
    return this.executor.exec(this.jobSpec(caller, operationId, ["node", "-e", script], this.readCwd(caller)));
  }

  private async execWriteTool(caller: BrokerCaller, operationId: string, tool: string, args: Record<string, unknown>): Promise<ToolJobResult> {
    if (!caller.worktreePath) throw err("POLICY_DENIED", `${tool} requires a writer worktree allocation`);
    const script = tool === "write" ? writeScript(args) : editScript(args);
    return this.executor.exec(this.jobSpec(caller, operationId, ["node", "-e", script], caller.worktreePath));
  }

  private async execBash(caller: BrokerCaller, operationId: string, args: Record<string, unknown>): Promise<ToolJobResult> {
    if (!caller.grants.shell) throw err("POLICY_DENIED", "shell authority not granted");
    if (!caller.sandboxProbed) throw err("SANDBOX_UNAVAILABLE", "sandbox backend not verified for this agent");
    const command = args["command"];
    if (typeof command !== "string" || command.length === 0) throw err("INVALID", "bash.command must be nonempty");
    if (command.length > 32 * 1024) throw err("PAYLOAD_TOO_LARGE", "bash.command exceeds 32KiB");
    const cwd = caller.worktreePath ?? this.readCwd(caller);
    return this.executor.exec(this.jobSpec(caller, operationId, ["bash", "-c", command], cwd));
  }

  private readCwd(caller: BrokerCaller): string {
    return caller.worktreePath ?? caller.readRoots[0] ?? caller.tmpDir;
  }

  private jobSpec(caller: BrokerCaller, operationId: string, argv: string[], cwd: string): ToolJobSpec {
    // Supervisor PATH first (explicit), then the host process PATH so Nix
    // profile closures resolve; the sandbox environment stays allowlisted.
    const pathEnv = [this.baseEnv["PATH"], process.env["PATH"]].filter((p): p is string => !!p).join(":");
    const exe = resolveExe(argv[0] ?? "", pathEnv);
    return {
      operationId,
      argv: [exe, ...argv.slice(1)],
      cwd,
      readRoots: caller.readRoots,
      writableRoot: caller.worktreePath,
      tmpDir: caller.tmpDir,
      hidePaths: caller.hidePaths,
      runtimeRoots: this.runtimeRoots,
      env: { ...this.baseEnv, HOME: caller.tmpDir, TMPDIR: caller.tmpDir },
      timeoutMs: TOOL_TIMEOUT_MS,
      maxOutputBytes: TOOL_MAX_OUTPUT,
      network: false,
    };
  }
}

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(args ?? {})) as Record<string, unknown>;
}

/** Sandboxed read implementations (run inside the restricted view). */
function readScript(tool: string, rel: string, args: Record<string, unknown>): string {
  const target = JSON.stringify(rel || ".");
  const pattern = JSON.stringify(typeof args["pattern"] === "string" ? args["pattern"] : "");
  const limit = Number.isInteger(args["limit"]) ? (args["limit"] as number) : 200;
  if (tool === "ls") {
    return `const fs=require('fs');const d=JSON.parse(${target});console.log(fs.readdirSync(d||'.').join('\\n'))`;
  }
  if (tool === "read") {
    return `const fs=require('fs');const p=JSON.parse(${target});const s=fs.readFileSync(p,'utf8');const L=s.split('\\n');const out=L.slice(0,${limit}).join('\\n');process.stdout.write(out+(L.length>${limit}?'\\n…[truncated]':''))`;
  }
  // grep/find: line-oriented scan without spawning project code.
  return `const fs=require('fs'),path=require('path');const re=new RegExp(JSON.parse(${pattern}));const root=JSON.parse(${target})||'.';const out=[];const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){if(e.name==='.git'||e.name==='node_modules')continue;walk(p)}else{const s=fs.readFileSync(p,'utf8').split('\\n');s.forEach((l,i)=>{if(re.test(l)&&out.length<${limit})out.push(p+':'+(i+1)+':'+l.slice(0,300))})}}};walk(root);console.log(out.join('\\n'))`;
}

function writeScript(args: Record<string, unknown>): string {
  const path = JSON.stringify(args["path"] ?? "");
  const content = JSON.stringify(typeof args["content"] === "string" ? args["content"] : "");
  return `const fs=require('fs'),path=require('path');const p=JSON.parse(${path});if(!p){console.error('path required');process.exit(1)}fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.parse(${content}));console.log('wrote '+p)`;
}

function editScript(args: Record<string, unknown>): string {
  const path = JSON.stringify(args["path"] ?? "");
  const old = JSON.stringify(typeof args["old"] === "string" ? args["old"] : "");
  const text = JSON.stringify(typeof args["new"] === "string" ? args["new"] : "");
  return `const fs=require('fs');const p=JSON.parse(${path});const s=fs.readFileSync(p,'utf8');const o=JSON.parse(${old});const i=s.indexOf(o);if(i<0){console.error('old text not found');process.exit(1)}fs.writeFileSync(p,s.slice(0,i)+JSON.parse(${text})+s.slice(i+o.length));console.log('edited '+p)`;
}
