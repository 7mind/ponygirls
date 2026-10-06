/**
 * ponygirls-subagents — process identity for lock ownership and recovery.
 *
 * A Linux process is identified by pid + boot id + start time: a pid alone
 * can be reused, and a start time alone is meaningless across boots. Never
 * signal a process whose recorded identity does not match the live one.
 */

import { readFileSync } from "node:fs";

/** /proc/<pid>/stat field 22 (starttime), counted after the parenthesised comm. */
const STAT_STARTTIME_INDEX = 19;
const KILL_POLL_MS = 50;

export interface ProcessIdentity {
  bootId: string;
  starttime: string;
}

export function readBootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return "unknown";
  }
}

export function readProcessIdentity(pid: number): ProcessIdentity | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    // Fields after comm start at field 3 (state), so field N is index N - 3.
    const rest = stat.slice(close + 2).split(" ");
    if (rest[0] === "Z" || rest[0] === "X") return null; // zombie/dead: not a live owner
    const starttime = rest[STAT_STARTTIME_INDEX] ?? "";
    if (!starttime) return null;
    return { bootId: readBootId(), starttime };
  } catch {
    return null;
  }
}

export type OwnershipVerdict = "dead" | "live-match" | "live-mismatch" | "unknown";

export function verifyOwnership(pid: number, recorded: ProcessIdentity | null): OwnershipVerdict {
  const live = readProcessIdentity(pid);
  if (!live) return "dead";
  if (!recorded || recorded.bootId === "unknown") return "unknown";
  if (live.bootId !== recorded.bootId || live.starttime !== recorded.starttime) return "live-mismatch";
  return "live-match";
}

/** SIGKILL a verified owned process and wait until it is gone (or a zombie). */
export async function killAndConfirm(pid: number, timeoutMs = 5000): Promise<boolean> {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return true; // already gone
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (readProcessIdentity(pid) === null) return true;
    await new Promise((r) => setTimeout(r, KILL_POLL_MS));
  }
  return false;
}
