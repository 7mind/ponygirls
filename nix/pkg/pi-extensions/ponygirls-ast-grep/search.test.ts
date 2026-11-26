import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import test, { type TestContext } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { search } from "./search.ts";

type Exec = ExtensionAPI["exec"];
const GO = { lang: "go", pattern: "context.WithTimeout($$$ARGS)" };
const CALL = { ...GO, pattern: `func t() { ${GO.pattern} }`, selector: "call_expression" };
const SOURCE = 'package example\nimport "context"\nfunc f() { context.WithTimeout(ctx, duration) }\n';
const SDK = process.env.PI_AST_GREP_SDK_ROOT;
const BIN = process.env.PONYGIRLS_AST_GREP_BIN;
const dummyBinaries = { astGrep: "fixture", git: "fixture-git" };
const summary = (scanned: number) => `sg: summary|file: scannedFileCount=${scanned},skippedFileCount=0\n`;
const record = (file: string, text: string, line: number, column: number) => JSON.stringify({ file, text, range: { start: { line, column } } });
const completed = (code: number, stdout = "", stderr = "") => ({ code, stdout, stderr, truncated: false, killed: false });

async function temp(t: TestContext): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-ast-grep-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// Hand-written stand-in for the one Go construct used by the shared contract.
// Parser and process behavior beyond this subset belongs to the real CLI leg.
const dummy: Exec = async (_binary, args, options) => {
  const isCall = args.includes("--selector=call_expression");
  if (args.includes("--stdin")) return completed(1, "", `Debug Pattern:\n${isCall ? "call_expression" : "type_conversion_expression"}\n`);
  const file = args.at(-1)!;
  // For one named file ast-grep also reports the language it took from the file name.
  const trace = `${args.includes("--inspect=entity") ? `sg: entity|file|${file}: language=Go\n` : ""}${summary(1)}`;
  if (isCall && file.endsWith(".go")) return completed(0, `${record(relative(options!.cwd!, join(options!.cwd!, file)), "context.WithTimeout(ctx, duration)", 2, 11)}\n`, trace);
  return completed(1, "", trace);
};

function contract(name: string, makeExec: () => Promise<Exec>, binary: string, skip: string | false) {
  test(`${name}: scoped hit and diagnostic for a valid Go pattern that parses as the wrong kind`, { skip }, async (t) => {
    const dir = await temp(t);
    const cwd = join(dir, "checkout");
    await mkdir(cwd);
    await writeFile(join(cwd, "example.go"), SOURCE);
    await writeFile(join(dir, "outside.go"), SOURCE);
    await symlink(join(dir, "outside.go"), join(cwd, "link.go"));
    await symlink(cwd, join(dir, "alias"));
    const exec = await makeExec();
    const query = (params: Parameters<typeof search>[3]) => search(exec, { astGrep: binary, git: "git" }, cwd, params, undefined);
    assert.match(await query({ ...CALL, path: "@example.go" }), /^example\.go:3:12: context\.WithTimeout\(/m);
    await assert.rejects(query({ ...CALL, path: "../outside.go" }), /stay inside/);
    await assert.rejects(query({ ...CALL, path: "link.go" }), /stay inside/);
    assert.match(await query({ ...CALL, path: join(dir, "alias", "example.go") }), /^example\.go:3:12:/m);
    const zero = await query({ ...GO, path: "example.go" });
    assert.match(zero, /No syntactic matches/);
    assert.doesNotMatch(zero, /not searched|reads this file as/);
    assert.match(zero, /type_conversion_expression/);
    assert.match(zero, /selector call_expression/);
    assert.match(zero, /Cross-check with grep/);
  });
}

contract("dummy", async () => dummy, "fixture", false);
contract("pinned CLI via Pi exec", async () => {
  const { execCommand } = await import(pathToFileURL(join(SDK!, "dist/core/exec.js")).href);
  return (binary, args, options) => execCommand(binary, args, options!.cwd, options);
}, BIN ?? "ast-grep", SDK && BIN ? false : "set PI_AST_GREP_SDK_ROOT and PONYGIRLS_AST_GREP_BIN");

test("bounds public results and distinguishes omitted hits from an interrupted scan", async (t) => {
  const dir = await temp(t);
  await writeFile(join(dir, "example.go"), SOURCE);
  const data = Array.from({ length: 100 }, (_, i) => record("example.go", "x".repeat(500) + "NOT_SHOWN", i, 2)).join("\n") + "\n";
  const query = (result: Awaited<ReturnType<Exec>>) => search(async () => result, dummyBinaries, dir, CALL, undefined);
  const limited = await query(completed(0, data, summary(1)));
  assert.match(limited, /Showing 40 of 100 matches/);
  assert.equal(limited.split("\n").filter((line) => line.startsWith("example.go:")).length, 40);
  assert.match(limited, /…$/m);
  assert.doesNotMatch(limited, /NOT_SHOWN|example\.go:41:/);
  const partial = await query({ ...completed(1, data + '{"file":"UNFINISHED'), truncated: true, killed: true });
  assert.match(partial, /scan incomplete/);
  assert.doesNotMatch(partial, /100 match|UNFINISHED/);
  await assert.rejects(query({ ...completed(1, '{"file":"UNFINISHED'), truncated: true, killed: true }), /output limit before a complete hit/);
});

// Second validation report, F1: a cut inside a surrogate pair left an unpaired half in the result.
test("clipped snippets and diagnostics stay well-formed Unicode", async (t) => {
  const dir = await temp(t);
  const astral = "\u{1F600}".repeat(4);
  const lone = /\p{Cs}/u;
  const shown = await search(async () => completed(0, `${record("example.go", "x".repeat(158) + astral, 0, 0)}\n`, summary(1)), dummyBinaries, dir, CALL, undefined);
  assert.doesNotMatch(shown, lone);
  assert.match(shown, /^example\.go:1:1: x{158}…$/m);
  const failed = search(async () => completed(8, "", "e".repeat(798) + astral), dummyBinaries, dir, CALL, undefined);
  await assert.rejects(failed, (error: Error) => !lone.test(error.message) && /e{798}…$/.test(error.message));
});

// An ast-grep that finds nothing in the named file and does not say whether it selects the file's name.
const unanswered = (trace: string): Exec => async (_binary, args) => {
  if (args.includes("--stdin")) return completed(1, "", "Debug Pattern:\ncall_expression\n");
  return completed(1, "", args.includes("--inspect=entity") ? `${trace}${summary(1)}` : "");
};

// Whether a file name belongs to a language is asked of ast-grep; without an answer the result stays hedged.
test("a named file whose language cannot be checked gets a hedged caveat, not a verdict", async (t) => {
  const dir = await temp(t);
  await writeFile(join(dir, "example.go"), SOURCE);
  const query = { ...CALL, lang: "golang", path: "example.go" };
  const aliased = await search(unanswered("sg: entity|file|example.go: language=Go\n"), dummyBinaries, dir, query, undefined);
  assert.match(aliased, /ast-grep reads this file as Go \(from its name\)\. If Go is not the language golang names/);
  assert.match(aliased, /No syntactic matches/);
  const unmapped = await search(unanswered(""), dummyBinaries, dir, query, undefined);
  assert.match(unmapped, /File probably not searched: ast-grep reported no language for it/);
  assert.doesNotMatch(unmapped, /No syntactic matches/);
});

// The question needs a scratch file of the same name; a temp directory that cannot hold it is no reason to fail.
test("a scratch file that cannot be created leaves the hedged caveat, not an error", async (t) => {
  const dir = await temp(t);
  await writeFile(join(dir, "example.go"), SOURCE);
  const previous = process.umask(0o300); // a directory created now is read-only, even for its owner
  try {
    const result = await search(unanswered("sg: entity|file|example.go: language=Go\n"), dummyBinaries, dir, { ...CALL, lang: "golang", path: "example.go" }, undefined);
    assert.match(result, /ast-grep reads this file as Go \(from its name\)/);
    assert.match(result, /No syntactic matches/);
  } finally {
    process.umask(previous);
  }
});

// F7: one slow file made the whole call fail, also for matches ast-grep had already printed.
test("a scan stopped at its deadline keeps the complete hits and says what was not searched", async (t) => {
  const dir = await temp(t);
  await writeFile(join(dir, "example.go"), SOURCE);
  const deadlines: (number | undefined)[] = [];
  // A stopped ast-grep has not printed its summary; a line that reads like one comes from a path it named.
  const stopped = (stdout: string): Exec => async (_binary, _args, options) => {
    deadlines.push(options?.timeout);
    return { ...completed(0, stdout, `ERROR: ./locked\n${summary(7)}x: Permission denied (os error 13)\n`), killed: true };
  };
  const partial = await search(stopped(`${record("example.go", "hit()", 0, 0)}\n{"file":"UNFINISHED`), dummyBinaries, dir, CALL, undefined);
  assert.match(partial, /^Deadline of 15 s reached; scan incomplete\. Showing 1 hit\(s\) found before it\.$/m);
  assert.match(partial, /^example\.go:1:1: hit\(\)$/m);
  assert.match(partial, /file counts unavailable/);
  assert.doesNotMatch(partial, /UNFINISHED|match\(es\)|7 file\(s\)/);
  assert.deepEqual(deadlines, [15_000], "the scan runs with the production deadline");
  await assert.rejects(search(stopped(""), dummyBinaries, dir, CALL, undefined), /timed out after 15 s.*narrow the search path/s);
  await assert.rejects(search(stopped(""), dummyBinaries, dir, { ...CALL, path: "example.go" }, undefined), /timed out after 15 s on this file.*not searched/s);
});

test("reports process failure, deadline, and cancellation rather than zero matches", async (t) => {
  const dir = await temp(t);
  const fake = (result: Awaited<ReturnType<Exec>>) => search(async () => result, dummyBinaries, dir, CALL, undefined);
  await assert.rejects(fake(completed(1, "", "spawn fixture ENOENT")), /ENOENT/);
  await assert.rejects(fake(completed(8, "", "Invalid pattern")), /Invalid pattern/);
  await assert.rejects(fake({ ...completed(1), killed: true }), /timed out/);
  await assert.rejects(fake(completed(0, "", summary(1))), /exit status and match records disagree/);
  const abort = new AbortController();
  const cancelled = search(async (_binary, _args, options) => {
    abort.abort(new Error("fixture cancelled"));
    assert.equal(options?.signal?.aborted, true);
    return { ...completed(1), killed: true };
  }, dummyBinaries, dir, CALL, abort.signal);
  await assert.rejects(cancelled, /fixture cancelled/);
});
