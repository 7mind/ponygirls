// Behavioral-Active-Effectual-GoodCommunication: controlled process stubs prove
// launcher ownership decisions, not PostgreSQL or backend acceptance.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const MAX_PORT_ATTEMPTS = 16;
const haystack = fileURLToPath(new URL("../../", import.meta.url));
async function availablePort() {
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    if (port > 65435) continue;
    const database = net.createServer();
    try {
      await new Promise((resolve, reject) => { database.once("error", reject); database.listen(port + 100, "127.0.0.1", resolve); });
      await new Promise(resolve => database.close(resolve));
      return port;
    } catch (error) { if (error.code !== "EADDRINUSE") throw error; }
  }
  throw new Error("No owned fixture port pair available");
}

test("preview startup failure never authorizes stopping an unowned PostgreSQL process", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "haystack-preview-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = path.join(root, "haystack");
  const tools = path.join(root, "bin");
  const temporary = path.join(root, "tmp");
  for (const directory of [tools, temporary, "haystack/web/src", "haystack/web/dist", "haystack/web/tests-browser", "haystack/generated/typescript", "shared/account-web"].map(value => path.isAbsolute(value) ? value : path.join(root, value))) await mkdir(directory, { recursive: true });
  await copyFile(path.join(haystack, "quick-ui.sh"), path.join(fixture, "quick-ui.sh"));
  for (const file of ["preview-state.mjs", "credentials.mjs"]) await copyFile(path.join(haystack, "web/tests-browser", file), path.join(fixture, "web/tests-browser", file));
  for (const file of ["web/index.html", "web/vite.config.ts", "web/package.json", "package-lock.json"]) {
    await writeFile(path.join(fixture, file), ""); await utimes(path.join(fixture, file), 1, 1);
  }
  await writeFile(path.join(fixture, "web/dist/index.html"), "fixture shell");
  const stopMarker = path.join(root, "stop-called");
  const startMarker = path.join(root, "start-refused");
  const stubs = {
    initdb: '#!/usr/bin/env bash\nmkdir -p "$PGDATA"\nprintf 16 > "$PGDATA/PG_VERSION"\n',
    pg_ctl: '#!/usr/bin/env bash\ncase " $* " in *" status "*) exit 3;; *" start "*) printf refused > "$PREVIEW_START_MARKER"; exit 1;; *" stop "*) printf called > "$PREVIEW_STOP_MARKER"; exit 0;; *) exit 99;; esac\n',
    psql: "#!/usr/bin/env bash\nexit 99\n",
    curl: "#!/usr/bin/env bash\nexit 99\n",
  };
  for (const [name, content] of Object.entries(stubs)) await writeFile(path.join(tools, name), content, { mode: 0o700 });
  const port = await availablePort();
  await assert.rejects(execute("bash", [path.join(fixture, "quick-ui.sh"), String(port), "127.0.0.1"], {
    env: { ...process.env, PATH: `${tools}:${process.env.PATH}`, TMPDIR: temporary, HAYSTACK_SERVER_COMMAND: "false", PREVIEW_START_MARKER: startMarker, PREVIEW_STOP_MARKER: stopMarker },
    timeout: 20000,
  }), error => error.code === 1);
  assert.equal(await readFile(startMarker, "utf8"), "refused", "the reproduction must reach the refused PostgreSQL start");
  await assert.rejects(lstat(stopMarker), { code: "ENOENT" }, "failed startup must not grant stop authority");
  assert.ok((await lstat(path.join(root, "debug", "haystack-ui", String(port), "launcher.lock"))).isDirectory(), "unconfirmed startup retains its ownership guard");
  assert.ok((await readdir(temporary)).length > 0, "unconfirmed startup retains private logs/socket directory for inspection");
});
