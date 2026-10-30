import { constants, closeSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type QuestionStatus = "pending" | "answered" | "dismissed";

export interface Decision {
	id: string;
	project: string;
	number: number;
	question: string;
	context: string;
	options: string[];
	recommendation: string;
	status: QuestionStatus;
	answer: string | null;
	revision: number;
	createdAt: string;
	updatedAt: string;
	sessionId: string;
	toolCallId: string;
}

export interface AskInput {
	question: string;
	context: string;
	options: string[];
	recommendation: string;
	sessionId: string;
	toolCallId: string;
}

export interface DecisionStore {
	/** All questions, oldest number first, including answered and dismissed ones. */
	list(project: string): Decision[];
	get(project: string, id: string): Decision;
	/** The first ask for (project, sessionId, toolCallId) wins, even after resolution. */
	ask(project: string, input: AskInput): Decision;
	/** Every successful compare-and-swap increments revision, including a same-value edit. */
	resolve(project: string, id: string, revision: number, status: QuestionStatus, answer: string | null): Decision;
	close(): void;
}

export const DECISION_LIMITS = Object.freeze({
	question: 2_000,
	context: 12_000,
	options: 9,
	option: 2_000,
	recommendation: 4_000,
	answer: 16_000,
	project: 16_384,
	sessionId: 4_096,
	toolCallId: 4_096,
});

export type DecisionStoreErrorCode = "validation" | "not_found" | "conflict" | "closed" | "schema";

export class DecisionStoreError extends Error {
	readonly code: DecisionStoreErrorCode;

	constructor(code: DecisionStoreErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "DecisionStoreError";
		this.code = code;
	}
}

function text(value: unknown, name: string, limit: number, nonempty: boolean): asserts value is string {
	if (typeof value !== "string" || value.length > limit || value.includes("\0") || (nonempty && !value.trim())) {
		throw new DecisionStoreError("validation", `${name} must be ${nonempty ? "a nonempty" : "a"} string of at most ${limit} characters without NULs`);
	}
}

function validateProject(project: string): void {
	text(project, "project", DECISION_LIMITS.project, true);
}

function validateAsk(project: string, input: AskInput): void {
	validateProject(project);
	if (!input || typeof input !== "object") throw new DecisionStoreError("validation", "Ask input is required");
	text(input.question, "question", DECISION_LIMITS.question, true);
	text(input.context, "context", DECISION_LIMITS.context, false);
	text(input.recommendation, "recommendation", DECISION_LIMITS.recommendation, false);
	text(input.sessionId, "sessionId", DECISION_LIMITS.sessionId, true);
	text(input.toolCallId, "toolCallId", DECISION_LIMITS.toolCallId, true);
	if (!Array.isArray(input.options) || input.options.length > DECISION_LIMITS.options) {
		throw new DecisionStoreError("validation", `options must be an array of at most ${DECISION_LIMITS.options} strings`);
	}
	// Do not use forEach: sparse arrays must not bypass validation.
	for (const option of input.options) text(option, "option", DECISION_LIMITS.option, true);
}

function questionNumber(id: string): number {
	if (typeof id !== "string" || !/^Q[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id.slice(1)))) {
		throw new DecisionStoreError("validation", "Question ID must be Q followed by a positive safe integer");
	}
	return Number(id.slice(1));
}

function validateResolution(revision: number, status: QuestionStatus, answer: string | null): void {
	if (!Number.isSafeInteger(revision) || revision < 1 || revision >= Number.MAX_SAFE_INTEGER) {
		throw new DecisionStoreError("validation", "revision must be a positive safe integer below the maximum");
	}
	validateState(status, answer);
}

function validateState(status: QuestionStatus, answer: string | null): void {
	if (status === "answered") text(answer, "answer", DECISION_LIMITS.answer, true);
	else if ((status !== "pending" && status !== "dismissed") || answer !== null) {
		throw new DecisionStoreError("validation", "pending and dismissed require a null answer; unknown statuses are not allowed");
	}
}

function copy(decision: Decision): Decision {
	return { ...decision, options: [...decision.options] };
}

function makeDecision(project: string, number: number, input: AskInput): Decision {
	const now = new Date().toISOString();
	return {
		...input,
		options: [...input.options],
		id: `Q${number}`,
		project,
		number,
		status: "pending",
		answer: null,
		revision: 1,
		createdAt: now,
		updatedAt: now,
	};
}

function notFound(id: string): never {
	throw new DecisionStoreError("not_found", `Question ${id} was not found in this project`);
}

function checkRevision(decision: Decision, revision: number): void {
	if (decision.revision !== revision) {
		throw new DecisionStoreError("conflict", `Question ${decision.id} changed (expected revision ${revision}, current ${decision.revision}); reload before saving`);
	}
}

/** A strict in-memory implementation for consumers and the shared contract tests. */
export class MemoryDecisionStore implements DecisionStore {
	private readonly projects = new Map<string, Decision[]>();
	private closed = false;

	private ensureOpen(): void {
		if (this.closed) throw new DecisionStoreError("closed", "Decision store is closed");
	}

	list(project: string): Decision[] {
		this.ensureOpen();
		validateProject(project);
		return (this.projects.get(project) ?? []).map(copy);
	}

	get(project: string, id: string): Decision {
		this.ensureOpen();
		validateProject(project);
		const number = questionNumber(id);
		const decision = this.projects.get(project)?.[number - 1];
		return decision ? copy(decision) : notFound(id);
	}

	ask(project: string, input: AskInput): Decision {
		this.ensureOpen();
		validateAsk(project, input);
		const decisions = this.projects.get(project) ?? [];
		const existing = decisions.find((d) => d.sessionId === input.sessionId && d.toolCallId === input.toolCallId);
		if (existing) return copy(existing);
		const decision = makeDecision(project, decisions.length + 1, input);
		decisions.push(decision);
		this.projects.set(project, decisions);
		return copy(decision);
	}

	resolve(project: string, id: string, revision: number, status: QuestionStatus, answer: string | null): Decision {
		this.ensureOpen();
		validateResolution(revision, status, answer);
		const decision = this.get(project, id);
		checkRevision(decision, revision);
		const updated = { ...decision, status, answer, revision: revision + 1, updatedAt: new Date().toISOString() };
		this.projects.get(project)![decision.number - 1] = updated;
		return copy(updated);
	}

	close(): void {
		this.closed = true;
	}
}

const SCHEMA_VERSION = 1;
const COLUMNS = "project, number, question, context, options, recommendation, status, answer, revision, created_at, updated_at, session_id, tool_call_id";

type Row = Record<string, unknown>;

function fromRow(row: Row): Decision {
	try {
		const input: AskInput = {
			question: row.question as string,
			context: row.context as string,
			options: JSON.parse(row.options as string),
			recommendation: row.recommendation as string,
			sessionId: row.session_id as string,
			toolCallId: row.tool_call_id as string,
		};
		validateAsk(row.project as string, input);
		questionNumber(`Q${row.number}`);
		if (!Number.isSafeInteger(row.revision) || (row.revision as number) < 1) throw new Error("Invalid revision");
		validateState(row.status as QuestionStatus, row.answer as string | null);
		if (typeof row.created_at !== "string" || typeof row.updated_at !== "string" ||
			!Number.isFinite(Date.parse(row.created_at)) || !Number.isFinite(Date.parse(row.updated_at))) {
			throw new Error("Invalid timestamps");
		}
		return {
			...input,
			project: row.project as string,
			number: row.number as number,
			id: `Q${row.number}`,
			status: row.status as QuestionStatus,
			answer: row.answer as string | null,
			revision: row.revision as number,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	} catch (cause) {
		throw new DecisionStoreError("schema", "Invalid decision record; database was not reset", { cause });
	}
}

/** Only the immediate storage directory is tightened, never Pi's home or any other ancestor. */
function privateDatabasePath(path: string): string {
	if (path === ":memory:") return path;
	const absolute = resolve(path);
	const directory = dirname(absolute);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	if (!lstatSync(directory).isDirectory()) throw new Error("Decision database directory must not be a symlink");
	chmodSync(directory, 0o700);
	const fd = openSync(absolute, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
	try {
		if (!fstatSync(fd).isFile()) throw new Error("Decision database must be a regular file");
		fchmodSync(fd, 0o600);
	} finally {
		closeSync(fd);
	}
	return absolute;
}

export class SqliteDecisionStore implements DecisionStore {
	private readonly database: DatabaseSync;
	private closed = false;

	constructor(path: string) {
		this.database = new DatabaseSync(privateDatabasePath(path));
		try {
			// A write reservation before reading sequences or revisions prevents deferred-transaction races.
			this.database.exec("PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;");
			this.transaction(() => this.initialize());
		} catch (cause) {
			this.database.close();
			const reason = cause instanceof Error ? cause.message : String(cause);
			throw new DecisionStoreError("schema", `Cannot open decision database: ${reason}; it was not reset`, { cause });
		}
	}

	private initialize(): void {
		const version = this.database.prepare("PRAGMA user_version").get()!.user_version;
		if (version !== 0 && version !== SCHEMA_VERSION) {
			throw new Error(`Unsupported decisions schema version ${version}`);
		}
		if (version === 0) {
			const existing = this.database.prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
			if (existing.length) throw new Error("Unversioned nonempty database is not a decisions database");
			this.database.exec(`
				CREATE TABLE projects (
					project TEXT PRIMARY KEY,
					next_number INTEGER NOT NULL CHECK(next_number > 0)
				) STRICT;
				CREATE TABLE decisions (
					project TEXT NOT NULL REFERENCES projects(project),
					number INTEGER NOT NULL CHECK(number > 0),
					question TEXT NOT NULL,
					context TEXT NOT NULL,
					options TEXT NOT NULL CHECK(json_valid(options) AND json_type(options) = 'array'),
					recommendation TEXT NOT NULL,
					status TEXT NOT NULL CHECK(status IN ('pending', 'answered', 'dismissed')),
					answer TEXT,
					revision INTEGER NOT NULL CHECK(revision > 0),
					created_at TEXT NOT NULL,
					updated_at TEXT NOT NULL,
					session_id TEXT NOT NULL,
					tool_call_id TEXT NOT NULL,
					PRIMARY KEY(project, number),
					UNIQUE(project, session_id, tool_call_id),
					CHECK((status = 'answered' AND answer IS NOT NULL AND length(trim(answer)) > 0)
						OR (status IN ('pending', 'dismissed') AND answer IS NULL))
				) STRICT;
				PRAGMA user_version = ${SCHEMA_VERSION};
			`);
		}
		const checks = this.database.prepare("PRAGMA quick_check").all();
		if (checks.length !== 1 || checks[0].quick_check !== "ok") throw new Error("Decision database integrity check failed");
		// A claimed version alone is insufficient: fail closed on missing or incompatible tables.
		this.database.prepare(`SELECT ${COLUMNS} FROM decisions LIMIT 0`).all();
		this.database.prepare("SELECT project, next_number FROM projects LIMIT 0").all();
	}

	private ensureOpen(): void {
		if (this.closed) throw new DecisionStoreError("closed", "Decision store is closed");
	}

	private transaction<T>(operation: () => T): T {
		this.database.exec("BEGIN IMMEDIATE");
		try {
			const result = operation();
			this.database.exec("COMMIT");
			return result;
		} catch (error) {
			try { this.database.exec("ROLLBACK"); } catch { /* Preserve the original failure. */ }
			throw error;
		}
	}

	list(project: string): Decision[] {
		this.ensureOpen();
		validateProject(project);
		return this.database.prepare(`SELECT ${COLUMNS} FROM decisions WHERE project = ? ORDER BY number`).all(project).map(fromRow);
	}

	get(project: string, id: string): Decision {
		this.ensureOpen();
		validateProject(project);
		const number = questionNumber(id);
		const row = this.database.prepare(`SELECT ${COLUMNS} FROM decisions WHERE project = ? AND number = ?`).get(project, number);
		return row ? fromRow(row) : notFound(id);
	}

	ask(project: string, input: AskInput): Decision {
		this.ensureOpen();
		validateAsk(project, input);
		return this.transaction(() => {
			const existing = this.database.prepare(`SELECT ${COLUMNS} FROM decisions WHERE project = ? AND session_id = ? AND tool_call_id = ?`)
				.get(project, input.sessionId, input.toolCallId);
			if (existing) return fromRow(existing);
			this.database.prepare("INSERT INTO projects(project, next_number) VALUES (?, 1) ON CONFLICT(project) DO NOTHING").run(project);
			const number = this.database.prepare("SELECT next_number FROM projects WHERE project = ?").get(project)!.next_number as number;
			if (!Number.isSafeInteger(number) || number < 1 || number >= Number.MAX_SAFE_INTEGER) {
				throw new DecisionStoreError("schema", "Project question sequence is invalid or exhausted");
			}
			const decision = makeDecision(project, number, input);
			this.database.prepare("UPDATE projects SET next_number = ? WHERE project = ?").run(number + 1, project);
			this.database.prepare(`INSERT INTO decisions (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
				project, number, input.question, input.context, JSON.stringify(input.options), input.recommendation,
				decision.status, decision.answer, decision.revision, decision.createdAt, decision.updatedAt, input.sessionId, input.toolCallId,
			);
			return decision;
		});
	}

	resolve(project: string, id: string, revision: number, status: QuestionStatus, answer: string | null): Decision {
		this.ensureOpen();
		validateResolution(revision, status, answer);
		return this.transaction(() => {
			const decision = this.get(project, id);
			checkRevision(decision, revision);
			this.database.prepare("UPDATE decisions SET status = ?, answer = ?, revision = revision + 1, updated_at = ? WHERE project = ? AND number = ? AND revision = ?")
				.run(status, answer, new Date().toISOString(), project, decision.number, revision);
			return this.get(project, id);
		});
	}

	close(): void {
		if (this.closed) return;
		this.database.close();
		this.closed = true;
	}
}
