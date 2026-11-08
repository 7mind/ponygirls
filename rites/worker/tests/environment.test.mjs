import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Development overrides are independent, just as in run-worker.sh. One
// provided binary is not proof that the complete run environment exists.
test("development fixture completes a partial explicit run environment", () => {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("RITES_")) delete environment[name];
  }
  environment.RITES_NODE = process.execPath;
  const helpers = new URL("./helpers.mjs", import.meta.url).href;
  const runEnvironment = new URL("../../target/worker/worker/run-env.js", import.meta.url).href;
  const script = `
    import { realpathSync } from 'node:fs';
    import { ensureRunEnvironment } from ${JSON.stringify(helpers)};
    import { loadRunEnvironment } from ${JSON.stringify(runEnvironment)};
    ensureRunEnvironment();
    const configured = loadRunEnvironment(process.env);
    if (configured.node !== realpathSync(process.execPath)) throw new Error('explicit Node override was lost');
    process.stdout.write('fixture-ready');
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    env: environment,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "fixture-ready");
});
