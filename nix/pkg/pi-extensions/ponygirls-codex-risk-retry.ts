import type { CustomMessageEntry, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const RETRY_TYPE = "ponygirls:codex-risk-retry";
const EXHAUSTED_TYPE = "ponygirls:codex-risk-retry-exhausted";
const CODEX_API = "openai-codex-responses";
const MAX_ATTEMPTS = 2;
const RISK_PATTERN = /\bThis content was flagged for possible cybersecurity risk\b/i;
const CLARIFICATION = [
	"The provider’s external classifier blocked the previous request as a possible cybersecurity risk.",
	"This may be a false positive on the application-development task already described.",
	"Review the actual task and its established scope.",
	"Continue if permitted, using precise technical terminology without changing or concealing the task’s intent.",
].join(" ");

interface RetryDetails {
	userEntryId: string | null;
	failedEntryId: string;
	attempt: number;
}

function readDetails(value: unknown): RetryDetails {
	if (typeof value !== "object" || value === null) {
		throw new Error("Codex classifier recovery: invalid persisted retry details");
	}
	const details = value as Partial<RetryDetails>;
	if (
		(details.userEntryId !== null && typeof details.userEntryId !== "string") ||
		typeof details.failedEntryId !== "string" || details.failedEntryId.length === 0 ||
		typeof details.attempt !== "number" || !Number.isInteger(details.attempt) ||
		details.attempt < 1 || details.attempt > MAX_ATTEMPTS
	) {
		throw new Error("Codex classifier recovery: invalid persisted retry details");
	}
	return details as RetryDetails;
}

export default function (pi: ExtensionAPI): void {
	pi.on("agent_before_settle", (event, ctx) => {
		if (
			event.outcome !== "error" || event.continue ||
			event.context.pendingMessages.length > 0 || ctx.hasPendingMessages() ||
			(ctx.signal !== undefined && ctx.signal.aborted)
		) return;

		const failure = event.context.contextEntries.findLast((entry) =>
			entry.messages.some((message) => message.role === "assistant"),
		);
		if (failure === undefined) return;
		const message = failure.messages.findLast((message) => message.role === "assistant");
		if (
			message === undefined || message.stopReason !== "error" || message.api !== CODEX_API ||
			message.errorMessage === undefined || !RISK_PATTERN.test(message.errorMessage)
		) return;

		// The raw active branch retains retry evidence even when compaction hides it from context.
		const branch = ctx.sessionManager.getBranch();
		const latestAssistant = branch.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
		if (latestAssistant === undefined || latestAssistant.id !== failure.sourceEntry.id) return;
		const userIndex = branch.findLastIndex((entry) => entry.type === "message" && entry.message.role === "user");
		if (userIndex > branch.findIndex((entry) => entry.id === failure.sourceEntry.id)) return;
		const userEntryId = userIndex < 0 ? null : branch[userIndex].id;
		const records = branch.slice(userIndex + 1).filter((entry): entry is CustomMessageEntry =>
			entry.type === "custom_message" && (entry.customType === RETRY_TYPE || entry.customType === EXHAUSTED_TYPE),
		);
		let attempts = 0;
		for (const record of records) {
			const details = readDetails(record.details);
			if (details.userEntryId !== userEntryId) {
				throw new Error("Codex classifier recovery: retry belongs to a different user request");
			}
			if (details.failedEntryId === failure.sourceEntry.id) return;
			if (record.customType === RETRY_TYPE) attempts++;
		}

		const exhausted = attempts >= MAX_ATTEMPTS;
		const attempt = exhausted ? MAX_ATTEMPTS : attempts + 1;
		const details: RetryDetails = { userEntryId, failedEntryId: failure.sourceEntry.id, attempt };
		return {
			entries: [...event.entries, {
				type: "custom_message",
				customType: exhausted ? EXHAUSTED_TYPE : RETRY_TYPE,
				content: exhausted
					? `Automatic Codex classifier recovery stopped after ${MAX_ATTEMPTS} continuations for this user request. The provider block remains unresolved; this extension will not request further continuations.`
					: `Codex classifier recovery ${attempt}/${MAX_ATTEMPTS}.\n\n${CLARIFICATION}`,
				display: true,
				details,
			}],
			continue: !exhausted,
		};
	});
}
