import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJsonPreferences<T>(path: string, missing: () => T, validate: (value: unknown) => T, description: string): T {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return missing();
    throw error;
  }
  try {
    const value: unknown = JSON.parse(text);
    return validate(value);
  } catch (error) {
    throw new Error(`Invalid ${description} in ${path}: ${String(error)}`);
  }
}

export function writeJsonPreferences(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
