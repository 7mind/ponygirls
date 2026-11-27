import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CORPUS_VARIABLE, calibrationDeclarations, parseCorpus } from "../src/calibration.ts";
import { requestedTools, startPiSession } from "./pi-session.ts";

const ROOT = join(import.meta.dirname, "..");
const CORPUS_PATH = join(ROOT, "calibration", "corpus.json");

test("the probe declares the whole sample in a real pi session, as the sample has it", { timeout: 30_000 }, async (t) => {
  process.env[CORPUS_VARIABLE] = CORPUS_PATH;
  t.after(() => { delete process.env[CORPUS_VARIABLE]; });
  const { session, request, requests, errors } = await startPiSession(t, {
    extension: () => {}, extensionPaths: [join(ROOT, "calibration", "probe.ts")], systemPrompt: null, toolAllowlist: null, ui: { mode: "print" },
  });
  const expected = calibrationDeclarations(parseCorpus(readFileSync(CORPUS_PATH, "utf8")));
  const registered = new Map(session.getAllTools().map((tool) => [tool.name, tool]));
  for (const declaration of expected) {
    const tool = registered.get(declaration.name);
    assert.ok(tool, `${declaration.name} is registered`);
    assert.equal(tool.description, declaration.description);
    assert.deepEqual(JSON.parse(JSON.stringify(tool.parameters)), declaration.parameters);
  }
  await request();
  const declared = new Set(requestedTools(requests[0]!));
  assert.deepEqual(expected.filter((declaration) => !declared.has(declaration.name)).map((declaration) => declaration.name), [], "every sample tool is in the request");
  assert.deepEqual(errors, []);
});
