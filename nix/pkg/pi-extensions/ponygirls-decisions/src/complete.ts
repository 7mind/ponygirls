/** /decisions argument completion: the verbs and the question ids each verb applies to. */
import { completeArgument, type ArgumentChoice, type CompletionItem } from "@ponygirls/pi-ui";
import type { Decision, QuestionStatus } from "./store.ts";

const QUESTION_TEXT_LIMIT = 80;

type Verb = "answer" | "dismiss" | "reopen";

const VERBS: readonly { verb: Verb; label: string; description: string; applies: (status: QuestionStatus) => boolean }[] = [
  { verb: "answer", label: "answer Qn text", description: "save an answer", applies: (status) => status === "pending" },
  { verb: "dismiss", label: "dismiss Qn", description: "close a question without answering", applies: (status) => status !== "dismissed" },
  { verb: "reopen", label: "reopen Qn", description: "return a question to the inbox", applies: (status) => status !== "pending" },
];

/** Control characters are stripped by the caller-supplied `plain` before display. */
function questionChoice(question: Decision, continues: boolean, plain: (text: string) => string): ArgumentChoice {
  const text = question.question.replace(/\s+/g, " ");
  return {
    token: question.id,
    label: question.id,
    description: plain(`[${question.status}] ${text.length > QUESTION_TEXT_LIMIT ? `${text.slice(0, QUESTION_TEXT_LIMIT)}…` : text}`),
    continues,
  };
}

export function completeDecisionArguments(argumentPrefix: string, questions: readonly Decision[], plain: (text: string) => string): CompletionItem[] | null {
  return completeArgument(argumentPrefix, (previous) => {
    if (previous.length === 0) {
      return [
        ...VERBS.map(({ verb, label, description }) => ({ token: verb, label, description, continues: true })),
        ...questions.map((question) => questionChoice(question, false, plain)),
      ];
    }
    const verb = VERBS.find((candidate) => candidate.verb === previous[0]!.toLowerCase());
    if (previous.length !== 1 || verb === undefined) return null;
    return questions.filter((question) => verb.applies(question.status))
      .map((question) => questionChoice(question, verb.verb === "answer", plain));
  });
}
