import type { InventoryRow } from "../context-rules/bridge.ts";

export interface PaneInventory {
  mainPaths: string[];
  subagents: InventoryRow[] | undefined;
}
