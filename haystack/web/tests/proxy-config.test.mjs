// BA/BG, specified: validate evaluated-module inputs, never invent proxy policy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readProxyConfig, validateProxyConfig } from "../tests-browser/proxy-config.mjs";
import { Failure } from "../../generated/typescript/haystack/api/Failure.ts";
import { BaboonCodecContext } from "../../generated/typescript/BaboonSharedRuntime.ts";
const location = (proxyPass = null) => ({ proxyPass, proxyWebsockets: true, tryFiles: null, extraConfig: "" });
const config = (root = null) => ({ backendPort: 15433, publicUrl: "https://127.0.0.1:15434", root,
  locations: { "/api/": location("http://127.0.0.1:15433/api/"), "/mcp": location("http://127.0.0.1:15433/mcp"), "/": location() } });

test("evaluated proxy JSON preserves declared ports and its actual asset root without local dist substitution", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-proxy-config-"));
  try {
    const root = path.join(dir, "actual-package-assets"); await mkdir(root); await writeFile(path.join(root, "index.html"), "actual package assets");
    const file = path.join(dir, "evaluated.json"); await writeFile(file, JSON.stringify(config(root)));
    const result = await readProxyConfig(file);
    assert.equal(result.backendPort, 15433); assert.equal(result.publicUrl, "https://127.0.0.1:15434");
    assert.equal(result.root, root); assert.deepEqual(result.locations, config().locations);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("every evaluated proxy target must match the declared loopback backend and exact input contract", async () => {
  const changed = (over) => ({ ...config(), ...over });
  for (const value of [changed({ backendPort: 0 }), changed({ backendPort: 1.5 }), changed({ backendPort: "15433" }),
    changed({ publicUrl: "http://127.0.0.1:15434" }), changed({ publicUrl: "https://remote.invalid:15434" }),
    changed({ publicUrl: "https://op:secret@127.0.0.1:15434" }), changed({ publicUrl: "https://127.0.0.1:15434/path" }),
    changed({ publicUrl: "https://127.0.0.1:15433" }), changed({ locations: {} }), changed({ root: "relative" }),
    changed({ extra: true }), changed({ locations: { "/api/": location("http://127.0.0.1:15433/api/"), "/mcp": location("http://127.0.0.1:9999/mcp") } }),
    changed({ locations: { "/api/": location("http://remote.invalid:15433/api/") } }),
    changed({ locations: { "/api/": location("http://admin:secret@127.0.0.1:15433/api/") } }),
    changed({ locations: { "/api/": location("http://127.0.0.1:15433/api/?x=1") } }),
    changed({ locations: { "/api/": { ...location("http://127.0.0.1:15433/api/"), proxyWebsockets: "yes" } } }),
  ]) await assert.rejects(validateProxyConfig(value));
});

test("configured proxy input fails on malformed duplicate invalid UTF8 or missing files without a fallback", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-proxy-invalid-"));
  try {
    const file = path.join(dir, "evaluated.json");
    for (const body of ["{", "null", "[]", '{"backendPort":15433,"backendPort":15433}', Buffer.from([0xff])]) {
      await writeFile(file, body); await assert.rejects(readProxyConfig(file));
    }
    await assert.rejects(readProxyConfig("relative.json")); await assert.rejects(readProxyConfig(path.join(dir, "missing.json")));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("proxy unavailability decodes only the direct current generated Failure and rejects retired nested errors", () => {
  const context = BaboonCodecContext.Default;
  assert.equal(Failure.jsonCodec().decode(context, { code: "unavailable", message: "service unavailable", spans: [], currentRevision: null }).code, "unavailable");
  assert.throws(() => Failure.jsonCodec().decode(context, { error: { code: "unavailable", message: "service unavailable" } }));
});
