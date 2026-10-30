import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { basename } from "node:path";
import { projectDisplayName, resolveProject } from "../src/project.ts";

function temporary(t: TestContext): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-decisions-project-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

function git(directory: string, args: string[]): string {
	const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
	for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
	return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
}

function repository(t: TestContext): string {
	const directory = temporary(t);
	git(directory, ["init", "--initial-branch=main"]);
	return directory;
}

// Behavioral-Active-Blackbox-GoodCommunication: real, disposable local Git repos.
test("non-repository identity is the canonical cwd, including symlink aliases", (t) => {
	const root = temporary(t);
	const directory = join(root, "outside");
	mkdirSync(directory);
	const alias = join(root, "alias");
	symlinkSync(directory, alias, "dir");
	assert.equal(resolveProject(directory), realpathSync(directory));
	assert.equal(resolveProject(alias), resolveProject(directory));
	const subdirectory = join(directory, "child");
	mkdirSync(subdirectory);
	assert.equal(resolveProject(subdirectory), realpathSync(subdirectory));
	assert.notEqual(resolveProject(directory), resolveProject(subdirectory));
});

test("repository subdirectories and symlinks share the canonical Git common directory", (t) => {
	const directory = repository(t);
	const nested = join(directory, "src", "nested");
	mkdirSync(nested, { recursive: true });
	const alias = join(temporary(t), "repo-alias");
	symlinkSync(directory, alias, "dir");
	const expected = realpathSync(join(directory, ".git"));
	assert.equal(resolveProject(directory), expected);
	assert.equal(resolveProject(nested), expected);
	assert.equal(resolveProject(join(alias, "src", "nested")), expected);
});

test("linked worktrees share decisions with the main repository", (t) => {
	const directory = repository(t);
	git(directory, ["-c", "user.name=Decisions Test", "-c", "user.email=decisions@example.invalid", "commit", "--allow-empty", "-m", "Initial"]);
	const worktree = join(temporary(t), "linked worktree");
	git(directory, ["worktree", "add", "-b", "linked", worktree]);
	const nested = join(worktree, "src", "nested");
	mkdirSync(nested, { recursive: true });
	assert.equal(resolveProject(worktree), resolveProject(directory));
	assert.equal(resolveProject(nested), resolveProject(directory));
});

test("bare repositories use their canonical common directory", (t) => {
	const directory = temporary(t);
	git(directory, ["init", "--bare"]);
	assert.equal(resolveProject(directory), realpathSync(directory));
});

test("paths containing shell metacharacters and trailing whitespace are treated literally", (t) => {
	const root = temporary(t);
	const directory = join(root, "repo ; $(echo nope) [x] ' \n");
	mkdirSync(directory);
	git(directory, ["init"]);
	assert.equal(resolveProject(directory), realpathSync(join(directory, ".git")));
});

test("a separate Git directory also provides a shared canonical identity", (t) => {
	const root = temporary(t);
	const directory = join(root, "repo");
	const metadata = join(root, "metadata");
	mkdirSync(directory);
	git(directory, ["init", "--separate-git-dir", metadata]);
	assert.equal(resolveProject(directory), realpathSync(metadata));
});

test("Git environment overrides cannot redirect cwd discovery", (t) => {
	const first = repository(t);
	const second = repository(t);
	const keys = ["GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"];
	const previous = new Map(keys.map((key) => [key, process.env[key]]));
	try {
		process.env.GIT_DIR = join(second, ".git");
		process.env.GIT_WORK_TREE = second;
		process.env.GIT_CONFIG_COUNT = "1";
		process.env.GIT_CONFIG_KEY_0 = "invalid config key";
		process.env.GIT_CONFIG_VALUE_0 = "value";
		assert.equal(resolveProject(first), realpathSync(join(first, ".git")));
		const outside = temporary(t);
		assert.equal(resolveProject(outside), realpathSync(outside));
	} finally {
		for (const [key, value] of previous) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("malformed .git files never fall back to a non-repository identity", (t) => {
	for (const contents of ["not a gitfile\n", "gitdir: /does/not/exist\n"]) {
		const directory = temporary(t);
		writeFileSync(join(directory, ".git"), contents);
		const nested = join(directory, "subdir");
		mkdirSync(nested);
		assert.throws(() => resolveProject(directory), /Cannot resolve Git project/);
		assert.throws(() => resolveProject(nested), /Cannot resolve Git project/);
	}
});

test("an empty or malformed .git directory is an error, even when Git calls it a non-repository", (t) => {
	const directory = temporary(t);
	mkdirSync(join(directory, ".git"));
	assert.throws(() => resolveProject(directory), /Cannot resolve Git project/);
});

test("a malformed nested .git cannot silently fall back to a valid outer repository", (t) => {
	const directory = repository(t);
	const nested = join(directory, "nested");
	mkdirSync(join(nested, ".git"), { recursive: true });
	assert.throws(() => resolveProject(nested), /Cannot resolve Git project/);
});

test("a valid nested bare repository keeps its own identity", (t) => {
	const directory = repository(t);
	const bare = join(directory, "nested.git");
	git(directory, ["init", "--bare", bare]);
	assert.equal(resolveProject(bare), realpathSync(bare));
});

test("real Git configuration failures are not treated as non-repositories", (t) => {
	const directory = repository(t);
	writeFileSync(join(directory, ".git", "config"), "[invalid config\n");
	assert.throws(() => resolveProject(directory), /Cannot resolve Git project.*bad config/s);
});

test("missing directories and non-directory cwd inputs fail rather than inventing identities", (t) => {
	const directory = temporary(t);
	assert.throws(() => resolveProject(join(directory, "missing")), /ENOENT/);
	const file = join(directory, "file");
	writeFileSync(file, "data");
	assert.throws(() => resolveProject(file), /not a directory/);
});

test("display names show the repository name, never a .git path; worktrees show the main repository", (t) => {
	const directory = repository(t);
	git(directory, ["-c", "user.name=Decisions Test", "-c", "user.email=decisions@example.invalid", "commit", "--allow-empty", "-m", "Initial"]);
	const worktree = join(temporary(t), "linked worktree");
	git(directory, ["worktree", "add", "-b", "linked", worktree]);
	const name = basename(realpathSync(directory));
	assert.equal(projectDisplayName(resolveProject(directory)), name);
	assert.equal(projectDisplayName(resolveProject(worktree)), name);
	const outside = join(temporary(t), "plain directory");
	mkdirSync(outside);
	assert.equal(projectDisplayName(resolveProject(outside)), "plain directory");
	assert.equal(projectDisplayName("/srv/repos/pony.git"), "pony");
	assert.equal(projectDisplayName("/"), "/");
	assert.equal(projectDisplayName("/.git"), "/");
});
