// Process-tree enumeration and teardown shared by the supervisor (over the
// whole worker tree) and the tool broker (over one tool-runner sandbox).

import { readFileSync } from "node:fs";
import process from "node:process";
import { KILL_GRACE_MS } from "./bounds.js";

/**
 * All descendant pids of `pid`, breadth-first, or an empty list when the
 * process is gone. Reading /proc/<pid>/task/<pid>/children works across PID
 * namespaces, which is how sandbox payload pids are addressed from the host.
 */
export function descendantPids(pid: number | undefined): number[] {
  if (pid === undefined) {
    return [];
  }
  const found: number[] = [];
  const queue: number[] = [pid];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    let children = "";
    try {
      children = readFileSync(`/proc/${current}/task/${current}/children`, "utf8");
    } catch {
      children = "";
    }
    for (const token of children.trim().split(/\s+/)) {
      if (token.length === 0) {
        continue;
      }
      const childPid = Number.parseInt(token, 10);
      if (Number.isInteger(childPid) && childPid > 0) {
        found.push(childPid);
        queue.push(childPid);
      }
    }
  }
  return found;
}

export function signalPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // The process may have exited between enumeration and the signal.
    }
  }
}

/**
 * Signal a whole process group. Children reparented to init after their
 * parent died remain reachable through their process group, unlike a
 * descendant walk; the walk still covers processes that created their own
 * session.
 */
export function signalProcessGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch {
    // The group may have fully exited already.
  }
}

export interface Killable {
  readonly pid?: number | undefined;
  kill(signal: NodeJS.Signals): void;
}

/**
 * One-shot teardown of a spawned process tree: SIGTERM to the root and
 * every descendant, then after the grace window SIGKILL to every remaining
 * process and the root itself. Firing twice is a no-op; dispose() cancels
 * the escalation when the tree closed on its own.
 */
export class TreeKiller<T extends Killable> {
  private fired = false;
  private escalation: NodeJS.Timeout | undefined;

  constructor(private readonly child: T) {}

  fire(): void {
    if (this.fired) {
      return;
    }
    this.fired = true;
    const roots: number[] = this.child.pid === undefined ? [] : [this.child.pid];
    for (const root of roots) {
      signalProcessGroup(root, "SIGTERM");
    }
    signalPids([...roots, ...descendantPids(this.child.pid)], "SIGTERM");
    this.escalation = setTimeout(() => {
      for (const root of roots) {
        signalProcessGroup(root, "SIGKILL");
      }
      signalPids([...roots, ...descendantPids(this.child.pid)], "SIGKILL");
      try {
        this.child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }, KILL_GRACE_MS);
  }

  dispose(): void {
    if (this.escalation !== undefined) {
      clearTimeout(this.escalation);
      this.escalation = undefined;
    }
  }
}
