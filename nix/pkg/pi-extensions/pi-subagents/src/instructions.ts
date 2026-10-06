/**
 * pi-subagents — skills and context files handed to children.
 *
 * A child receives an explicit selection from its owner's instruction set,
 * snapshotted at spawn and persisted with the agent, so a reloaded child
 * sees the same text. The governing session's set is what pi loaded for its
 * current run (observed on before_agent_start); a child's own set bounds
 * what its children can receive.
 */

import { createHash } from "node:crypto";
import { err } from "./errors.ts";
import type { ContextFile, InstructionSet, ResourceSelection, SkillRef } from "./types.ts";

export const EMPTY_INSTRUCTIONS: InstructionSet = { contextFiles: [], skills: [] };

/** Snapshot ceiling: it travels in the worker's initialize payload next to the task text. */
export const MAX_INSTRUCTION_BYTES = 128 * 1024;

/**
 * The owner's skills and context files a child receives. `null` selects
 * none; "all" selects every item; a list names items by skill name or
 * context-file path (unknown names are rejected).
 */
export function selectInstructions(available: InstructionSet | null, skills: ResourceSelection | null, contextFiles: ResourceSelection | null): InstructionSet {
  if (skills === null && contextFiles === null) return EMPTY_INSTRUCTIONS;
  if (available === null) {
    throw err("INVALID", "the governing session's skills and context files are unavailable for this run");
  }
  const selected: InstructionSet = {
    contextFiles: pick(available.contextFiles, contextFiles, (f) => f.path, "context file"),
    skills: pick(available.skills, skills, (s) => s.name, "skill"),
  };
  const bytes = Buffer.byteLength(JSON.stringify(selected), "utf8");
  if (bytes > MAX_INSTRUCTION_BYTES) {
    throw err("PAYLOAD_TOO_LARGE", `selected skills and context files take ${bytes} bytes; the limit is ${MAX_INSTRUCTION_BYTES}`);
  }
  return selected;
}

/** Owner order is kept: pi orders context files from global to most specific. */
function pick<T>(available: T[], selection: ResourceSelection | null, key: (item: T) => string, noun: string): T[] {
  if (selection === null) return [];
  if (selection === "all") return [...available];
  const known = new Set(available.map(key));
  const unknown = selection.filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw err("INVALID", `unknown ${noun}(s): ${unknown.map((k) => JSON.stringify(k)).join(", ")}; available: ${[...known].map((k) => JSON.stringify(k)).join(", ") || "none"}`);
  }
  const wanted = new Set(selection);
  return available.filter((item) => wanted.has(key(item)));
}

export function instructionHash(set: InstructionSet): string {
  return createHash("sha256").update(JSON.stringify(set), "utf8").digest("hex");
}

/**
 * A selection from tool arguments: a list of names (`field`) or every item
 * (`all_<field>: true`); both absent selects none.
 */
export function parseSelection(args: Record<string, unknown>, field: string): ResourceSelection | null {
  const list = args[field];
  const all = args[`all_${field}`];
  if (all !== undefined && typeof all !== "boolean") throw err("INVALID", `all_${field} must be a boolean`);
  if (all === true) {
    if (list !== undefined) throw err("INVALID", `pass either ${field} or all_${field}, not both`);
    return "all";
  }
  if (list === undefined || list === null) return null;
  if (Array.isArray(list) && list.every((x): x is string => typeof x === "string" && x.length > 0)) return list;
  throw err("INVALID", `${field} must be a list of names`);
}

/** The instruction set in pi's system-prompt options (contextFiles, skills), validated. */
export function instructionsFromPromptOptions(options: { contextFiles?: unknown; skills?: unknown }): InstructionSet {
  return parseInstructionSet({ contextFiles: options.contextFiles ?? [], skills: options.skills ?? [] });
}

/** Validate an instruction set crossing a boundary (pi options, IPC). */
export function parseInstructionSet(raw: unknown): InstructionSet {
  const set = (raw ?? {}) as Record<string, unknown>;
  const files = set["contextFiles"];
  const skills = set["skills"];
  if (!Array.isArray(files) || !Array.isArray(skills)) throw err("INVALID", "an instruction set needs contextFiles and skills arrays");
  return {
    contextFiles: files.map((f): ContextFile => {
      const r = (f ?? {}) as Record<string, unknown>;
      if (typeof r["path"] !== "string" || typeof r["content"] !== "string") throw err("INVALID", "malformed context file");
      return { path: r["path"], content: r["content"] };
    }),
    skills: skills.map((sk): SkillRef => {
      const r = (sk ?? {}) as Record<string, unknown>;
      if (typeof r["name"] !== "string" || typeof r["description"] !== "string" || typeof r["filePath"] !== "string" || typeof r["baseDir"] !== "string") {
        throw err("INVALID", "malformed skill");
      }
      return { name: r["name"], description: r["description"], filePath: r["filePath"], baseDir: r["baseDir"], disableModelInvocation: r["disableModelInvocation"] === true };
    }),
  };
}
