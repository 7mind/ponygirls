// Broker tool metadata parity: the brokered rites_* tools must expose the
// exact metadata of the pinned SDK's built-in tools (label, description,
// parameter schema, output schema, argument shim, prompt snippet/guidelines
// and constrained sampling). The model's tool experience must not change
// because the tools are brokered.

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolBroker } from "../../target/worker/worker/broker.js";
import { loadRunEnvironment } from "../../target/worker/worker/run-env.js";
import { ensureRunEnvironment, RITES_DIR } from "./helpers.mjs";

ensureRunEnvironment();

const BUILTINS = [
  { name: "read", factory: "createReadTool" },
  { name: "bash", factory: "createBashTool" },
  { name: "edit", factory: "createEditTool" },
  { name: "write", factory: "createWriteTool" },
  { name: "grep", factory: "createGrepTool" },
  { name: "find", factory: "createFindTool" },
  { name: "ls", factory: "createLsTool" },
];

const sdk = await import("@earendil-works/pi-coding-agent");

function builtinTool(name) {
  return sdk[name]("/workspace");
}

const environment = loadRunEnvironment(process.env);
const workspace = mkdtempSync(join(tmpdir(), "rites-parity-"));
const broker = new ToolBroker({
  environment,
  workspace,
  deadlineAt: Date.now() + 60_000,
  cancel: new AbortController().signal,
});
const definitions = new Map(broker.definitions().map(tool => [tool.name, tool]));

for (const { name, factory } of BUILTINS) {
  test(`brokered ${name} clones the builtin metadata exactly`, () => {
    const builtin = builtinTool(factory);
    const brokered = definitions.get(`rites_${name}`);
    assert.notEqual(brokered, undefined, `rites_${name} must be registered`);
    assert.equal(brokered.label, builtin.label);
    assert.equal(brokered.description, builtin.description);
    assert.deepEqual(brokered.parameters, builtin.parameters);
    assert.deepEqual(brokered.outputSchema, builtin.outputSchema);
    assert.deepEqual(brokered.prepareArguments, builtin.prepareArguments);
    assert.deepEqual(brokered.constrainedSampling, builtin.constrainedSampling, "constrainedSampling must be cloned");
  });
}

test("all seven brokered tools are sequential", () => {
  for (const tool of broker.definitions()) {
    assert.equal(tool.executionMode, "sequential", `${tool.name} must execute sequentially`);
  }
});

test("no unbrokered tool name is registered", () => {
  const names = [...definitions.keys()].sort();
  assert.deepEqual(names, [
    "rites_bash",
    "rites_edit",
    "rites_find",
    "rites_grep",
    "rites_ls",
    "rites_read",
    "rites_write",
  ]);
});

void RITES_DIR;
