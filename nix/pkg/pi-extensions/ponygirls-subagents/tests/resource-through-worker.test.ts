import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { WorkerHandle } from "../src/worker-launch.ts";
import { bindChannel } from "../src/protocol.ts";
import { Supervisor } from "../src/supervisor.ts";
import { InMemoryRunStore } from "../src/store.ts";
import { DummyToolExecutor, HostToolExecutor } from "../src/sandbox.ts";
import { DummyWorkspaceManager } from "../src/workspace.ts";
import { defaultSupervisorPolicy } from "../src/policy.ts";

const SDK_ROOT: string | null = process.env["PI_SUBAGENTS_SDK_ROOT"] ?? null;

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(d, name);
      try {
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
      } catch {
        // file
      }
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

type SessionRecord = {
  type?: unknown;
  message?: {
    role?: unknown;
    content?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    isError?: unknown;
  };
};

function loadRecords(sessionsDir: string): SessionRecord[] {
  const out: SessionRecord[] = [];
  for (const f of walkFiles(sessionsDir)) {
    let text = "";
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as SessionRecord);
      } catch {
        // ignore non-JSON line
      }
    }
  }
  return out;
}

test("selected resources read through native host adapter (ordinary none)", async (t: TestContext) => {
  if (!SDK_ROOT) {
    t.skip("needs pinned SDK worker");
    return;
  }
  const sdkRoot = SDK_ROOT as string;
  const dir = mkdtempSync(join(tmpdir(), "subagents-res-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const skillDir = join(dir, "skills", "res-skill");
  mkdirSync(skillDir, { recursive: true });
  const skillMarker = `SKILL-RESOURCE-MARKER-${randomUUID()}`;
  const siblingMarker = `SIBLING-MARKER-${randomUUID()}`;
  const contextMarker = `CONTEXT-RESOURCE-MARKER-${randomUUID()}`;
  const skillPath = join(skillDir, "SKILL.md");
  const siblingPath = join(skillDir, "helper.txt");
  const contextDir = join(dir, "context");
  mkdirSync(contextDir, { recursive: true });
  const contextPath = join(contextDir, "AGENTS.md");
  const skillContent = `# res-skill\n${skillMarker}\n`;
  const siblingContent = `helper\n${siblingMarker}\n`;
  const contextContent = `# context\n${contextMarker}\n`;
  writeFileSync(skillPath, skillContent, "utf8");
  writeFileSync(siblingPath, siblingContent, "utf8");
  writeFileSync(contextPath, contextContent, "utf8");
  const missingPath = join(dir, "missing.txt");

  const governorInstructions = {
    contextFiles: [{ path: contextPath, content: contextContent }],
    skills: [
      {
        name: "res-skill",
        description: "resource test skill",
        filePath: skillPath,
        baseDir: skillDir,
        disableModelInvocation: false,
      },
    ],
  };

  const sup = new Supervisor({
    rootId: "root-res",
    rootDir: join(dir, "root"),
    store: new InMemoryRunStore("root-res"),
    policy: (() => {
      const p = defaultSupervisorPolicy();
      p.allowedModels = [{ provider: "p", id: "m" }];
      return p;
    })(),
    governor: () => ({ model: { provider: "p", id: "m", thinkingLevel: "off" }, cwd: dir, instructions: governorInstructions }),
    schedulerLimits: { maxRunnable: 2, maxResidentWorkers: 4, maxOpenAgents: 8, maxDepth: 1 },
    executors: { sandbox: new DummyToolExecutor(), host: new HostToolExecutor() },
    workspace: new DummyWorkspaceManager(),
    workerFactory: (o) => {
      const binding = bindChannel(o.rootEpoch, o.agentId, o.instanceId);
      const hostAgentDir = join(dir, "host-agent");
      mkdirSync(hostAgentDir, { recursive: true });
      writeFileSync(join(hostAgentDir, "auth.json"), JSON.stringify({}));
      return new WorkerHandle(
        {
          workerPath: new URL("../src/worker.ts", import.meta.url).pathname,
          rootEpoch: o.rootEpoch,
          agentId: o.agentId,
          sdkRoot,
          deterministic: true,
          agentDir: join(dir, "worker-home", o.agentId),
          sessionsDir: join(dir, "sessions"),
          hostAgentDir,
          script: [
            { tool: "read", args: { path: skillPath } },
            { tool: "read", args: { path: siblingPath } },
            { tool: "read", args: { path: contextPath } },
            { tool: "read", args: { path: missingPath } },
            { text: "resource done" },
          ],
        },
        binding,
      );
    },
  });
  t.after(() => sup.shutdown());

  const g = await sup.spawn(
    "governor",
    { taskName: "res", message: "read resources", profile: "reader", isolation: "none", skills: ["res-skill"], contextFiles: [contextPath] },
    `res-${Date.now()}`,
  );
  const start = Date.now();
  let settled = false;
  while (Date.now() - start < 60000) {
    const recs = sup.runStore.readSince(0, 100000).records;
    if (recs.some((r) => r.kind === "task.terminal" && (r.body as Record<string, unknown>)["taskRunId"] === g.taskRunId)) {
      settled = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(settled, "deterministic resource worker never settled");

  const sessionsDir = join(dir, "sessions");
  const files = walkFiles(sessionsDir);
  assert.ok(files.length >= 1, `no worker session files in ${sessionsDir}`);
  const records = loadRecords(sessionsDir);

  const toolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();
  for (const r of records) {
    if (r.type !== "message") continue;
    const msg = r.message;
    if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
    for (const c of msg.content) {
      const rec = c as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown };
      if (rec.type === "toolCall" && typeof rec.id === "string" && typeof rec.name === "string") {
        toolCalls.set(rec.id, { name: rec.name, args: (rec.arguments ?? {}) as Record<string, unknown> });
      }
    }
  }
  const toolResults = records.filter((r) => r.type === "message" && r.message?.role === "toolResult");
  assert.ok(toolResults.length >= 4, `expected 4 native toolResults, got ${toolResults.length}`);

  const byPath = new Map<string, { toolCallId: string; content: string; isError: boolean }>();
  for (const r of toolResults) {
    const msg = r.message;
    const callId = msg?.toolCallId;
    if (typeof callId !== "string") continue;
    const call = toolCalls.get(callId);
    if (!call || call.name !== "read") continue;
    const p = call.args["path"];
    if (typeof p !== "string") continue;
    const content = Array.isArray(msg?.content)
      ? (msg?.content as Array<{ text?: unknown }>)?.map((b) => String(b.text ?? "")).join("\n")
      : String((msg?.content as unknown) ?? "");
    byPath.set(p, { toolCallId: callId, content, isError: msg?.isError === true });
  }

  for (const [path, expected] of [[skillPath, skillContent], [siblingPath, siblingContent], [contextPath, contextContent]] as Array<[string, string]>) {
    const got = byPath.get(path);
    assert.ok(got, `no parsed native toolResult for read ${path}`);
    assert.equal(got.isError, false, `native read ${path} failed: ${got.content.slice(0, 300)}`);
    assert.equal(got.content, expected, `native read ${path} bytes mismatch`);
  }

  const missing = byPath.get(missingPath);
  assert.ok(missing, `no parsed native toolResult for missing ${missingPath}`);
  assert.equal(missing.isError, true, `corrupt/missing read must fail, got success: ${missing.content.slice(0, 200)}`);
});
