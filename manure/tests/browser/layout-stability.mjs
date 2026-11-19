// Layout quiescence of the catalogue and the artifact page's file list over the real API (UX-JIT,
// shared/ui-web/tests/layout-quiescence.mjs): with scrollbars that take space, at 100 % and 125 % display scaling, around the
// window height where each view starts to scroll, the scroll geometry settles and stays unchanged.
// Runnable alone: `node layout-stability.mjs < payload.json` (payload from test_browser_layout_stability.py).
// Credentials arrive over stdin and never appear in the output.
import { createRequire } from "node:module";
import path from "node:path";
import { LAYOUT_SCALES, launchWithScrollbars, layoutContext, resizeWindow, assertQuiescentAroundThreshold } from "../../../shared/ui-web/tests/layout-quiescence.mjs";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw);
const { chromium } = createRequire(path.join(input.core, "package.json"))("playwright-core");
const WIDTH = 1440, LOAD_HEIGHT = 900;
const views = [
  ["Catalogue", (page) => page.getByText(`End of list · ${input.records} artifacts`, { exact: true }).waitFor()],
  ["Artifact file list", async (page) => {
    await page.evaluate((target) => { location.hash = "#/artifact/" + target; }, input.files);
    await page.getByRole("table", { name: "Content manifest" }).locator("tbody > tr").nth(input.fileCount - 1).waitFor();
  }],
];
const browsers = await Promise.all(LAYOUT_SCALES.map((scale) => launchWithScrollbars(chromium, scale, { executablePath: input.browser, args: ["--no-sandbox", "--no-proxy-server", `--host-resolver-rules=${input.resolver}`] })));
const results = await Promise.all(LAYOUT_SCALES.flatMap((scale, index) => views.map(async ([view, ready]) => {
  const name = `${view} settles with space-taking scrollbars at ${scale * 100} % around its scroll threshold`;
  const context = await layoutContext(browsers[index], {});
  try {
    const page = await context.newPage(), problems = [];
    page.setDefaultTimeout(15000);
    page.on("pageerror", (error) => problems.push("pageerror: " + error.message));
    await resizeWindow(page, WIDTH, LOAD_HEIGHT);
    await page.goto(input.base + "/", { waitUntil: "domcontentloaded" });
    await page.locator("[data-account-login] input[name=login]").fill(input.login);
    await page.locator("[data-account-login] input[name=password]").fill(input.loginPassword);
    await page.locator("[data-account-login] button[type=submit]").click();
    await page.getByRole("button", { name: input.userId }).waitFor();
    await ready(page);
    await assertQuiescentAroundThreshold(page, `${view} at ${scale * 100} %`, { width: WIDTH, scroller: null });
    if (problems.length > 0) throw new Error(problems.join("; "));
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: error.message.split("\n").slice(0, 12).join(" ") };
  } finally { await context.close(); }
})));
await Promise.all(browsers.map((browser) => browser.close()));
process.stdout.write(JSON.stringify(results));
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
