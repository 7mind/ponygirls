import assert from "node:assert/strict";
import test from "node:test";
import { compareOrigins, originLabel, originOf, sameOrigin, type ToolOrigin } from "../src/origin.ts";
import type { ToolNamespace, ToolProvenance } from "../src/registry.ts";
import { BUILTIN, extensionFile } from "./fixtures.ts";

function origin(provenance: ToolProvenance, namespace: ToolNamespace | null): ToolOrigin {
  return originOf({ provenance, namespace });
}

const STORE = "/nix/store/axgql0iv685gjgv122bfrk7kni9vgw6q";

test("tools pi ships are built-in, core tools and built-in extensions alike", () => {
  assert.deepEqual(origin(BUILTIN, null), { kind: "built-in", name: "built-in" });
  assert.deepEqual(origin({ ...BUILTIN, path: "builtin:tool-search" }, null), { kind: "built-in", name: "built-in" });
  assert.deepEqual(origin({ ...BUILTIN, path: "builtin:mcp" }, null), { kind: "built-in", name: "built-in" });
});

test("an MCP tool is named after its server, not after the MCP support that registered it", () => {
  const namespace = { name: "mcp__dev-radius", description: null };
  assert.deepEqual(origin({ ...BUILTIN, path: "builtin:mcp" }, namespace), { kind: "mcp", name: "dev-radius" });
  assert.deepEqual(origin(extensionFile("/home/u/.pi/agent/extensions/pi-mcp-adapter/index.ts"), namespace), { kind: "mcp", name: "dev-radius" });
});

test("a namespace that is not an MCP server leaves the tool with its extension", () => {
  assert.deepEqual(origin(extensionFile("/x/issues.ts"), { name: "issues", description: "Issue tracker" }), { kind: "extension", name: "issues" });
});

test("an extension is named after its file, or its directory when the file is index", () => {
  const named = (path: string): string => origin(extensionFile(path), null).name;
  assert.equal(named("/home/u/.pi/agent/extensions/quick.ts"), "quick");
  assert.equal(named("/home/u/.pi/agent/extensions/quick.mjs"), "quick");
  assert.equal(named(`${STORE}-ponygirls-pi-extensions/ponygirls-bg-tasks/index.ts`), "ponygirls-bg-tasks");
  assert.equal(named(`${STORE}-single-file.ts`), "single-file");
  assert.equal(named(`${STORE}-whole-dir/index.ts`), "whole-dir");
  assert.equal(named("index.ts"), "index");
});

test("a package is named after its source", () => {
  const packaged = (source: string): ToolOrigin => origin({ path: `${source}/extensions/hub.ts`, source, scope: "user", origin: "package", baseDir: source }, null);
  assert.deepEqual(packaged(`${STORE}-pi-search-hub-2.8.0`), { kind: "package", name: "pi-search-hub-2.8.0" });
  assert.equal(packaged("/opt/packages/hub").name, "hub");
  assert.equal(packaged("npm:@scope/hub@1.0.0").name, "npm:@scope/hub@1.0.0");
  assert.equal(packaged("git:github.com/user/hub@v1").name, "git:github.com/user/hub@v1");
});

test("tools passed through the SDK are their own source", () => {
  assert.deepEqual(origin({ path: "<sdk:probe>", source: "sdk", scope: "temporary", origin: "top-level", baseDir: null }, null), { kind: "sdk", name: "sdk" });
});

test("a source is headed by its name, an MCP server marked as one", () => {
  assert.equal(originLabel({ kind: "mcp", name: "linear" }), "mcp · linear");
  assert.equal(originLabel({ kind: "extension", name: "ponygirls-bg-tasks" }), "ponygirls-bg-tasks");
  assert.equal(originLabel({ kind: "built-in", name: "built-in" }), "built-in");
});

test("sources order by kind, then by name", () => {
  const origins: ToolOrigin[] = [
    { kind: "mcp", name: "b" },
    { kind: "package", name: "a-package" },
    { kind: "extension", name: "z-extension" },
    { kind: "mcp", name: "a" },
    { kind: "sdk", name: "sdk" },
    { kind: "built-in", name: "built-in" },
    { kind: "extension", name: "a-extension" },
  ];
  assert.deepEqual([...origins].sort(compareOrigins).map(originLabel),
    ["built-in", "sdk", "a-extension", "z-extension", "a-package", "mcp · a", "mcp · b"]);
});

test("two origins are the same source when kind and name agree", () => {
  assert.equal(sameOrigin({ kind: "extension", name: "hub" }, { kind: "extension", name: "hub" }), true);
  assert.equal(sameOrigin({ kind: "extension", name: "hub" }, { kind: "package", name: "hub" }), false);
  assert.equal(sameOrigin({ kind: "mcp", name: "a" }, { kind: "mcp", name: "b" }), false);
});
