import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface PreferenceStore {
  readonly path: string;
  read(): boolean;
  write(enabled: boolean): void;
}

export class FilePreferenceStore implements PreferenceStore {
  readonly path: string;
  constructor(path: string) { this.path = path; }

  read(): boolean {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value) ||
        !("version" in value) || value.version !== 1 || !("enabled" in value) || typeof value.enabled !== "boolean") {
      throw new Error(`Invalid context archive preference in ${this.path}; expected {"version":1,"enabled":boolean}`);
    }
    return value.enabled;
  }

  write(enabled: boolean): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify({ version: 1, enabled })}\n`, { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.path);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
