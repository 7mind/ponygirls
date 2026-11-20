import { spawnSync } from "node:child_process";

const DARWIN_STAT = /^[ RUSITH?Z][<N]?X?E?V?L?s?\+? *$/;

export function processState(pid: number): "dead" | "zombie" | "live" {
  if (!Number.isInteger(pid) || pid <= 1) throw new Error(`Invalid fixture pid: ${pid}`);
  const ps = spawnSync("ps", ["-p", String(pid), "-o", "pid=", "-o", "stat="], { encoding: "utf8", timeout: 1000 });
  if (ps.error) throw ps.error;
  const row = /^ *(\d+) ([^\r\n]+)\n$/.exec(ps.stdout);
  if (ps.status === 0 && !ps.stderr && row && row[1] === String(pid)) {
    const field = row[2]!;
    if (process.platform === "darwin") {
      if (DARWIN_STAT.test(field)) return field[0] === "Z" ? "zombie" : "live";
    } else {
      const state = field.trim();
      if (/^[A-Za-z]\S*$/.test(state)) return /^[ZX]/.test(state) ? "zombie" : "live";
    }
  }
  if (!ps.stdout.trim() && !ps.stderr && (ps.status === 0 || ps.status === 1)) {
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return "dead"; throw error; }
  }
  throw new Error(`Cannot observe fixture pid ${pid}: ps exited ${ps.status}: stdout=${JSON.stringify(ps.stdout)} stderr=${JSON.stringify(ps.stderr)}`);
}
