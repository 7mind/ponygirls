/** Pure /goal command parser. No Pi imports. */

export type GoalCommand =
  | { kind: "show" }
  | { kind: "create"; objective: string; tokenBudget: number | null }
  | { kind: "edit"; objective: string | null }
  | { kind: "pause" }
  | { kind: "resume"; tokenBudget: number | null | undefined }
  | { kind: "clear" };

export interface ParseError {
  code: "empty_objective" | "invalid_budget" | "unknown_subcommand" | "missing_delimiter";
  message: string;
}

const RESERVED = new Set(["edit", "pause", "resume", "clear"]);

function parseBudgetToken(text: string): number | null {
  const n = Number(text);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Supported forms:
 * - `/goal` → show
 * - `/goal <objective>` → create (objective may not start with a reserved word unless after `--`)
 * - `/goal --tokens 40000 -- <objective>` → create with budget
 * - `/goal edit` → interactive edit; `/goal edit <objective>` → explicit edit
 * - `/goal edit -- <objective>` → explicit edit with reserved-word objective
 * - `/goal pause|resume|clear`
 * - `/goal resume --tokens 80000` → raise cap and resume
 */
export function parseGoalCommand(
  args: string,
): { ok: true; value: GoalCommand } | { ok: false; error: ParseError } {
  const raw = args.trim();
  if (raw === "") return { ok: true, value: { kind: "show" } };

  const tokens = raw.split(/\s+/);
  // --tokens forms
  if (tokens[0] === "--tokens") {
    const budgetRaw = tokens[1];
    const budget = budgetRaw !== undefined ? parseBudgetToken(budgetRaw) : null;
    if (budget === null) {
      return {
        ok: false,
        error: { code: "invalid_budget", message: "Usage: /goal --tokens <positive integer> -- <objective>" },
      };
    }
    if (tokens[2] === "resume") {
      if (tokens.length > 3) {
        return {
          ok: false,
          error: { code: "unknown_subcommand", message: "Usage: /goal resume [--tokens <n>]" },
        };
      }
      return { ok: true, value: { kind: "resume", tokenBudget: budget } };
    }
    if (tokens[2] !== "--") {
      return {
        ok: false,
        error: { code: "missing_delimiter", message: "Usage: /goal --tokens <n> -- <objective>" },
      };
    }
    const objective = tokens.slice(3).join(" ").trim();
    if (!objective) {
      return { ok: false, error: { code: "empty_objective", message: "Objective must be nonempty." } };
    }
    return { ok: true, value: { kind: "create", objective, tokenBudget: budget } };
  }

  const first = tokens[0]!;
  if (first === "edit") {
    const rest = raw.slice(4).trim();
    if (rest === "") return { ok: true, value: { kind: "edit", objective: null } };
    const objective = rest.startsWith("-- ") ? rest.slice(3).trim() : rest.startsWith("--") ? rest.slice(2).trim() : rest;
    if (!objective) {
      return { ok: false, error: { code: "empty_objective", message: "Objective must be nonempty." } };
    }
    return { ok: true, value: { kind: "edit", objective } };
  }
  if (first === "pause") {
    if (tokens.length !== 1) {
      return { ok: false, error: { code: "unknown_subcommand", message: "Usage: /goal pause" } };
    }
    return { ok: true, value: { kind: "pause" } };
  }
  if (first === "resume") {
    if (tokens.length === 1) return { ok: true, value: { kind: "resume", tokenBudget: undefined } };
    if (tokens[1] === "--tokens") {
      const budget = tokens[2] !== undefined ? parseBudgetToken(tokens[2]) : null;
      if (budget === null || tokens.length !== 3) {
        return {
          ok: false,
          error: { code: "invalid_budget", message: "Usage: /goal resume [--tokens <positive integer>]" },
        };
      }
      return { ok: true, value: { kind: "resume", tokenBudget: budget } };
    }
    return { ok: false, error: { code: "unknown_subcommand", message: "Usage: /goal resume [--tokens <n>]" } };
  }
  if (first === "clear") {
    if (tokens.length !== 1) {
      return { ok: false, error: { code: "unknown_subcommand", message: "Usage: /goal clear" } };
    }
    return { ok: true, value: { kind: "clear" } };
  }
  if (first === "--") {
    const objective = tokens.slice(1).join(" ").trim();
    if (!objective) {
      return { ok: false, error: { code: "empty_objective", message: "Objective must be nonempty." } };
    }
    return { ok: true, value: { kind: "create", objective, tokenBudget: null } };
  }
  // Bare create: the whole raw string is the objective (reserved-word check
  // applies only to the first token without a `--` delimiter).
  if (RESERVED.has(first)) {
    return {
      ok: false,
      error: {
        code: "unknown_subcommand",
        message: `“${first}” is a subcommand. To use it as objective text, write /goal -- ${raw}.`,
      },
    };
  }
  return { ok: true, value: { kind: "create", objective: raw, tokenBudget: null } };
}
