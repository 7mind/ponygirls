// BG / controlled-process communication: helper protocol characterization.
// No PostgreSQL connection or server process is needed for fail-closed cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ownedDatabase } from "../tests-browser/database.mjs";
import { configFor } from "../tests-browser/native.mjs";
import { spawnSync } from "node:child_process";

async function helper(mode, action) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-browser-helper-"));
  const file = path.join(dir, "helper"); const audit = path.join(dir, "calls.jsonl");
  await writeFile(file, `#!${process.execPath}
import {appendFileSync,writeFileSync} from 'node:fs';
const dir=${JSON.stringify(dir)},mode=${JSON.stringify(mode)},args=process.argv.slice(2);
appendFileSync(${JSON.stringify(audit)},JSON.stringify(args)+'\\n');
if(args[0]==='--drop'){process.stdout.write(mode==='bad-drop'?'[]':'{}');process.exit(0);}
const name=args[0],passwordFile=dir+'/password';writeFileSync(passwordFile,mode==='empty-file'?'':'runtime-secret\\n');
let value={jdbcUrl:'jdbc:postgresql://127.0.0.1:15433/'+name,user:'least_privilege',passwordFile};
if(mode==='timeout'){setTimeout(()=>{},30000);}
else if(mode==='exit'){process.exit(3);}
else if(mode==='malformed'){process.stdout.write('{');}
else if(mode==='utf8'){process.stdout.write(Buffer.from([0xff]));}
else if(mode==='oversized'){process.stdout.write('x'.repeat(16385));}
else if(mode==='duplicate'){process.stdout.write('{'.slice(0,1)+'"user":"shadow",'+JSON.stringify(value).slice(1));}
else {if(mode==='remote')value.jdbcUrl='jdbc:postgresql://example.invalid/'+name;
if(mode==='wrong-name')value.jdbcUrl='jdbc:postgresql://127.0.0.1/unowned';
if(mode==='url-credentials')value.jdbcUrl='jdbc:postgresql://admin:secret@127.0.0.1/'+name;
if(mode==='query')value.jdbcUrl+='?user=admin';
if(mode==='relative-file')value.passwordFile='password';
if(mode==='missing-file')value.passwordFile=dir+'/missing';
if(mode==='extra')value.extra=true;
if(mode==='array')value=[];if(mode==='null')value=null;
process.stdout.write(JSON.stringify(value));}
`, { mode: 0o700 });
  try { await action({ dir, file, calls: async () => (await readFile(audit, "utf8")).trim().split("\n").map(JSON.parse) }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("paired helper returns the only runtime descriptor and drops only its registered generated name once", async () => {
  await helper("valid", async ({ dir, file, calls }) => {
    const database = await ownedDatabase({ connectionString: "postgresql://admin@remote.invalid/production", dir,
      env: { HAYSTACK_TEST_PROVISION_COMMAND: file, HAYSTACK_FIXTURE_ADMIN_AUTHORIZED: "1" } });
    assert.match(database.name, /^haystack_current_[0-9a-f]{16}$/);
    assert.equal(database.runtime.user, "least_privilege"); assert.equal(Object.isFrozen(database.runtime), true);
    const config = await configFor({ database: database.runtime, port: 12345, webRoot: null, auth: {} });
    assert.equal(config.database.jdbcUrl, `jdbc:postgresql://127.0.0.1:15433/${database.name}`);
    assert.equal(config.database.user, "least_privilege"); assert.equal(config.database.passwordFile, path.join(dir, "password"));
    await database.close(); await database.close();
    assert.deepEqual(await calls(), [[database.name], ["--drop", database.name]]);
  });
});

test("every invalid configured helper mode fails without administrator or runtime-identity fallback", async (t) => {
  for (const mode of ["malformed", "utf8", "oversized", "duplicate", "remote", "wrong-name", "url-credentials", "query", "relative-file", "missing-file", "empty-file", "extra", "array", "null", "exit"]) {
    await t.test(mode, async () => helper(mode, async ({ dir, file, calls }) => {
      await assert.rejects(ownedDatabase({ connectionString: "postgresql://admin@127.0.0.1:1/not-used", dir,
        env: { HAYSTACK_TEST_PROVISION_COMMAND: file, HAYSTACK_FIXTURE_ADMIN_AUTHORIZED: "1" } }), /no runtime-identity fallback/);
      const invoked = await calls();
      assert.equal(invoked.length, 2); assert.match(invoked[0][0], /^haystack_current_[0-9a-f]{16}$/);
      assert.deepEqual(invoked[1], ["--drop", invoked[0][0]]);
    }));
  }
});

test("helper deadline is ten seconds and still attempts paired owned-name cleanup", async () => {
  await helper("timeout", async ({ dir, file, calls }) => {
    const before = Date.now();
    await assert.rejects(ownedDatabase({ dir, env: { HAYSTACK_TEST_PROVISION_COMMAND: file } }), /no runtime-identity fallback/);
    const elapsed = Date.now() - before; assert(elapsed >= 9500 && elapsed < 15000, `deadline elapsed ${elapsed}ms`);
    const invoked = await calls(); assert.deepEqual(invoked[1], ["--drop", invoked[0][0]]);
  });
});

test("cleanup requires exact empty object and never silently marks an invalid drop complete", async () => {
  await helper("bad-drop", async ({ dir, file, calls }) => {
    const database = await ownedDatabase({ dir, env: { HAYSTACK_TEST_PROVISION_COMMAND: file } });
    await assert.rejects(database.close(), /cleanup response/); await assert.rejects(database.close(), /cleanup response/);
    assert.deepEqual((await calls()).slice(1), [["--drop", database.name], ["--drop", database.name]]);
  });
});

test("direct administrator provisioning and invalid helper paths require explicit authorization", async () => {
  await assert.rejects(ownedDatabase({ connectionString: "postgresql://admin@127.0.0.1:1/not-used", env: {} }), /explicit owned fixture-admin authorization/);
  await assert.rejects(ownedDatabase({ env: { HAYSTACK_TEST_PROVISION_COMMAND: "relative-helper", HAYSTACK_FIXTURE_ADMIN_AUTHORIZED: "1" } }), /absolute executable/);
  await assert.rejects(ownedDatabase({ env: { HAYSTACK_TEST_PROVISION_COMMAND: "", HAYSTACK_FIXTURE_ADMIN_AUTHORIZED: "1" } }), /absolute executable/);
});

test("all acceptance entrypoints fail rather than skip when required dependencies are absent", () => {
  for (const script of ["prerequisites", "run", "restart", "quick-preview"]) {
    const env = { ...process.env };
    for (const name of ["HAYSTACK_SERVER_COMMAND", "HAYSTACK_TEST_PG", "HAYSTACK_TEST_PROVISION_COMMAND", "HAYSTACK_FIXTURE_ADMIN_AUTHORIZED", "HAYSTACK_CHROMIUM", "HAYSTACK_FIREFOX", "HAYSTACK_NGINX"]) delete env[name];
    const child = spawnSync(process.execPath, ["--import", new URL("../../scripts/register-generated.mjs", import.meta.url).pathname,
      new URL(`../tests-browser/${script}.mjs`, import.meta.url).pathname], { env, encoding: "utf8", timeout: 10000 });
    assert.notEqual(child.status, 0, script); assert.equal(child.signal, null, script);
    assert.doesNotMatch(child.stdout, /SKIP/u, script);
    assert.match(child.stderr, /HAYSTACK_SERVER_COMMAND is required/u, script);
  }
});
