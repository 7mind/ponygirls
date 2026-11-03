// Acceptance legs fail closed. Missing prerequisites are not a successful skip.
import path from "node:path";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
async function executable(name) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute executable path`);
  await access(value, constants.X_OK);
}
export async function prerequisites(leg = "all") {
  if (!process.env.HAYSTACK_SERVER_COMMAND?.trim()) throw new Error("HAYSTACK_SERVER_COMMAND is required (Scala/native only)");
  if (leg !== "preview") {
    if (process.env.HAYSTACK_TEST_PROVISION_COMMAND !== undefined) await executable("HAYSTACK_TEST_PROVISION_COMMAND");
    else if (!process.env.HAYSTACK_TEST_PG || process.env.HAYSTACK_FIXTURE_ADMIN_AUTHORIZED !== "1") throw new Error("provide HAYSTACK_TEST_PROVISION_COMMAND or HAYSTACK_TEST_PG with HAYSTACK_FIXTURE_ADMIN_AUTHORIZED=1 for an owned cluster");
  }
  if (leg === "main" && process.env.HAYSTACK_FIREFOX) await executable("HAYSTACK_FIREFOX");
  else await executable("HAYSTACK_CHROMIUM");
  if (leg === "all" || leg === "restart") {
    await executable("HAYSTACK_NGINX");
    for (const command of ["openssl", ...(process.env.HAYSTACK_PROXY_CONFIG_FILE === undefined ? ["nix"] : [])]) await exec("bash", ["-c", 'command -v "$1" >/dev/null', "prerequisite", command], { timeout: 10000 });
  }
  if (leg === "all" || leg === "preview") {
    for (const command of ["initdb", "pg_ctl", "psql", "curl", "npm"]) await exec("bash", ["-c", 'command -v "$1" >/dev/null', "prerequisite", command], { timeout: 10000 });
  }
  await access(fileURLToPath(new URL("../dist/index.html", import.meta.url)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prerequisites();
