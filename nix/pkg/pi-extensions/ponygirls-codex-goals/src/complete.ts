/** /goal argument completion (subcommands and option forms; objectives are free text). */
import { completeArgument, type ArgumentChoice, type CompletionItem } from "@ponygirls/pi-ui";

const FIRST: readonly ArgumentChoice[] = [
  { token: "edit", label: "edit [objective]", description: "edit the objective (editor when no text is given)", continues: true },
  { token: "pause", label: "pause", description: "pause the active goal", continues: false },
  { token: "resume", label: "resume [--tokens N]", description: "reactivate a paused, blocked or limited goal", continues: true },
  { token: "clear", label: "clear", description: "clear the goal; transcript entries are kept", continues: false },
  { token: "--tokens", label: "--tokens N -- objective", description: "create a goal with a token cap", continues: true },
  { token: "--", label: "-- objective", description: "objective that starts with a subcommand word", continues: true },
];
const RESUME_OPTIONS: readonly ArgumentChoice[] = [
  { token: "--tokens", label: "--tokens N", description: "raise the token cap and resume (usage is kept)", continues: true },
];
const AFTER_BUDGET: readonly ArgumentChoice[] = [
  { token: "--", label: "-- objective", description: "create the goal with this cap", continues: true },
  { token: "resume", label: "resume", description: "raise the cap to this value and resume", continues: false },
];

const POSITIVE_INTEGER = /^[1-9]\d*$/;

function choicesFor(previous: readonly string[]): readonly ArgumentChoice[] | null {
  if (previous.length === 0) return FIRST;
  if (previous.length === 1 && previous[0] === "resume") return RESUME_OPTIONS;
  if (previous.length === 2 && previous[0] === "--tokens" && POSITIVE_INTEGER.test(previous[1]!)) return AFTER_BUDGET;
  return null;
}

export function completeGoalArguments(argumentPrefix: string): CompletionItem[] | null {
  return completeArgument(argumentPrefix, choicesFor);
}
