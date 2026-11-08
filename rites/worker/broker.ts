// The tool broker. The Pi SDK session runs in the trusted host worker with
// the model credential in memory only; every tool call the model makes is
// executed by a fresh bubblewrap tool-runner process against the workspace,
// with no model config, host HOME, service state, other repositories or
// ambient credentials reachable. Tool metadata (name/description/parameter
// schema) is cloned from the pinned SDK's built-in tools under rites_-prefixed
// names, so the model sees the exact built-in schemas and the tool-runner
// executes the exact built-in implementations. All brokered tools are
// sequential: the SDK's normal edit/write serialization is preserved across
// the per-call isolated processes.

import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { KILL_GRACE_MS } from "./bounds.js";
import { TreeKiller } from "./kill.js";
import type { RunEnvironment } from "./run-env.js";
import { toolRunnerArgs } from "./sandbox.js";

const BUILTIN_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
export type BuiltinToolName = (typeof BUILTIN_TOOLS)[number];

const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

export function brokeredToolNames(): string[] {
  return BUILTIN_TOOLS.map(name => `rites_${name}`);
}

interface RunnerHandle {
  readonly killer: TreeKiller<ChildProcessWithoutNullStreams>;
}

export interface BrokerOptions {
  readonly environment: RunEnvironment;
  readonly workspace: string;
  /** Absolute deadline (Date.now()-based) for the whole run. */
  readonly deadlineAt: number;
  /** Run cancellation; kills every active tool-runner tree immediately. */
  readonly cancel: AbortSignal;
}

export class ToolBroker {
  private readonly active = new Set<RunnerHandle>();
  private infraFailure = false;

  constructor(private readonly options: BrokerOptions) {
    this.options.cancel.addEventListener("abort", () => this.cancelAll(), { once: true });
  }

  /** True when a tool-runner sandbox failed at the infrastructure level. */
  hadInfrastructureFailure(): boolean {
    return this.infraFailure;
  }

  definitions(): ToolDefinition[] {
    return BUILTIN_TOOLS.map(name => this.definition(name));
  }

  private definition(builtin: BuiltinToolName): ToolDefinition {
    const metadata: AgentTool = createTool(builtin);
    const definition: ToolDefinition = {
      name: `rites_${builtin}`,
      label: metadata.label,
      description: metadata.description,
      parameters: metadata.parameters,
      promptSnippet: textProperty(metadata, "promptSnippet"),
      promptGuidelines: stringListProperty(metadata, "promptGuidelines"),
      outputSchema: metadata.outputSchema,
      prepareArguments: metadata.prepareArguments,
      executionMode: "sequential",
      execute: (toolCallId, params, signal) => this.execute(builtin, params),
    };
    return definition;
  }

  private async execute(builtin: BuiltinToolName, params: unknown): Promise<AgentToolResult<unknown>> {
    if (this.options.cancel.aborted) {
      return errorResult("run cancelled before tool execution");
    }
    const remainingMs = this.options.deadlineAt - Date.now();
    if (remainingMs <= 0) {
      this.infraFailure = true;
      return errorResult("run budget exhausted");
    }
    const child = spawn(
      this.options.environment.bwrap,
      toolRunnerArgs(
        {
          bwrap: this.options.environment.bwrap,
          node: this.options.environment.node,
          nixStore: this.options.environment.nixStore,
          workspace: this.options.workspace,
          workerRuntimeDir: this.options.environment.workerRuntimeDir,
          toolchainPath: this.options.environment.toolchainPath,
          resolvConf: this.options.environment.resolvConf,
          hosts: this.options.environment.hosts,
          nsswitchConf: this.options.environment.nsswitchConf,
          caBundle: this.options.environment.caBundle,
        },
        builtin,
        remainingMs,
      ),
      { stdio: ["pipe", "pipe", "pipe"] },
    ) as ChildProcessWithoutNullStreams;
    const handle: RunnerHandle = { killer: new TreeKiller(child) };
    this.active.add(handle);
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let overflow = false;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_RESULT_BYTES) {
        overflow = true;
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += Math.min(chunk.byteLength, MAX_STDERR_BYTES - stderrBytes);
    });
    child.stdin.on("error", () => {
      // The sandbox died before consuming the parameters.
    });
    child.stdin.write(Buffer.from(JSON.stringify(params)));
    child.stdin.end();

    const callCap = setTimeout(() => {
      handle.killer.fire();
    }, remainingMs + KILL_GRACE_MS + 2_000);
    const closed = new Promise<number | null>(resolve => {
      child.on("close", code => {
        resolve(code);
      });
      child.on("error", () => {
        resolve(null);
      });
    });
    let exitCode: number | null;
    try {
      exitCode = await closed;
    } finally {
      clearTimeout(callCap);
      handle.killer.dispose();
      this.active.delete(handle);
    }
    if (this.options.cancel.aborted) {
      return errorResult("tool sandbox cancelled with the run");
    }
    if (exitCode === null || exitCode !== 0 || overflow) {
      this.infraFailure = true;
      return errorResult("tool sandbox failed");
    }
    const bytes = Buffer.concat(stdout);
    const text = bytes.byteLength === 0 || bytes[bytes.byteLength - 1] === 0x0a
      ? bytes.toString("utf8")
      : `${bytes.toString("utf8")}\n`;
    const lines = text.split("\n");
    if (lines.length !== 2 || lines[1] !== "") {
      this.infraFailure = true;
      return errorResult("tool sandbox produced an unexpected output shape");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[0]);
    } catch {
      this.infraFailure = true;
      return errorResult("tool sandbox produced an invalid result");
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      this.infraFailure = true;
      return errorResult("tool sandbox produced an invalid result");
    }
    const candidate = parsed as Record<string, unknown>;
    if (!Array.isArray(candidate.content)) {
      this.infraFailure = true;
      return errorResult("tool sandbox produced an invalid result");
    }
    return parsed as AgentToolResult<unknown>;
  }

  cancelAll(): void {
    for (const handle of [...this.active]) {
      void handle.killer.fire();
    }
  }
}

function errorResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: undefined, isError: true };
}

/** Read a runtime-added optional string property without widening types. */
function textProperty(source: object, name: string): string | undefined {
  if (name in source) {
    const value = (source as Record<string, unknown>)[name];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

/** Read a runtime-added optional string-list property without widening types. */
function stringListProperty(source: object, name: string): string[] | undefined {
  if (name in source) {
    const value = (source as Record<string, unknown>)[name];
    if (Array.isArray(value) && value.every(entry => typeof entry === "string")) {
      return value as string[];
    }
  }
  return undefined;
}

function createTool(builtin: BuiltinToolName): AgentTool {
  switch (builtin) {
    case "read":
      return createReadTool("/workspace");
    case "bash":
      return createBashTool("/workspace");
    case "edit":
      return createEditTool("/workspace");
    case "write":
      return createWriteTool("/workspace");
    case "grep":
      return createGrepTool("/workspace");
    case "find":
      return createFindTool("/workspace");
    case "ls":
      return createLsTool("/workspace");
  }
}
