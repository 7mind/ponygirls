import { statSync } from "node:fs";

export interface AccessDirectory { path: string; dev: string; ino: string; birth: string }
export function directoryIdentity(path: string): AccessDirectory {
  const st = statSync(path, { bigint: true });
  if (!st.isDirectory()) throw new Error("Expected a directory");
  return { path, dev: String(st.dev), ino: String(st.ino), birth: String(st.birthtimeNs) };
}
export interface ContextFile { path: string; content: string }
export const DISCOVERY_KEYS = ["nested", "worktree", "parent", "global"] as const;
export type Discovery = Record<typeof DISCOVERY_KEYS[number], boolean>;
export const DISCOVERY_OFF: Readonly<Discovery> = Object.freeze({ nested: false, worktree: false, parent: false, global: false });
export function nestedRuleText(file: ContextFile): string {
  return `Instructions from ${file.path}:\n${file.content}\n`;
}
