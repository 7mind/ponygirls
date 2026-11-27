import assert from "node:assert/strict";
import test from "node:test";
import { compareOrigins, originOf, sameOrigin, type ToolOrigin } from "../src/origin.ts";
import type { ToolNamespace, ToolProvenance } from "../src/registry.ts";
import { BUILTIN, extensionFile } from "./fixtures.ts";

function origin(provenance: ToolProvenance, namespace: ToolNamespace | null): ToolOrigin {
  return originOf({ provenance, namespace });
}

const STORE = "/nix/store/axgql0iv685gjgv122bfrk7kni9vgw6q";

test("tools pi ships are built-in, core tools and built-in extensions alike", () => {
  assert.deepEqual(origin(BUILTIN, null), { kind: "built-in", label: "built-in" });
  assert.deepEqual(origin({ ...BUILTIN, path: "builtin:tool-search" }, null), { kind: "built-in", label: "built-in" });
  assert.deepEqual(origin({ ...BUILTIN, path: "builtin:mcp" }, null), { kind: "built-in", label: "built-in" });
});

test("an MCP tool is named after its server, not after the MCP support that registered it", () => {
  const namespace = { name: "mcp__dev-radius", description: null };
  assert.deepEqual(origin({ ...BUILTIN, path: "builtin:mcp" }, namespace), { kind: "mcp", label: "mcp · dev-radius" });
  assert.deepEqual(origin(extensionFile("/home/u/.pi/agent/extensions/pi-mcp-adapter/index.ts"), namespace), { kind: "mcp", label: "mcp · dev-radius" });
});

test("a namespace that is not an MCP server leaves the tool with its extension", () => {
  assert.deepEqual(origin(extensionFile("/x/issues.ts"), { name: "issues", description: "Issue tracker" }), { kind: "extension", label: "issues" });
});

test("an extension is named after its file, or its directory when the file is index", () => {
  assert.equal(origin(extensionFile("/home/u/.pi/agent/extensions/quick.ts"), null).label, "quick");
  assert.equal(origin(extensionFile("/home/u/.pi/agent/extensions/quick.mjs"), null).label, "quick");
  assert.equal(origin(extensionFile(`${STORE}-ponygirls-pi-extensions/ponygirls-bg-tasks/index.ts`), null).label, "ponygirls-bg-tasks");
  assert.equal(origin(extensionFile(`${STORE}-single-file.ts`), null).label, "single-file");
  assert.equal(origin(extensionFile(`${STORE}-whole-dir/index.ts`), null).label, "whole-dir");
  assert.equal(origin(extensionFile("index.ts"), null).label, "index");
});

test("a package is named after its source", () => {
  const packaged = (source: string): ToolProvenance => ({ path: `${source}/extensions/hub.ts`, source, scope: "user", origin: "package", baseDir: source });
  assert.deepEqual(origin(packaged(`${STORE}-pi-search-hub-2.8.0`), null), { kind: "package", label: "pi-search-hub-2.8.0" });
  assert.equal(origin(packaged("/opt/packages/hub"), null).label, "hub");
  assert.equal(origin(packaged("npm:@scope/hub@1.0.0"), null).label, "npm:@scope/hub@1.0.0");
  assert.equal(origin(packaged("git:github.com/user/hub@v1"), null).label, "git:github.com/user/hub@v1");
});

test("tools passed through the SDK are their own source", () => {
  assert.deepEqual(origin({ path: "<sdk:probe>", source: "sdk", scope: "temporary", origin: "top-level", baseDir: null }, null), { kind: "sdk", label: "sdk" });
});

test("sources order by kind, then by label", () => {
  const origins: ToolOrigin[] = [
    { kind: "mcp", label: "mcp · b" },
    { kind: "package", label: "a-package" },
    { kind: "extension", label: "z-extension" },
    { kind: "mcp", label: "mcp · a" },
    { kind: "sdk", label: "sdk" },
    { kind: "built-in", label: "built-in" },
    { kind: "extension", label: "a-extension" },
  ];
  assert.deepEqual([...origins].sort(compareOrigins).map((entry) => entry.label),
    ["built-in", "sdk", "a-extension", "z-extension", "a-package", "mcp · a", "mcp · b"]);
});

test("two origins are the same source when kind and label agree", () => {
  assert.equal(sameOrigin({ kind: "extension", label: "hub" }, { kind: "extension", label: "hub" }), true);
  assert.equal(sameOrigin({ kind: "extension", label: "hub" }, { kind: "package", label: "hub" }), false);
});
