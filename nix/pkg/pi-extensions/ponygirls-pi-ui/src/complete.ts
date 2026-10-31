/**
 * Slash-command argument completion. pi passes the whole argument text after
 * `/command ` and replaces all of it with the chosen item's `value`, without
 * filtering; so each value repeats the already-typed tokens and only the last
 * (partial) token is completed here.
 */

/** Structurally pi-tui's AutocompleteItem. */
export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

export interface ArgumentChoice {
  token: string;
  /** Shown instead of the token, e.g. with its syntax (`resume [--tokens N]`). */
  label: string;
  description: string;
  /** Another argument follows: the completion ends with a space. */
  continues: boolean;
}

/**
 * Complete the last token of `argumentPrefix`. `choicesFor` receives the
 * complete tokens typed before it and returns the choices for the next
 * position, or null when that position is free text (no suggestions).
 * Matching is a case-insensitive prefix match.
 */
export function completeArgument(
  argumentPrefix: string,
  choicesFor: (previous: readonly string[]) => readonly ArgumentChoice[] | null,
): CompletionItem[] | null {
  const partial = /\S*$/.exec(argumentPrefix)![0];
  const head = argumentPrefix.slice(0, argumentPrefix.length - partial.length);
  const previous = head.split(/\s+/).filter((token) => token !== "");
  const choices = choicesFor(previous);
  if (choices === null) return null;
  const wanted = partial.toLowerCase();
  const items = choices
    .filter((choice) => choice.token.toLowerCase().startsWith(wanted))
    .map((choice) => ({
      value: `${head}${choice.token}${choice.continues ? " " : ""}`,
      label: choice.label,
      description: choice.description,
    }));
  return items.length === 0 ? null : items;
}
