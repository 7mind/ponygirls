/**
 * Loading a tool adds it to pi's active set, as the built-in tool search
 * does for deferred tools; unloading takes it out. Any tool can be switched
 * except one registered as hidden. Either change takes effect with the next
 * request. pi silently drops names it will not activate, so each change is
 * read back before it is reported.
 */
import { buildCatalog, canLoad, canUnload, findEntry, isActive, type ToolEntry } from "./catalog.ts";
import type { ToolRegistry } from "./registry.ts";

export type Refusal =
  /** No tool of that name is registered. */
  | "unknown-tool"
  /** Registered as hidden: pi never activates it. */
  | "hidden"
  | "already-active"
  | "not-active"
  /** pi left the tool out of the active set, as it does for an MCP tool the session's `--tools` list excludes. */
  | "not-activated"
  /** pi kept the tool in the active set. */
  | "not-deactivated";

export type ActivationResult =
  | { kind: "loaded"; entry: ToolEntry }
  | { kind: "unloaded"; entry: ToolEntry }
  | { kind: "refused"; name: string; reason: Refusal };

export class ToolActivation {
  private readonly registry: ToolRegistry;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  load(name: string): ActivationResult {
    const snapshot = this.registry.snapshot();
    const entry = findEntry(buildCatalog(snapshot), name);
    if (entry === null) return { kind: "refused", name, reason: "unknown-tool" };
    if (!canLoad(entry)) return { kind: "refused", name, reason: isActive(entry) ? "already-active" : "hidden" };
    this.registry.setActive([...snapshot.active, name]);
    const loaded = findEntry(buildCatalog(this.registry.snapshot()), name);
    return loaded !== null && isActive(loaded) ? { kind: "loaded", entry: loaded } : { kind: "refused", name, reason: "not-activated" };
  }

  unload(name: string): ActivationResult {
    const snapshot = this.registry.snapshot();
    const entry = findEntry(buildCatalog(snapshot), name);
    if (entry === null) return { kind: "refused", name, reason: "unknown-tool" };
    if (!canUnload(entry)) return { kind: "refused", name, reason: "not-active" };
    this.registry.setActive(snapshot.active.filter((active) => active !== name));
    const unloaded = findEntry(buildCatalog(this.registry.snapshot()), name);
    return unloaded !== null && !isActive(unloaded) ? { kind: "unloaded", entry: unloaded } : { kind: "refused", name, reason: "not-deactivated" };
  }
}
