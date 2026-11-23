import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROJECT_CONTEXT_FILE_NAMES, resolveReadPath, resolveToCwd,
  type ExtensionAPI, type ExtensionContext, type ToolExecutionEndEvent, type ToolExecutionStartEvent, type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { directoryIdentity, type AccessDirectory, type ContextFile } from "../context-rules/rules.ts";

export const SNAPSHOTS = "archeologist.nested";
const LIMIT = 128 * 1024;
const READER = fileURLToPath(new URL("../context-rules/instruction-reader.cjs", import.meta.url));
const PATH_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);

export function nestedFiles(ctx: ExtensionContext, base: readonly ContextFile[]): ContextFile[] {
  const seen = new Set(base.map(f => f.path));
  const result: ContextFile[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== SNAPSHOTS) continue;
    const data = entry.data as { sessionId: string; cwd: string; files: ContextFile[] };
    if (data.sessionId !== ctx.sessionManager.getSessionId() || data.cwd !== ctx.cwd) continue;
    for (const file of data.files) {
      if (!seen.has(file.path)) { result.push(file); seen.add(file.path); }
    }
  }
  return result;
}

function readNested(cwd: string, access: AccessDirectory, known: Set<string>, signal: AbortSignal): Promise<ContextFile[]> {
  return new Promise((accept, reject) => {
    const workdir = realpathSync.native(cwd);
    const child = execFile(process.execPath, [READER], { cwd: workdir, env: {}, timeout: 5000, signal, maxBuffer: 8 * LIMIT }, (error, stdout) => {
      if (error) { reject(error); return; }
      try { accept(JSON.parse(stdout)); } catch (cause) { reject(cause); }
    });
    child.stdin!.on("error", reject);
    child.stdin!.end(JSON.stringify({ workdir, access, known: [...known], ruleNames: PROJECT_CONTEXT_FILE_NAMES, names: [], root: null, limit: LIMIT }));
  });
}

interface Call { name: string; parent: string | undefined; directory?: AccessDirectory; completed?: boolean }
export class MainTurn {
  readonly abort = new AbortController();
  private readonly calls = new Map<string, Call>();

  start(event: ToolExecutionStartEvent, pi: ExtensionAPI): void {
    const { toolName: name, parentToolCallId: parent } = event;
    if (parent !== undefined && this.calls.get(parent)?.name !== "codemode") return;
    if (!PATH_TOOLS.has(name) && name !== "codemode") return;
    const info = pi.getAllTools().find(t => t.name === name)?.sourceInfo;
    if (info?.path === `builtin:${name}` && info.source === "builtin") this.calls.set(event.toolCallId, { name, parent });
  }

  stage(event: ToolResultEvent, ctx: ExtensionContext): void {
    const call = this.calls.get(event.toolCallId);
    if (!call || call.completed || event.isError || ctx.signal?.aborted || !PATH_TOOLS.has(call.name) || event.toolName !== call.name || event.parentToolCallId !== call.parent) return;
    const path = event.input.path ?? (["grep", "find", "ls"].includes(call.name) ? "." : undefined);
    if (typeof path !== "string") return;
    try {
      const real = realpathSync.native((call.name === "read" ? resolveReadPath : resolveToCwd)(path, ctx.cwd));
      call.directory = directoryIdentity(statSync(real).isDirectory() ? real : dirname(real));
    }
    catch { return; }
  }

  finish(event: ToolExecutionEndEvent): void {
    const call = this.calls.get(event.toolCallId);
    if (call?.directory && !event.isError && call.name === event.toolName && call.parent === event.parentToolCallId) call.completed = true;
    else this.calls.delete(event.toolCallId);
  }

  async flush(ctx: ExtensionContext, known: Set<string>): Promise<ContextFile[]> {
    const added: ContextFile[] = [];
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, this.abort.signal]) : this.abort.signal;
    const targets = new Map([...this.calls.values()].flatMap(c => c.directory && c.completed ? [[JSON.stringify(c.directory), c.directory] as const] : []));
    for (const access of targets.values()) {
      if (signal.aborted) break;
      try {
        for (const file of await readNested(ctx.cwd, access, known, signal)) {
          known.add(file.path);
          added.push(file);
        }
      } catch { continue; }
    }
    return signal.aborted ? [] : added;
  }
}
