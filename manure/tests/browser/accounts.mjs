// The shared accounts flow (shared/account-web/tests/e2e/flow.mjs) against the real Manure dashboard and server.
// Runnable alone: `node accounts.mjs < payload.json` (payload from test_browser_accounts.py); credentials arrive over
// stdin and never appear in the output. The result is one JSON line on stdout; the failure report (secrets redacted)
// goes to stderr.
import { createRequire } from "node:module";
import path from "node:path";
import { runAccountFlow } from "../../../shared/account-web/tests/e2e/flow.mjs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const { chromium } = createRequire(path.join(input.core, "package.json"))("playwright-core");
try {
  const result = await runAccountFlow({
    baseUrl: input.base, service: "manure", admin: { login: input.login, password: input.password },
    browserType: chromium, launchOptions: { executablePath: input.browser, args: ["--no-sandbox", "--no-proxy-server", `--host-resolver-rules=${input.resolver}`] },
    evidenceDir: input.evidence,
  });
  process.stdout.write(JSON.stringify({ ok: true, durationMs: result.durationMs, waits: result.waits }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false }));
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
