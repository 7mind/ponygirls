// Haystack storage: ordered migration runner with ledger + advisory lock.
// Migration failure (or schema mismatch) fails startup — never recreates data.
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

/** Locate the migrations dir by walking up from this module: dist and
 *  dist-test layouts both resolve (server/dist|dist-test → server/). */
export function findMigrationsDir(from: string = path.dirname(new URL(import.meta.url).pathname)): string {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "migrations");
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new MigrationFault(`migrations dir not found above ${from}`);
}

export const MIGRATIONS_DIR = findMigrationsDir();

export class MigrationFault extends Error {
  readonly code = "migration-failed";
  constructor(message: string) {
    super(message);
    this.name = "MigrationFault";
  }
}

export class ActivityMismatchFault extends Error {
  readonly code = "activity-mismatch";
  constructor(expected: string, stored: string) {
    super(`activityProjectId ${expected} does not match stored ${stored}`);
    this.name = "ActivityMismatchFault";
  }
}

/** Apply pending migrations, then reconcile the authoritative activity
 *  namespace (insert on first init; mismatch fails startup). */
export async function migrate(pool: Pool, activityProjectId: string, dir: string = MIGRATIONS_DIR): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('haystack-migrate'))");
    try {
      const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        const version = file.replace(/\.sql$/, "");
        const applied = await client.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]).catch(
          (err: Error & { code?: string }) => {
            // schema_migrations itself comes from 0001-initial.sql.
            if (err.code === "42P01") return { rows: [] };
            throw err;
          },
        );
        if (applied.rows.length > 0) continue;
        const sql = await readFile(path.join(dir, file), "utf-8");
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw new MigrationFault(`migration ${version} failed: ${(err as Error).message}`);
        }
      }
      await reconcileActivity(client, activityProjectId);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext('haystack-migrate'))");
    }
  } finally {
    client.release();
  }
}

async function reconcileActivity(client: PoolClient, activityProjectId: string): Promise<void> {
  const res = await client.query("SELECT activity_project_id FROM store_metadata WHERE id = 1");
  if (res.rows.length === 0) {
    await client.query("INSERT INTO store_metadata (id, activity_project_id) VALUES (1, $1)", [activityProjectId]);
    return;
  }
  const stored = res.rows[0]!.activity_project_id as string;
  if (stored !== activityProjectId) throw new ActivityMismatchFault(activityProjectId, stored);
}
