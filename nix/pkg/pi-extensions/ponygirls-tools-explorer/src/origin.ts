/**
 * Where a tool comes from, as one short label per source: pi itself, an MCP
 * server, an extension or a package. The label groups the list; the complete
 * provenance record stays on the tool.
 */
import type { RegisteredTool } from "./registry.ts";

export type OriginKind = "built-in" | "sdk" | "extension" | "package" | "mcp";

export interface ToolOrigin {
  kind: OriginKind;
  /** Short name of the source, also the heading of its group. */
  label: string;
}

/** pi's `sourceInfo.source` for tools it ships, core tools and built-in extensions alike. */
const BUILTIN_SOURCE = "builtin";
/** pi's `sourceInfo.source` for tools passed to `createAgentSession`. */
const SDK_SOURCE = "sdk";
/** Namespaces of MCP servers are named `mcp__<server>`. */
const MCP_NAMESPACE_PREFIX = "mcp__";
const BUILT_IN_LABEL = "built-in";
const SDK_LABEL = "sdk";
const LABEL_SEPARATOR = " · ";
/** A Nix store entry is `<32-character hash>-<name>`. */
const NIX_STORE_ENTRY = /^[0-9a-z]{32}-(.+)$/;
const SCRIPT_SUFFIX = /\.[cm]?[jt]s$/;
const INDEX_STEM = "index";

/** Groups in list order: what pi ships, then what was added to it, then MCP servers. */
const KIND_ORDER: readonly OriginKind[] = ["built-in", "sdk", "extension", "package", "mcp"];

function segments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

function withoutStoreHash(name: string): string {
  const entry = NIX_STORE_ENTRY.exec(name);
  return entry === null ? name : entry[1]!;
}

/** `…/my-ext.ts` → `my-ext`; `…/my-ext/index.ts` → `my-ext`. */
function extensionName(path: string): string {
  const parts = segments(path);
  const file = parts[parts.length - 1];
  if (file === undefined) return path;
  const stem = file.replace(SCRIPT_SUFFIX, "");
  const directory = parts[parts.length - 2];
  return withoutStoreHash(stem === INDEX_STEM && directory !== undefined ? directory : stem);
}

/** A package source is a path or a specifier such as `npm:@scope/name@1.0.0`. */
function packageName(source: string): string {
  if (!source.startsWith("/")) return source;
  const parts = segments(source);
  const last = parts[parts.length - 1];
  return last === undefined ? source : withoutStoreHash(last);
}

export function originOf(tool: Pick<RegisteredTool, "namespace" | "provenance">): ToolOrigin {
  const { namespace, provenance } = tool;
  if (namespace !== null && namespace.name.startsWith(MCP_NAMESPACE_PREFIX)) {
    return { kind: "mcp", label: `mcp${LABEL_SEPARATOR}${namespace.name.slice(MCP_NAMESPACE_PREFIX.length)}` };
  }
  if (provenance.source === BUILTIN_SOURCE) return { kind: "built-in", label: BUILT_IN_LABEL };
  if (provenance.source === SDK_SOURCE) return { kind: "sdk", label: SDK_LABEL };
  if (provenance.origin === "package") return { kind: "package", label: packageName(provenance.source) };
  return { kind: "extension", label: extensionName(provenance.path) };
}

/** Code-unit order: the same on every machine, whatever its locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareOrigins(a: ToolOrigin, b: ToolOrigin): number {
  const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  return byKind !== 0 ? byKind : compareText(a.label, b.label);
}

export function sameOrigin(a: ToolOrigin, b: ToolOrigin): boolean {
  return a.kind === b.kind && a.label === b.label;
}
