import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, test, type TestContext } from "node:test";
import { promisify } from "node:util";
import {
	DECISION_LIMITS,
	DecisionStoreError,
	MemoryDecisionStore,
	SqliteDecisionStore,
	type AskInput,
	type DecisionStore,
	type QuestionStatus,
} from "../src/store.ts";

const execute = promisify(execFile);
const storeUrl = new URL("../src/store.ts", import.meta.url).href;

function input(overrides?: Partial<AskInput>): AskInput {
	return {
		question: "Which database should we use?",
		context: "The application runs locally.\nDurability matters.",
		options: ["SQLite", "PostgreSQL"],
		recommendation: "SQLite: no separate server is needed.",
		sessionId: "session-1",
		toolCallId: "call-1",
		...overrides,
	};
}

function errorCode(code: string): (error: unknown) => boolean {
	return (error) => error instanceof DecisionStoreError && error.code === code;
}

function temporary(t: TestContext): string {
	const directory = mkdtempSync(join(tmpdir(), "pi-decisions-store-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

function databasePath(t: TestContext): string {
	return join(temporary(t), "decisions", "questions.sqlite");
}

// Behavioral-Active-Blackbox contract: Atomic with the dummy, GoodCommunication
// with SQLite. Consumers can use this same two-run pattern without SQL knowledge.
for (const adapter of [
	{ name: "memory", create: (_t: TestContext): DecisionStore => new MemoryDecisionStore() },
	{ name: "sqlite", create: (t: TestContext): DecisionStore => new SqliteDecisionStore(databasePath(t)) },
]) {
	describe(`${adapter.name}: shared DecisionStore contract`, () => {
		function fresh(t: TestContext): DecisionStore {
			const store = adapter.create(t);
			t.after(() => store.close());
			return store;
		}

		test("empty projects are isolated and missing questions are explicit errors", (t) => {
			const store = fresh(t);
			assert.deepEqual(store.list("project-a"), []);
			assert.throws(() => store.get("project-a", "Q1"), errorCode("not_found"));
			store.ask("project-a", input());
			assert.deepEqual(store.list("project-b"), []);
			assert.throws(() => store.get("project-b", "Q1"), errorCode("not_found"));
		});

		test("allocates independent project numbers and preserves the complete payload", (t) => {
			const store = fresh(t);
			const question = input();
			const first = store.ask("project-a", question);
			assert.deepEqual(first, {
				...question, id: "Q1", number: 1, project: "project-a", status: "pending", answer: null,
				revision: 1, createdAt: first.createdAt, updatedAt: first.createdAt,
			});
			assert.equal(new Date(first.createdAt).toISOString(), first.createdAt);
			assert.equal(store.ask("project-a", input({ toolCallId: "call-2" })).id, "Q2");
			assert.equal(store.ask("project-b", question).id, "Q1");
			assert.deepEqual(store.get("project-a", "Q1"), first);
			assert.deepEqual(store.list("project-a").map((d) => d.id), ["Q1", "Q2"]);
		});

		test("asks are idempotent by project, session, and tool call, including after answering", (t) => {
			const store = fresh(t);
			const first = store.ask("a", input());
			assert.deepEqual(store.ask("a", input({ question: "Replacement?", options: [] })), first);
			const answered = store.resolve("a", first.id, first.revision, "answered", "Use SQLite");
			assert.deepEqual(store.ask("a", input()), answered);
			assert.equal(store.ask("a", input({ sessionId: "session-2" })).id, "Q2");
			assert.equal(store.ask("a", input({ toolCallId: "call-2" })).id, "Q3");
			assert.equal(store.ask("b", input()).id, "Q1");
		});

		test("deduplication does not confuse delimiter-containing identities", (t) => {
			const store = fresh(t);
			assert.equal(store.ask("a", input({ sessionId: "b:c", toolCallId: "d" })).id, "Q1");
			assert.equal(store.ask("a", input({ sessionId: "b", toolCallId: "c:d" })).id, "Q2");
			assert.equal(store.ask("a:b", input({ sessionId: "c", toolCallId: "d" })).id, "Q1");
		});

		test("input and returned snapshots cannot mutate stored question content or options", (t) => {
			const store = fresh(t);
			const question = input();
			const created = store.ask("a", question);
			question.options.push("Injected input");
			question.question = "Injected question";
			created.options[0] = "Injected return";
			created.question = "Injected return";
			const read = store.get("a", "Q1");
			read.options.length = 0;
			const listed = store.list("a");
			listed[0].options.push("Injected listing");
			listed[0].status = "dismissed";
			const resolved = store.resolve("a", "Q1", 1, "answered", "answer");
			resolved.options.push("Injected resolution");
			const saved = store.get("a", "Q1");
			assert.equal(saved.question, input().question);
			assert.deepEqual(saved.options, input().options);
			assert.equal(saved.status, "answered");
		});

		test("answers may be edited, dismissed, and reopened without rewriting question metadata", (t) => {
			const store = fresh(t);
			const original = store.ask("a", input());
			let current = original;
			for (const [status, answer] of [
				["answered", "SQLite"], ["answered", "Actually PostgreSQL"], ["pending", null],
				["dismissed", null], ["pending", null], ["answered", "Final answer"], ["dismissed", null],
			] as const) {
				const previous = current;
				current = store.resolve("a", "Q1", previous.revision, status, answer);
				assert.equal(current.revision, previous.revision + 1);
				assert.equal(current.status, status);
				assert.equal(current.answer, answer);
				assert.equal(current.createdAt, original.createdAt);
				assert.ok(current.updatedAt >= original.updatedAt);
				assert.deepEqual({ ...current, status: original.status, answer: original.answer, revision: 1, updatedAt: original.updatedAt }, original);
			}
			assert.deepEqual(store.list("a"), [current]);
		});

		test("a stale revision cannot clobber an answer and failed CAS leaves the store usable", (t) => {
			const store = fresh(t);
			store.ask("a", input());
			const answered = store.resolve("a", "Q1", 1, "answered", "First writer");
			assert.throws(() => store.resolve("a", "Q1", 1, "answered", "Stale writer"), errorCode("conflict"));
			assert.deepEqual(store.get("a", "Q1"), answered);
			assert.equal(store.resolve("a", "Q1", answered.revision, "pending", null).revision, 3);
			assert.throws(() => store.resolve("b", "Q1", 1, "dismissed", null), errorCode("not_found"));
		});

		test("same-value saves also advance revision", (t) => {
			const store = fresh(t);
			store.ask("a", input());
			assert.equal(store.resolve("a", "Q1", 1, "pending", null).revision, 2);
			assert.throws(() => store.resolve("a", "Q1", 1, "pending", null), errorCode("conflict"));
		});

		test("invalid ask payloads fail without consuming sequence numbers", (t) => {
			const store = fresh(t);
			const invalid = [
				{ question: " \n" }, { question: "x".repeat(DECISION_LIMITS.question + 1) },
				{ question: "has\0NUL" }, { context: "x".repeat(DECISION_LIMITS.context + 1) },
				{ recommendation: "x".repeat(DECISION_LIMITS.recommendation + 1) },
				{ options: new Array(2) }, { options: [" "] }, { options: ["x".repeat(DECISION_LIMITS.option + 1)] },
				{ options: Array(DECISION_LIMITS.options + 1).fill("x") }, { options: "not an array" },
				{ sessionId: "" }, { toolCallId: "" }, { toolCallId: "x".repeat(DECISION_LIMITS.toolCallId + 1) },
				{ question: null }, { context: null }, { recommendation: undefined }, { options: [4] },
			];
			for (const override of invalid) {
				assert.throws(() => store.ask("a", input(override as Partial<AskInput>)), errorCode("validation"));
			}
			assert.throws(() => store.ask("a", null as unknown as AskInput), errorCode("validation"));
			assert.throws(() => store.ask("", input()), errorCode("validation"));
			assert.deepEqual(store.list("a"), []);
			assert.equal(store.ask("a", input()).id, "Q1");
		});

		test("accepts exact content bounds and empty optional explanatory fields", (t) => {
			const store = fresh(t);
			const question = input({
				question: "q".repeat(DECISION_LIMITS.question), context: "c".repeat(DECISION_LIMITS.context),
				options: Array(DECISION_LIMITS.options).fill("o".repeat(DECISION_LIMITS.option)),
				recommendation: "r".repeat(DECISION_LIMITS.recommendation),
			});
			const created = store.ask("a", question);
			assert.equal(created.question, question.question);
			assert.equal(store.resolve("a", "Q1", 1, "answered", "a".repeat(DECISION_LIMITS.answer)).answer?.length, DECISION_LIMITS.answer);
			const minimal = store.ask("a", input({ context: "", recommendation: "", options: [], toolCallId: "minimal" }));
			assert.deepEqual(minimal.options, []);
		});

		test("invalid answers, statuses, and revisions never change the record", (t) => {
			const store = fresh(t);
			const original = store.ask("a", input());
			for (const [status, answer] of [
				["answered", null], ["answered", ""], ["answered", " \n\t"],
				["answered", "x".repeat(DECISION_LIMITS.answer + 1)], ["answered", "NUL\0"],
				["pending", "answer"], ["dismissed", "answer"], ["dismissed", undefined], ["unknown", null],
			]) {
				assert.throws(() => store.resolve("a", "Q1", 1, status as QuestionStatus, answer as string | null), errorCode("validation"));
			}
			for (const revision of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
				assert.throws(() => store.resolve("a", "Q1", revision, "pending", null), errorCode("validation"));
			}
			assert.deepEqual(store.get("a", "Q1"), original);
			assert.equal(store.resolve("a", "Q1", 1, "answered", "valid").revision, 2);
		});

		test("rejects malformed IDs and empty projects consistently", (t) => {
			const store = fresh(t);
			store.ask("a", input());
			for (const id of ["Q0", "Q01", "q1", "Q-1", "Q1.0", "Q1x", "", "Q9007199254740992"]) {
				assert.throws(() => store.get("a", id), errorCode("validation"));
				assert.throws(() => store.resolve("a", id, 1, "pending", null), errorCode("validation"));
			}
			assert.throws(() => store.list(" \t"), errorCode("validation"));
			assert.throws(() => store.get("", "Q1"), errorCode("validation"));
		});

		test("close is idempotent and rejects future operations", (t) => {
			const store = fresh(t);
			store.close();
			store.close();
			assert.throws(() => store.ask("a", input()), errorCode("closed"));
			assert.throws(() => store.list("a"), errorCode("closed"));
			assert.throws(() => store.get("a", "Q1"), errorCode("closed"));
			assert.throws(() => store.resolve("a", "Q1", 1, "pending", null), errorCode("closed"));
		});
	});
}

// Targeted SQLite semantics: persistence, process contention, rollback, and safe
// handling of on-disk files. These deliberately do not grow the memory dummy.
describe("SQLite durability and exact semantics", () => {
	test("reload preserves resolutions, idempotency, and sequences", (t) => {
		const path = databasePath(t);
		let store = new SqliteDecisionStore(path);
		store.ask("a", input());
		const answered = store.resolve("a", "Q1", 1, "answered", "Durable answer");
		store.close();
		store = new SqliteDecisionStore(path);
		t.after(() => store.close());
		assert.deepEqual(store.get("a", "Q1"), answered);
		assert.deepEqual(store.ask("a", input()), answered);
		assert.equal(store.ask("a", input({ toolCallId: "second" })).id, "Q2");
	});

	test("multiple processes allocate contiguous unique IDs and deduplicate a shared ask", async (t) => {
		const path = databasePath(t);
		const worker = `
			import { SqliteDecisionStore } from ${JSON.stringify(storeUrl)};
			const [path, worker, count] = process.argv.slice(1);
			const store = new SqliteDecisionStore(path);
			const base = ${JSON.stringify(input())};
			const shared = store.ask('project', base);
			const ids = [];
			for (let i = 0; i < Number(count); i++) {
				ids.push(store.ask('project', {...base, toolCallId: worker + ':' + i}).id);
			}
			store.close();
			console.log(JSON.stringify({shared: shared.id, ids}));
		`;
		const results = await Promise.all(Array.from({ length: 4 }, (_, workerId) =>
			execute(process.execPath, ["--input-type=module", "-e", worker, path, String(workerId), "15"], { timeout: 30_000 }),
		));
		const parsed = results.map((result) => JSON.parse(result.stdout));
		assert.equal(new Set(parsed.map((r) => r.shared)).size, 1);
		const store = new SqliteDecisionStore(path);
		t.after(() => store.close());
		assert.equal(new Set(parsed.flatMap((r) => r.ids)).size, 60);
		assert.deepEqual(store.list("project").map((d) => d.number), Array.from({ length: 61 }, (_, i) => i + 1));
	});

	test("competing process CAS saves have exactly one winner", async (t) => {
		const path = databasePath(t);
		const store = new SqliteDecisionStore(path);
		t.after(() => store.close());
		store.ask("a", input());
		const worker = `
			import { SqliteDecisionStore } from ${JSON.stringify(storeUrl)};
			const store = new SqliteDecisionStore(process.argv[1]);
			try {
				store.resolve('a', 'Q1', 1, 'answered', process.argv[2]);
				console.log('saved');
			} catch (error) { console.log(error.code); }
			finally { store.close(); }
		`;
		const results = await Promise.all(["first", "second"].map((answer) =>
			execute(process.execPath, ["--input-type=module", "-e", worker, path, answer], { timeout: 30_000 }),
		));
		assert.deepEqual(results.map((r) => r.stdout.trim()).sort(), ["conflict", "saved"]);
		const saved = store.get("a", "Q1");
		assert.equal(saved.revision, 2);
		assert.ok(["first", "second"].includes(saved.answer!));
	});

	test("failed inserts roll back the project sequence and release the transaction", (t) => {
		const path = databasePath(t);
		const store = new SqliteDecisionStore(path);
		t.after(() => store.close());
		const database = new DatabaseSync(path);
		try {
			// Backend-only fault injection, after sequence allocation but before insert.
			database.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON decisions BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
			assert.throws(() => store.ask("a", input()), /injected failure/);
			assert.deepEqual(store.list("a"), []);
			database.exec("DROP TRIGGER fail_insert");
			assert.equal(store.ask("a", input()).id, "Q1");
		} finally { database.close(); }
	});

	test("the final safe revision remains readable but cannot overflow", (t) => {
		const path = databasePath(t);
		const store = new SqliteDecisionStore(path);
		t.after(() => store.close());
		store.ask("a", input());
		const database = new DatabaseSync(path);
		try {
			database.prepare("UPDATE decisions SET revision = ?").run(Number.MAX_SAFE_INTEGER - 1);
			const final = store.resolve("a", "Q1", Number.MAX_SAFE_INTEGER - 1, "answered", "Final revision");
			assert.equal(final.revision, Number.MAX_SAFE_INTEGER);
			assert.deepEqual(store.get("a", "Q1"), final);
			assert.throws(() => store.resolve("a", "Q1", final.revision, "pending", null), errorCode("validation"));
		} finally { database.close(); }
	});

	test("corrupt bytes are rejected without resetting the file", (t) => {
		const path = join(temporary(t), "questions.sqlite");
		const bytes = Buffer.from("This is not SQLite. Preserve these bytes.\0\xff");
		writeFileSync(path, bytes);
		assert.throws(() => new SqliteDecisionStore(path), errorCode("schema"));
		assert.deepEqual(readFileSync(path), bytes);
	});

	test("unknown versions and unversioned existing schemas fail closed", (t) => {
		for (const version of [0, 999]) {
			const path = join(temporary(t), "questions.sqlite");
			const database = new DatabaseSync(path);
			database.exec(`CREATE TABLE precious(data TEXT); INSERT INTO precious VALUES ('keep me'); PRAGMA user_version = ${version}`);
			database.close();
			const before = readFileSync(path);
			assert.throws(() => new SqliteDecisionStore(path), errorCode("schema"));
			assert.deepEqual(readFileSync(path), before);
		}
	});

	test("a claimed supported version without the required schema is not recreated", (t) => {
		const path = join(temporary(t), "questions.sqlite");
		const database = new DatabaseSync(path);
		database.exec("PRAGMA user_version = 1");
		database.close();
		const before = readFileSync(path);
		assert.throws(() => new SqliteDecisionStore(path), errorCode("schema"));
		assert.deepEqual(readFileSync(path), before);
	});

	test("directory and file are private without chmodding existing ancestors", (t) => {
		const ancestor = temporary(t);
		chmodSync(ancestor, 0o755);
		const directory = join(ancestor, "decisions");
		mkdirSync(directory, { mode: 0o777 });
		chmodSync(directory, 0o777);
		const path = join(directory, "questions.sqlite");
		writeFileSync(path, "", { mode: 0o666 });
		chmodSync(path, 0o666);
		const store = new SqliteDecisionStore(path);
		t.after(() => store.close());
		assert.equal(statSync(ancestor).mode & 0o777, 0o755);
		assert.equal(statSync(directory).mode & 0o777, 0o700);
		assert.equal(statSync(path).mode & 0o777, 0o600);
	});

	test("symlink database files are rejected without touching their targets", (t) => {
		const directory = temporary(t);
		const target = join(directory, "target");
		writeFileSync(target, "keep me");
		const path = join(directory, "questions.sqlite");
		symlinkSync(target, path);
		assert.throws(() => new SqliteDecisionStore(path));
		assert.equal(readFileSync(target, "utf8"), "keep me");
	});
});
