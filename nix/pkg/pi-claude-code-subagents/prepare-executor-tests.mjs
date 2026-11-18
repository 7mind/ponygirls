import { chmod, cp, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const [upstream, addon, output] = process.argv.slice(2);
if (!upstream || !addon || !output) throw new Error("upstream, addon and output paths are required");
for (const name of ["src", "tests", "package.json", "tsconfig.json"]) await cp(join(upstream, name), join(output, name), { recursive: true });
async function writable(path) {
  await chmod(path, 0o755);
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await writable(child);
    else if (entry.isFile()) await chmod(child, 0o644);
  }
}
await writable(output);
await cp(join(addon, "executor"), join(output, "src"), { recursive: true });
await cp(join(addon, "src/execution-lifecycle.ts"), join(output, "src/execution-lifecycle.ts"));
await writeFile(join(output, "tests/native-cleanup-fault.test.ts"), (await readFile(join(addon, "tests/native-cleanup-fault.test.ts"), "utf8")).replaceAll("../executor/", "../src/"));
const cli = join(output, "src/claude-cli.ts");
await writeFile(cli, await readFile(cli, "utf8") + `\nconst testExecutor = new ClaudeExecutor();
export const runClaudeRequest = (input: RunClaudeInput): Promise<RunClaudeOutput> => testExecutor.runClaudeRequest(input);
export const closeClaudeProcesses = (sessionId?: string): Promise<void> => testExecutor.closeClaudeProcesses(sessionId);
export const cachedClaudeProcessCount = (): number => testExecutor.cachedClaudeProcessCount();
`);
