/**
 * /tools outside the terminal UI: the catalog as plain text, one line per
 * source or one per tool that a filter selects.
 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { formatCount } from "@ponygirls/pi-ui";
import { totalTokens, type ToolCatalog } from "./catalog.ts";
import { displayLine } from "./display.ts";
import { originLabel } from "./origin.ts";
import { basisLine, shareText, stateLabel, tokenText } from "./present.ts";
import { selectTools, summarize } from "./query.ts";

interface TextColumn {
  header: string;
  align: "left" | "right";
}

const COLUMN_GAP = "  ";
/** A zero in a table. */
const QUIET_ZERO = "·";
const NO_TOOLS = "No tools are registered in this session.";

function table(columns: readonly TextColumn[], rows: readonly (readonly string[])[]): string[] {
  const widths = columns.map((column, index) => Math.max(visibleWidth(column.header), ...rows.map((row) => visibleWidth(row[index]!))));
  const line = (cells: readonly string[]): string => cells.map((cell, index) => {
    const pad = " ".repeat(widths[index]! - visibleWidth(cell));
    return columns[index]!.align === "right" ? `${pad}${cell}` : `${cell}${pad}`;
  }).join(COLUMN_GAP).trimEnd();
  return [line(columns.map((column) => column.header)), ...rows.map(line)];
}

function quiet(value: number, text: string): string {
  return value === 0 ? QUIET_ZERO : text;
}

/** The totals, then every source with its tools and what they cost. */
export function summaryReport(catalog: ToolCatalog): string {
  const summary = summarize(catalog);
  if (summary.all === 0) return NO_TOOLS;
  const share = summary.windowShare === null || catalog.model === null ? "" : ` (${shareText(summary.windowShare, catalog.model)})`;
  const totals = [
    `${formatCount(summary.all)} registered`,
    `${formatCount(summary.active)} active, ${tokenText(summary.chargedTokens)} tok${share}`,
    `${formatCount(summary.inactive)} inactive, ${tokenText(summary.inactiveTokens)} tok if loaded`,
  ].join(" · ");
  const rows = summary.sources.map((source) => [
    displayLine(originLabel(source.origin)),
    formatCount(source.tools),
    quiet(source.active, formatCount(source.active)),
    quiet(source.chargedTokens, tokenText(source.chargedTokens)),
    tokenText(source.allTokens),
  ]);
  const columns: TextColumn[] = [
    { header: "SOURCE", align: "left" }, { header: "TOOLS", align: "right" }, { header: "ACTIVE", align: "right" },
    { header: "ACTIVE TOK", align: "right" }, { header: "ALL TOK", align: "right" },
  ];
  return [`Tools: ${totals}`, basisLine(catalog.basis, catalog.model), "", ...table(columns, rows)].join("\n");
}

/** The tools whose name, source or description has every word of `filter`. */
export function toolsReport(catalog: ToolCatalog, filter: string): string {
  if (catalog.entries.length === 0) return NO_TOOLS;
  const tools = selectTools(catalog, { tab: "all", sort: "source", filter });
  const shown = displayLine(filter);
  if (tools.length === 0) return `No tool matches "${shown}" (${formatCount(catalog.entries.length)} registered).`;
  const rows = tools.map((entry) => [displayLine(entry.name), stateLabel(entry.state), tokenText(totalTokens(entry.cost)), displayLine(originLabel(entry.origin))]);
  const columns: TextColumn[] = [
    { header: "TOOL", align: "left" }, { header: "STATE", align: "left" }, { header: "TOKENS", align: "right" }, { header: "SOURCE", align: "left" },
  ];
  return [
    `Tools matching "${shown}": ${formatCount(tools.length)} of ${formatCount(catalog.entries.length)}`,
    basisLine(catalog.basis, catalog.model),
    "",
    ...table(columns, rows),
  ].join("\n");
}
