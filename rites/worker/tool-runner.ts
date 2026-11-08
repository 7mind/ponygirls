// The sandboxed tool-runner: executes exactly one built-in Pi tool inside
// the bubblewrap sandbox against /workspace. Receives only the tool name
// (argv) and the validated tool parameters (stdin); never any host SDK
// context, model runtime, credentials or configuration. Emits exactly one
// JSON AgentToolResult line on stdout and exits.

import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { writeSync } from "node:fs";
import process from "node:process";
import { format } from "node:util";
import { readAllBounded } from "./stdio.js";
import { SANDBOX_WORKSPACE } from "./sandbox.js";

const EXIT_OK = 0;
const EXIT_CRASH = 70;

export const MAX_TOOL_PARAMS_BYTES = 8 * 1024 * 1024;
export const MAX_TOOL_RESULT_BYTES = 16 * 1024 * 1024;

const TOOL_CALL_ID = "rites-tool-runner";

function redirectConsole(): void {
  const write = (parts: unknown[]): void => {
    process.stderr.write(`${parts.map(part => format(part)).join(" ")}\n`);
  };
  const consoleShim = {
    log: (...parts: unknown[]) => write(parts),
    info: (...parts: unknown[]) => write(parts),
    debug: (...parts: unknown[]) => write(parts),
    warn: (...parts: unknown[]) => write(parts),
    error: (...parts: unknown[]) => write(parts),
  };
  Object.assign(globalThis, { console: consoleShim });
}

function emitLine(value: unknown): void {
  const line = Buffer.from(`${JSON.stringify(value)}\n`);
  if (line.byteLength > MAX_TOOL_RESULT_BYTES) {
    const bounded = {
      content: [{ type: "text", text: "tool result exceeded the size bound" }],
      isError: true,
    };
    writeSync(1, Buffer.from(`${JSON.stringify(bounded)}\n`));
    return;
  }
  writeSync(1, line);
}

function main(): void {
  redirectConsole();
  const argv = process.argv.slice(2);
  if (argv.length !== 2) {
    process.stderr.write("tool-runner: usage: main.js TOOL_NAME REMAINING_MS\n");
    process.exit(EXIT_CRASH);
  }
  const toolName = argv[0];
  const remainingMsRaw = Number.parseInt(argv[1], 10);
  if (!Number.isInteger(remainingMsRaw) || remainingMsRaw <= 0) {
    process.stderr.write("tool-runner: invalid remaining budget\n");
    process.exit(EXIT_CRASH);
  }
  let params: unknown;
  try {
    const bytes = readAllBounded(0, MAX_TOOL_PARAMS_BYTES);
    params = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    emitLine({ content: [{ type: "text", text: "tool parameters were not a bounded JSON object" }], isError: true });
    process.exit(EXIT_OK);
  }
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    emitLine({ content: [{ type: "text", text: "tool parameters were not a JSON object" }], isError: true });
    process.exit(EXIT_OK);
  }
  const tool = createTool(toolName);
  if (tool === undefined) {
    emitLine({ content: [{ type: "text", text: `unknown tool ${toolName}` }], isError: true });
    process.exit(EXIT_OK);
  }
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), remainingMsRaw);
  process.on("uncaughtException", error => {
    process.stderr.write(`tool-runner: uncaught ${error.name}\n`);
    process.exit(EXIT_CRASH);
  });
  process.on("unhandledRejection", reason => {
    const name = reason instanceof Error ? reason.name : typeof reason;
    process.stderr.write(`tool-runner: unhandled rejection ${name}\n`);
    process.exit(EXIT_CRASH);
  });
  void tool
    .execute(TOOL_CALL_ID, params as never, budget.signal)
    .then(result => {
      clearTimeout(timer);
      emitLine(result);
      process.exit(EXIT_OK);
    })
    .catch((error: unknown) => {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : "tool execution failed";
      emitLine({ content: [{ type: "text", text: message }], isError: true });
      process.exit(EXIT_OK);
    });
}

function createTool(toolName: string) {
  switch (toolName) {
    case "read":
      return createReadTool(SANDBOX_WORKSPACE);
    case "bash":
      return createBashTool(SANDBOX_WORKSPACE);
    case "edit":
      return createEditTool(SANDBOX_WORKSPACE);
    case "write":
      return createWriteTool(SANDBOX_WORKSPACE);
    case "grep":
      return createGrepTool(SANDBOX_WORKSPACE);
    case "find":
      return createFindTool(SANDBOX_WORKSPACE);
    case "ls":
      return createLsTool(SANDBOX_WORKSPACE);
    default:
      return undefined;
  }
}

main();
