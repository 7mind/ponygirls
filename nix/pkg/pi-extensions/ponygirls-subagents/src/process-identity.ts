/**
 * ponygirls-subagents — process identity for lock ownership and recovery.
 *
 * A Linux process is identified by pid + boot id + start time: a pid alone
 * can be reused, and a start time alone is meaningless across boots. Never
 * signal a process whose recorded identity does not match the live one.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** /proc/<pid>/stat field 22 (starttime), counted after the parenthesised comm. */
const STAT_STARTTIME_INDEX = 19;
const KILL_POLL_MS = 50;

export interface ProcessIdentity {
  bootId: string;
  starttime: string;
}

type Observation = ProcessIdentity | "dead" | "unknown";
const BOOT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BIRTH = process.platform === "darwin" ? /^[1-9]\d*\.\d{6}$/ : /^\d+$/;

function valid(identity: ProcessIdentity): boolean {
  return typeof identity.bootId === "string" && BOOT_UUID.test(identity.bootId) && typeof identity.starttime === "string" && BIRTH.test(identity.starttime);
}

function observe(pid: number): Observation {
  if (!Number.isInteger(pid) || pid <= 1 || pid > 0x7fffffff) return "unknown";
  try {
    let identity: ProcessIdentity;
    if (process.platform === "darwin") {
      const helper = fileURLToPath(new URL("../darwin-process-info", import.meta.url));
      const output = execFileSync(helper, ["pid", String(pid)], { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "pipe"] });
      if (output === "dead\n") return "dead";
      const fields = /^(\S+) (\S+)\n$/.exec(output);
      if (!fields) return "unknown";
      identity = { bootId: fields[1]!, starttime: fields[2]! };
    } else if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(") ");
      if (!stat.startsWith(`${pid} (`) || close < 0) return "unknown";
      const rest = stat.slice(close + 2).split(" ");
      const starttime = rest[STAT_STARTTIME_INDEX] ?? "";
      if (!/^\d+$/.test(starttime) || !/^[RSDZTtXxKWPI]$/.test(rest[0] ?? "")) return "unknown";
      if (rest[0] === "Z" || rest[0] === "X" || rest[0] === "x") return "dead";
      identity = { bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), starttime };
    } else return "unknown";
    return valid(identity) ? identity : "unknown";
  } catch {
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return "dead"; }
    return "unknown";
  }
}

export function readProcessIdentity(pid: number): ProcessIdentity | null {
  const live = observe(pid);
  return typeof live === "string" ? null : live;
}

export type OwnershipVerdict = "dead" | "live-match" | "live-mismatch" | "unknown";

export function verifyOwnership(pid: number, recorded: ProcessIdentity | null): OwnershipVerdict {
  const live = observe(pid);
  if (typeof live === "string") return live;
  if (!recorded || !valid(recorded)) return "unknown";
  if (live.bootId !== recorded.bootId || live.starttime !== recorded.starttime) return "live-mismatch";
  return "live-match";
}

/** SIGKILL a verified owned process and wait until it is gone (or a zombie). */
export async function killAndConfirm(pid: number, recorded: ProcessIdentity | null, timeoutMs = 5000): Promise<OwnershipVerdict> {
  const owner = verifyOwnership(pid, recorded);
  if (owner !== "live-match" || process.platform !== "linux") return owner;
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "unknown";
  }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const current = verifyOwnership(pid, recorded);
    if (current === "dead" || current === "live-mismatch") return current;
    await new Promise((r) => setTimeout(r, KILL_POLL_MS));
  }
  return "unknown";
}
