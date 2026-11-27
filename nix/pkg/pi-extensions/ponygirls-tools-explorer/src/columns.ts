/**
 * The columns of the tool list and which of them fit a pane width: the tool
 * and its state always, the token estimate and the source when there is room,
 * the description in whatever is left.
 */
import { sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";
import { MARKER_WIDTH, type Column } from "@ponygirls/pi-ui";
import { totalTokens, type ToolEntry } from "./catalog.ts";
import { displayLine } from "./display.ts";
import { originLabel } from "./origin.ts";
import { stateLabel, tokenText } from "./present.ts";

export const COLUMN_GAP = 2;
/** With less room than this the description column is dropped. */
export const MIN_DESCRIPTION_COLUMN = 20;
/** The narrowest a tool name gets when even the name and the state do not fit. */
const MIN_TOOL_COLUMN = 8;

export type ColumnId = "tool" | "state" | "tokens" | "source" | "description";
/** The columns whose width follows their content. */
type MeasuredColumn = Exclude<ColumnId, "description">;
export type ListCells = Readonly<Record<MeasuredColumn, string>>;

interface ColumnSpec {
  id: ColumnId;
  header: string;
  align: "left" | "right";
}

const COLUMNS: readonly ColumnSpec[] = [
  { id: "tool", header: "TOOL", align: "left" },
  { id: "state", header: "STATE", align: "left" },
  { id: "tokens", header: "TOKENS", align: "right" },
  { id: "source", header: "SOURCE", align: "left" },
  { id: "description", header: "DESCRIPTION", align: "left" },
];
/** What a pane too narrow for every column gives up, first to last; the tool and its state stay. */
const DROP_ORDER: readonly ColumnId[] = ["description", "source", "tokens"];

export interface ListLayout {
  shown: ColumnId[];
  columns: Column[];
  /** Names of the columns that did not fit. */
  hidden: string[];
}

/** `TOKENS` → `Tokens`, for the line that names hidden columns. */
function columnName(header: string): string {
  return `${header.slice(0, 1)}${header.slice(1).toLowerCase()}`;
}

/**
 * The columns that fit `width`. Measured columns are as wide as their widest
 * cell and are shown whole or not at all; the description takes the room that
 * is left. Only when the tool and its state alone do not fit is the name cut.
 */
export function listLayout(width: number, rows: readonly ListCells[], withSource: boolean): ListLayout {
  const specs = COLUMNS.filter((spec) => spec.id !== "source" || withSource);
  const widths = new Map<ColumnId, number>();
  for (const spec of specs) {
    if (spec.id !== "description") widths.set(spec.id, Math.max(visibleWidth(spec.header), ...rows.map((row) => visibleWidth(row[spec.id as MeasuredColumn]))));
  }
  const shown = new Set(specs.map((spec) => spec.id));
  // The description is not in `widths` yet, so this is also what is left for it.
  const taken = (): number => MARKER_WIDTH + [...shown].reduce((sum, id) => sum + (widths.get(id) ?? 0), 0) + COLUMN_GAP * (shown.size - 1);
  for (const id of DROP_ORDER) {
    if (!shown.has(id)) continue;
    if (id === "description" ? width - taken() >= MIN_DESCRIPTION_COLUMN : taken() <= width) continue;
    shown.delete(id);
  }
  if (shown.has("description")) widths.set("description", width - taken());
  else if (taken() > width) widths.set("tool", Math.max(MIN_TOOL_COLUMN, widths.get("tool")! - (taken() - width)));
  const kept = specs.filter((spec) => shown.has(spec.id));
  return {
    shown: kept.map((spec) => spec.id),
    columns: kept.map((spec) => ({ header: spec.header, width: widths.get(spec.id)!, align: spec.align })),
    hidden: specs.filter((spec) => !shown.has(spec.id)).map((spec) => columnName(spec.header)),
  };
}

/** Plain text cut to `width` columns before it is styled: cutting styled text would end the selection band. */
export function clip(text: string, width: number): string {
  return visibleWidth(text) <= width ? text : `${sliceByColumn(text, 0, Math.max(0, width - 1), true)}…`;
}

export function listCells(entry: ToolEntry): ListCells {
  return {
    tool: displayLine(entry.name),
    state: stateLabel(entry.state),
    tokens: tokenText(totalTokens(entry.cost)),
    source: displayLine(originLabel(entry.origin)),
  };
}
