/**
 * One tool as lines for the pane: its facts (state first), its description,
 * the lines it adds to the system prompt and its parameters; or its
 * declaration as JSON. Every tool-supplied string passes `displayText` or
 * `displayLine` before it is styled.
 */
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { MARKER_WIDTH, formatCount, stateColor, type UiFg, type UiTheme } from "@ponygirls/pi-ui";
import type { ToolCatalog, ToolEntry } from "./catalog.ts";
import { displayJson, displayLine, displayText } from "./display.ts";
import { costFacts, hintFacts, sourceFactsOf, stateFacts, stateTone } from "./present.ts";
import { outlineParameters, type ParameterList, type ParameterRow } from "./schema.ts";

export interface DetailView {
  theme: UiTheme;
  width: number;
  /** Paths under it are shown as `~/…`. */
  home: string;
}

const GUTTER = " ".repeat(MARKER_WIDTH);
/** Text under a section heading. */
const BODY_INDENT = " ".repeat(MARKER_WIDTH * 2);
/** The rows of one shape of a parameter union. */
const SHAPE_INDENT = " ".repeat(MARKER_WIDTH * 3);
const FACT_GAP = 2;
const FACT_SEPARATOR = " · ";
/** A narrower value column moves each value under its label. */
const MIN_FACT_VALUE_WIDTH = 16;
/** Columns of the parameter table; a longer name or type gets a row of its own shape. */
const MAX_NAME_COLUMN = 24;
const MAX_TYPE_COLUMN = 28;
const PARAMETER_GAP = "  ";
/** A narrower description column moves each description under its parameter. */
const MIN_PARAMETER_DESCRIPTION = 24;
const REQUIRED_MARK = " *";
const JSON_INDENT = 2;
/** The key of the pane that shows the declaration as JSON; named where the outline cannot show a schema. */
export const JSON_VIEW_KEY = "v";

interface Fact {
  label: string;
  /** The first part answers; the rest explains it. */
  parts: readonly string[];
  lead: UiFg;
}

function heading(theme: UiTheme, title: string, meta: string | null): string {
  return `${GUTTER}${theme.bold(theme.fg("accent", title))}${meta === null ? "" : `${PARAMETER_GAP}${theme.fg("dim", meta)}`}`;
}

/** Text under a heading, wrapped to the pane; the text's own line breaks stay. */
function bodyText(view: DetailView, text: string, color: UiFg): string[] {
  const room = Math.max(1, view.width - BODY_INDENT.length);
  return displayText(text).split("\n").flatMap((line) => (line === "" ? [""] : wrapTextWithAnsi(view.theme.fg(color, line), room).map((part) => `${BODY_INDENT}${part}`)));
}

function factLines(view: DetailView, facts: readonly Fact[]): string[] {
  const { theme, width } = view;
  const labelWidth = Math.max(0, ...facts.map((fact) => visibleWidth(fact.label)));
  const column = MARKER_WIDTH + labelWidth + FACT_GAP;
  const stacked = width - column < MIN_FACT_VALUE_WIDTH;
  const indent = stacked ? BODY_INDENT : " ".repeat(column);
  const room = Math.max(1, width - indent.length);
  return facts.flatMap((fact) => {
    const value = fact.parts.map((part, index) => theme.fg(index === 0 ? fact.lead : "muted", part)).join(theme.fg("dim", FACT_SEPARATOR));
    const label = theme.fg("dim", fact.label);
    const lines = wrapTextWithAnsi(value, room);
    if (stacked) return [`${GUTTER}${label}`, ...lines.map((line) => `${indent}${line}`)];
    const pad = " ".repeat(labelWidth - visibleWidth(fact.label) + FACT_GAP);
    return lines.map((line, index) => (index === 0 ? `${GUTTER}${label}${pad}${line}` : `${indent}${line}`));
  });
}

function facts(entry: ToolEntry, catalog: ToolCatalog, home: string): Fact[] {
  const hints = hintFacts(entry);
  return [
    { label: "State", parts: stateFacts(entry, catalog.reach), lead: stateColor(stateTone(entry)) },
    { label: "Source", parts: sourceFactsOf(entry, home), lead: "text" },
    { label: "Tokens", parts: costFacts(entry, catalog.basis, catalog.model), lead: "text" },
    ...(hints === null ? [] : [{ label: "Hints", parts: hints, lead: "text" as const }]),
    ...(entry.differsFromRegistered ? [{ label: "Note", parts: ["shown as declared to the model", "the registered definition differs"], lead: "text" as const }] : []),
    ...(entry.nonTextDescription ? [{ label: "Note", parts: ["the registered description is not text", "shown as JSON"], lead: "text" as const }] : []),
  ];
}

function requiredSummary(list: ParameterList): string {
  return list.required === 0 ? "none required" : list.required === list.total ? "all required" : `${formatCount(list.required)} required (*)`;
}

/** The rows the outline shows, and a line for those it left to the JSON view. */
function listRows(view: DetailView, list: ParameterList, indent: string): string[] {
  const rest = list.total - list.rows.length;
  const more = rest === 0 ? [] : [`${indent}${view.theme.fg("dim", `… ${formatCount(rest)} more; ${JSON_VIEW_KEY} shows the JSON`)}`];
  return [...parameterRows(view, list.rows, indent), ...more];
}

/** A table of name, type and description; a row that does not fit its columns puts the description below. */
function parameterRows(view: DetailView, rows: readonly ParameterRow[], indent: string): string[] {
  const { theme, width } = view;
  const names = rows.map((row) => `${displayLine(row.name)}${row.required ? REQUIRED_MARK : ""}`);
  const types = rows.map((row) => displayLine(row.type));
  const nameWidth = Math.min(MAX_NAME_COLUMN, Math.max(0, ...names.map((name) => visibleWidth(name))));
  const typeWidth = Math.min(MAX_TYPE_COLUMN, Math.max(0, ...types.map((type) => visibleWidth(type))));
  const descriptionColumn = indent.length + nameWidth + PARAMETER_GAP.length + typeWidth + PARAMETER_GAP.length;
  const descriptionRoom = width - descriptionColumn;
  const below = `${indent}${PARAMETER_GAP}`;
  return rows.flatMap((row, index) => {
    const name = names[index]!;
    const type = types[index]!;
    const description = row.description === null ? "" : displayLine(row.description);
    const styledName = theme.fg("text", name);
    const styledType = theme.fg("muted", type);
    if (visibleWidth(name) <= nameWidth && visibleWidth(type) <= typeWidth && descriptionRoom >= MIN_PARAMETER_DESCRIPTION) {
      const head = `${indent}${styledName}${" ".repeat(nameWidth - visibleWidth(name))}${PARAMETER_GAP}${styledType}`;
      if (description === "") return [head];
      const pad = " ".repeat(typeWidth - visibleWidth(type) + PARAMETER_GAP.length);
      return wrapTextWithAnsi(theme.fg("muted", description), descriptionRoom)
        .map((line, lineIndex) => (lineIndex === 0 ? `${head}${pad}${line}` : `${" ".repeat(descriptionColumn)}${line}`));
    }
    const head = wrapTextWithAnsi(`${styledName}${PARAMETER_GAP}${styledType}`, Math.max(1, width - indent.length)).map((line) => `${indent}${line}`);
    const text = description === "" ? [] : wrapTextWithAnsi(theme.fg("muted", description), Math.max(1, width - below.length)).map((line) => `${below}${line}`);
    return [...head, ...text];
  });
}

function parameterLines(view: DetailView, entry: ToolEntry): string[] {
  const { theme } = view;
  const outline = outlineParameters(entry.definition.parameters);
  switch (outline.kind) {
    case "none":
      return [heading(theme, "Parameters", null), ...bodyText(view, "The tool takes no parameters.", "muted")];
    case "opaque":
      return [heading(theme, "Parameters", null), ...bodyText(view, `The outline cannot show this schema; ${JSON_VIEW_KEY} shows it as JSON.`, "muted")];
    case "object":
      return [heading(theme, "Parameters", `${formatCount(outline.total)} · ${requiredSummary(outline)}`), ...listRows(view, outline, BODY_INDENT)];
    case "union": {
      const rest = outline.total - outline.shapes.length;
      // The count of distinct parameters is over the shapes shown, so a cut union does not state one.
      const meta = rest === 0 ? `${formatCount(outline.parameters)} · one of ${formatCount(outline.total)} shapes`
        : `one of ${formatCount(outline.total)} shapes · ${formatCount(outline.shapes.length)} shown`;
      return [
        heading(theme, "Parameters", meta),
        ...outline.shapes.flatMap((shape) => [
          `${BODY_INDENT}${theme.bold(theme.fg("text", displayLine(shape.label)))}${PARAMETER_GAP}${theme.fg("dim", requiredSummary(shape))}`,
          ...listRows(view, shape, SHAPE_INDENT),
        ]),
        ...(rest === 0 ? [] : [`${BODY_INDENT}${theme.fg("dim", `… ${formatCount(rest)} more shapes; ${JSON_VIEW_KEY} shows the JSON`)}`]),
      ];
    }
  }
}

function promptLines(view: DetailView, entry: ToolEntry): string[] {
  const { snippet, guidelines } = entry.promptLines;
  if (snippet === null && guidelines.length === 0) return [];
  const sent = entry.cost.promptLines > 0 ? "in the system prompt while the tool is declared" : "not sent: a custom system prompt replaces the tool list and the rules";
  const lines = [...(snippet === null ? [] : [`- ${entry.name}: ${snippet}`]), ...guidelines.map((guideline) => `- ${guideline}`)];
  return ["", heading(view.theme, "Prompt lines", sent), ...lines.flatMap((line) => bodyText(view, line, "text"))];
}

/** Facts, description, prompt lines and parameters of one tool. */
export function outlineLines(entry: ToolEntry, catalog: ToolCatalog, view: DetailView): string[] {
  const description = entry.definition.description.trim() === "" ? bodyText(view, "The tool has no description.", "muted") : bodyText(view, entry.definition.description, "text");
  return [
    ...factLines(view, facts(entry, catalog, view.home)),
    "",
    heading(view.theme, "Description", null),
    ...description,
    ...promptLines(view, entry),
    "",
    ...parameterLines(view, entry),
  ].map((line) => truncateToWidth(line, view.width, ""));
}

/** The declaration the token estimate measures, pretty-printed and safe to draw. */
export function declarationJson(entry: ToolEntry): string {
  const { name, description, parameters } = entry.definition;
  return displayJson(JSON.stringify({ name, description, parameters }, null, JSON_INDENT));
}

/** Highlighted JSON lines wrapped to the pane. */
export function jsonLines(highlighted: readonly string[], width: number): string[] {
  const room = Math.max(1, width - MARKER_WIDTH);
  // The gutter alone can take a pane a few columns wide.
  return highlighted.flatMap((line) => (line === "" ? [""] : wrapTextWithAnsi(line, room))).map((line) => truncateToWidth(`${GUTTER}${line}`, width, ""));
}
