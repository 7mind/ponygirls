import { homeRelative } from "@ponygirls/pi-ui";
import type { InventoryRow } from "../../context-rules/bridge.ts";
import type { PaneInventory } from "../view-contract.ts";

export function displayText(text: string): string {
  const limit = 8192;
  return text.slice(0, limit).replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) + (text.length > limit ? "…" : "");
}

export function displayPath(path: string, home: string): string {
  return displayText(homeRelative(path, home));
}

export function incomplete(count: number): string {
  return `${count} known file${count === 1 ? "" : "s"}; history incomplete`;
}

export function presentInventory({ mainPaths, subagents }: PaneInventory) {
  const agents = (subagents ?? []).map(agent => ({ ...agent, paths: [...new Set(agent.paths)] }));
  const ids = new Set(agents.map(a => a.agentId));
  const byParent = Map.groupBy(agents, a => a.parentId !== null && ids.has(a.parentId) ? a.parentId : null);
  const tree: { agent: InventoryRow; depth: number }[] = [];
  function visit(parent: string | null, depth: number) {
    for (const agent of byParent.get(parent) ?? []) {
      tree.push({ agent, depth });
      visit(agent.agentId, depth + 1);
    }
  }
  visit(null, 0);
  return {
    available: subagents !== undefined, complete: agents.every(a => a.complete), tree,
    main: [...new Set(mainPaths)], paths: [...new Set(agents.flatMap(a => a.paths))],
  };
}
