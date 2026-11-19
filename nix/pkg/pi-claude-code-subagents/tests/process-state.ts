import { spawnSync } from "node:child_process";

export function processState(pid: number): "dead" | "zombie" | "live" {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`Invalid fixture pid: ${pid}`);
  const ps = spawnSync("ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8", timeout: 1000 });
  if (ps.error) throw ps.error;
  const state = ps.stdout.trim();
  if (ps.status === 0 && /^[A-Za-z]\S*$/.test(state)) return /^[ZX]/.test(state) ? "zombie" : "live";
  if (!state && !ps.stderr.trim() && (ps.status === 0 || ps.status === 1)) {
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return "dead"; throw error; }
  }
  throw new Error(`Cannot observe fixture pid ${pid}: ps exited ${ps.status}: ${state} ${ps.stderr}`);
}
