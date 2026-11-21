import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function processRows(...columns: string[]): string[] {
  return execFileSync("ps", ["-A", "-ww", ...columns.flatMap((c) => ["-o", `${c}=`])], { encoding: "utf8" }).trimEnd().split("\n");
}

export function supervisorsForSidecar(sidecar: string): number[] {
  const pids: number[] = [];
  for (const row of processRows("pid", "command")) {
    const match = /^\s*(\d+)\s+.*\/supervisor\.py --sidecar (.+?) --session-id /.exec(row);
    if (match?.[2] === sidecar) pids.push(Number(match[1]));
  }
  return pids;
}

export function supervisorPid(sidecar: string): number {
  const pids = supervisorsForSidecar(sidecar);
  assert.equal(pids.length, 1, `expected one supervisor for ${sidecar}, found ${pids.join(", ")}`);
  return pids[0]!;
}
