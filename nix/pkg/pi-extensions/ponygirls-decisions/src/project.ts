import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

function findGitMarker(directory: string): string | undefined {
	for (;;) {
		const marker = join(directory, ".git");
		try {
			lstatSync(marker);
			return marker;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

/**
 * A canonical Git common directory identifies a repository across subdirectories,
 * symlinks, and linked worktrees. Outside Git, the canonical cwd is the identity.
 * Discovery failures (broken Git metadata, config, permissions, or missing git)
 * are deliberately not converted to non-repository identities.
 */
export function resolveProject(cwd: string): string {
	const canonicalCwd = realpathSync(cwd);
	if (!statSync(canonicalCwd).isDirectory()) throw new Error(`Project cwd is not a directory: ${cwd}`);
	const marker = findGitMarker(canonicalCwd);
	const env: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C" };
	// A caller's GIT_DIR, GIT_WORK_TREE, config overrides, etc. must not redirect
	// discovery away from the cwd passed to this function.
	for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
	try {
		const output = execFileSync("git", ["--no-optional-locks", "-C", canonicalCwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
			encoding: "utf8",
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		// Strip only Git's one terminating newline, not whitespace belonging to a path.
		const commonDirectory = output.endsWith("\n") ? output.slice(0, -1) : output;
		if (!commonDirectory) throw new Error("Git returned an empty common directory");
		const canonicalCommonDirectory = realpathSync(commonDirectory);
		if (marker && statSync(marker).isDirectory() && realpathSync(marker) !== canonicalCommonDirectory) {
			// Git silently skips malformed .git directories during discovery. Validate
			// a differing nearest marker explicitly instead of accepting an outer repo.
			execFileSync("git", ["--no-optional-locks", "-C", canonicalCwd, "--git-dir", marker, "rev-parse", "--git-common-dir"], {
				encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"],
			});
		}
		return canonicalCommonDirectory;
	} catch (error) {
		const failure = error as Error & { status?: number; stderr?: string | Buffer };
		const stderr = failure.stderr?.toString() ?? "";
		const nonRepository = failure.status === 128 &&
			/^fatal: not a git repository \(or any (?:of the )?parent(?: directories| up to mount point)/.test(stderr);
		if (nonRepository && !marker) return canonicalCwd;
		throw new Error(`Cannot resolve Git project at ${canonicalCwd}: ${stderr.trim() || failure.message}`, { cause: error });
	}
}
