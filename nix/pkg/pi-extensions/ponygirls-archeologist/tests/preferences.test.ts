import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, renameSync, symlinkSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectTrustStore, SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ALL_OFF, InstructionPreferences } from "../preferences.ts";

test("each AGENTS.md preference resolves independently; trust, inherit and session identity survive reopening", t => {
  const dir = mkdtempSync(join(tmpdir(), "agents-md-prefs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const project = join(dir, "project"), agent = join(dir, "agent");
  mkdirSync(join(project, ".pi"), { recursive: true }); mkdirSync(agent);
  const pref = new InstructionPreferences(agent), sessionManager = SessionManager.inMemory(project);
  let trusted = false;
  const context = { cwd: project, sessionManager, isProjectTrusted: () => trusted };
  const pi = { appendEntry: (type: string, data?: unknown) => { sessionManager.appendCustomEntry(type, data); } };
  assert.deepEqual(pref.effective(context), ALL_OFF);
  const file = join(project, ".pi", "archeologist.json");
  writeFileSync(file, "untrusted invalid file");
  writeFileSync(join(agent, "archeologist-defaults.json"), JSON.stringify({ version: 1, parent: true, nested: true }));
  pref.apply(pi, context, "global", [{ key: "nested", op: "set", value: false }]);
  assert.deepEqual(pref.effective(context), { ...ALL_OFF, parent: true });
  assert.throws(() => pref.apply(pi, context, "project", [{ key: "parent", op: "set", value: false }]), /trusted/);
  trusted = true;
  assert.deepEqual(pref.effective(context), { ...ALL_OFF, parent: true });
  new ProjectTrustStore(agent).set(dir, true);
  assert.throws(() => pref.effective(context), /Invalid/);
  writeFileSync(file, JSON.stringify({ version: 1, parent: false, global: true }));
  pref.apply(pi, context, "session", [{ key: "parent", op: "set", value: true }, { key: "worktree", op: "set", value: true }]);
  const next = new InstructionPreferences(agent);
  assert.deepEqual(next.effective(context), { mainNested: false, nested: false, parent: true, global: true, worktree: true });
  next.apply(pi, context, "session", [{ key: "parent", op: "inherit" }]);
  assert.equal(next.effective(context).parent, false);
  const other = { ...context, sessionManager: SessionManager.inMemory(project) } satisfies Pick<ExtensionContext, "cwd" | "sessionManager" | "isProjectTrusted">;
  assert.equal(next.effective(other).worktree, false);
  trusted = false;
  assert.deepEqual(next.effective(context), { ...ALL_OFF, parent: true, worktree: true });
});


for (const shared of ["linked-directory", "shared-directory", "linked-file"]) test(`Project preferences cannot read or write a ${shared} global target`, t => {
  const root = mkdtempSync(join(tmpdir(), "agents-md-scope-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "trusted"), project = join(cwd, ".pi"), other = join(root, "other");
  const agent = shared === "shared-directory" ? project : join(root, "user"), file = "archeologist.json";
  mkdirSync(cwd); mkdirSync(other); mkdirSync(agent);
  if (shared === "linked-directory") symlinkSync(agent, project);
  if (shared === "linked-file") { mkdirSync(project); symlinkSync(join(agent, file), join(project, file)); }
  const original = '{"version":1,"parent":true}'; writeFileSync(join(agent, file), original);
  new ProjectTrustStore(agent).set(cwd, true);
  const config = new InstructionPreferences(agent), ctx = { cwd, isProjectTrusted: () => true, sessionManager: SessionManager.inMemory(cwd) }, pi = { appendEntry: (type: string, data?: unknown) => { ctx.sessionManager.appendCustomEntry(type, data); } };
  assert.deepEqual(config.snapshot(ctx).project, {}, "the global override cannot reappear as a project value");
  assert.throws(() => config.apply(pi, ctx, "project", [{ key: "global", op: "set", value: true }]), /project/i);
  assert.equal(readFileSync(join(agent, file), "utf8"), original);
  assert.equal(config.effective({ ...ctx, cwd: other }).global, false);
  config.apply(pi, ctx, "session", [{ key: "global", op: "set", value: true }]); assert.equal(config.effective(ctx).global, true);
  config.apply(pi, ctx, "global", [{ key: "parent", op: "set", value: false }]); assert.equal(config.effective(ctx).parent, false);
});


test("a trusted Project save creates an independent file and rejects a target relinked during apply", t => {
  const dir = mkdtempSync(join(tmpdir(), "agents-md-save-")), agent = join(dir, "user"), cwd = join(dir, "cwd");
  t.after(() => rmSync(dir, { recursive: true, force: true })); mkdirSync(agent); mkdirSync(cwd);
  new ProjectTrustStore(agent).set(cwd, true);
  const config = new InstructionPreferences(agent), ctx = { cwd, isProjectTrusted: () => true, sessionManager: SessionManager.inMemory(cwd) };
  const pi = { appendEntry: () => {} };
  config.apply(pi, ctx, "project", [{ key: "parent", op: "set", value: true }]);
  assert.equal(config.snapshot(ctx).project.parent, true);
  const file = "archeologist.json", user = join(agent, file), project = join(cwd, ".pi");
  writeFileSync(user, '{"version":1}');
  assert.throws(() => config.apply(pi, ctx, "project", [{ key: "global", op: "set", get value() {
    renameSync(project, join(cwd, "previous")); symlinkSync(agent, project); return true;
  } }]), /Project settings/);
  assert.equal(readFileSync(user, "utf8"), '{"version":1}'); assert.deepEqual(config.snapshot(ctx).project, {});
});

test("removing subagents rejects a pending subagent save without blocking main-only saves", async t => {
  const cwd = mkdtempSync(join(tmpdir(), "discovery-availability-")); t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const ctx = { cwd, isProjectTrusted: () => false, sessionManager: SessionManager.inMemory(cwd) };
  const pi = { appendEntry: (type: string, data?: unknown) => { ctx.sessionManager.appendCustomEntry(type, data); } };
  const prefs = new InstructionPreferences(cwd);
  let available = true;
  const settings = prefs.controller(pi, ctx, () => available);
  settings.select(1); settings.toggleSelected();
  const save = settings.beginApply(); assert.ok(save);
  available = false; await save.run(new AbortController().signal);
  assert.deepEqual(prefs.effective(ctx), ALL_OFF); assert.match(settings.state().notice, /unavailable/);
  settings.dispose();
  const main = prefs.controller(pi, ctx, () => false);
  main.select(0); main.toggleSelected();
  const apply = main.beginApply(); assert.ok(apply); await apply.run(new AbortController().signal);
  assert.deepEqual(prefs.effective(ctx), { ...ALL_OFF, mainNested: true }); main.dispose();
});
