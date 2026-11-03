// Fixture provisioning only, never application storage. A configured helper is
// authoritative: failures cannot fall back to the runtime or administrator role.
import path from "node:path";
import { access, lstat, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { parse as validateJson } from "lossless-json";
import pg from "pg";

const exec = promisify(execFile);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
async function invoke(helper, args) {
  let stdout;
  try { ({ stdout } = await exec(helper, args, { encoding: "buffer", timeout: 10000, killSignal: "SIGKILL", maxBuffer: 16384 })); }
  catch { throw new Error("owned fixture provisioning command failed; no runtime-identity fallback"); }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
    validateJson(text); // Includes duplicate-key rejection; stdout is never logged.
    return JSON.parse(text);
  } catch { throw new Error("invalid owned fixture provisioning response"); }
}
export async function validateDescriptor(value, name) {
  if (!object(value) || Object.keys(value).sort().join(",") !== "jdbcUrl,passwordFile,user") throw new Error("invalid fixture database descriptor");
  for (const field of ["jdbcUrl", "user", "passwordFile"]) if (typeof value[field] !== "string" || !value[field].length) throw new Error("invalid fixture database descriptor");
  if (!value.jdbcUrl.startsWith("jdbc:postgresql://") || /[\s?#@]/u.test(value.jdbcUrl) || value.user.length > 128 || /[\p{Cc}]/u.test(value.user)) throw new Error("invalid fixture database descriptor");
  const url = new URL(value.jdbcUrl.slice(5));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/" + name || url.username || url.password || url.search || url.hash || !path.isAbsolute(value.passwordFile)) throw new Error("invalid fixture database descriptor");
  const info = await lstat(value.passwordFile);
  if (!info.isFile() || info.size < 1 || info.size > 16384) throw new Error("invalid fixture credential file");
  const password = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(value.passwordFile)).replace(/\r?\n$/u, "");
  if (!password.length || /[\n\r\0]/u.test(password)) throw new Error("invalid fixture credential file");
  return Object.freeze({ jdbcUrl: value.jdbcUrl, user: value.user, passwordFile: value.passwordFile });
}
export async function ownedDatabase({ connectionString, dir, env = process.env }) {
  const name = "haystack_current_" + randomBytes(8).toString("hex");
  if (env.HAYSTACK_TEST_PROVISION_COMMAND !== undefined) {
    const helper = env.HAYSTACK_TEST_PROVISION_COMMAND;
    if (!path.isAbsolute(helper)) throw new Error("provision helper must be an absolute executable path");
    await access(helper, constants.X_OK);
    // Register only our generated name, before invocation: a helper can create
    // it and then fail or lose its response. Never clean a name from stdout.
    let registered = true;
    const close = async () => {
      if (!registered) return;
      const response = await invoke(helper, ["--drop", name]);
      if (!object(response) || Object.keys(response).length !== 0) throw new Error("invalid owned fixture cleanup response");
      registered = false;
    };
    try {
      const runtime = await validateDescriptor(await invoke(helper, [name]), name);
      return { name, runtime, close };
    } catch {
      let cleaned = true; try { await close(); } catch { cleaned = false; }
      throw new Error(cleaned ? "owned fixture provisioning failed; no runtime-identity fallback" : "owned fixture provisioning and cleanup failed; no runtime-identity fallback");
    }
  }
  if (env.HAYSTACK_FIXTURE_ADMIN_AUTHORIZED !== "1") throw new Error("direct CREATE DATABASE needs explicit owned fixture-admin authorization");
  if (!connectionString) throw new Error("HAYSTACK_TEST_PG is required for authorized direct provisioning");
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search || url.hash) throw new Error("owned fixture administrator must be explicit loopback PostgreSQL");
  const command = async (sql) => {
    const client = new pg.Client({ connectionString }); await client.connect();
    try { await client.query(sql); } finally { await client.end(); }
  };
  await command(`CREATE DATABASE "${name}"`);
  let registered = true;
  const close = async () => { if (registered) { await command(`DROP DATABASE "${name}" WITH (FORCE)`); registered = false; } };
  try {
    const passwordFile = path.join(dir, "database-password");
    await writeFile(passwordFile, decodeURIComponent(url.password) || "unused-test-password", { mode: 0o600 });
    const runtime = await validateDescriptor({ jdbcUrl: `jdbc:postgresql://${url.host}/${name}`, user: decodeURIComponent(url.username) || env.USER, passwordFile }, name);
    return { name, runtime, close };
  } catch (error) { await close(); throw error; }
}
