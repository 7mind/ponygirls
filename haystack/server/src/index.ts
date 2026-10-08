// Haystack production entrypoint (Step 8): static file config → auth,
// migrate → listen. Readiness is established before the socket opens:
// migration failure or config rejection fails startup, never serves stale.
import express from "express";
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { createApp } from "./http/server.js";
import { loadAuth, type HaystackConfig } from "./auth/config.js";
import { PgItemRepository } from "./storage/postgres.js";
import { migrate } from "./storage/migrate.js";
import { SystemClock } from "./application/clock.js";
import { LiveUpdates } from "./http/live.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`haystack: ${name} is required`);
    process.exit(2);
  }
  return value;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, "..");
const uiDir = process.env.HAYSTACK_STATIC_DIR ?? path.resolve(serverRoot, "..", "web", "dist");

async function main(): Promise<void> {
  const authJson = JSON.parse(await readFile(required("HAYSTACK_AUTH_JSON"), "utf-8")) as HaystackConfig;
  // systemd LoadCredential paths arrive via $CREDENTIALS_DIRECTORY, which is
  // a runtime env dir (not a store path): expand the fixed prefix here.
  const credsDir = process.env.CREDENTIALS_DIRECTORY ?? "";
  const resolved: HaystackConfig = {
    ...authJson,
    users: authJson.users.map((user) => ({
      ...user,
      tokens: user.tokens.map((token) => {
        if (!token.hashFile.startsWith("$CREDENTIALS_DIRECTORY")) return token;
        if (!credsDir) {
          console.error("haystack: CREDENTIALS_DIRECTORY is required for credential paths");
          process.exit(2);
        }
        return { ...token, hashFile: credsDir + token.hashFile.slice("$CREDENTIALS_DIRECTORY".length) };
      }),
    })),
  };
  const auth = await loadAuth(resolved);
  const databaseUrl = required("HAYSTACK_DATABASE_URL");
  const pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.HAYSTACK_POOL_MAX ?? "8") });
  try {
    await migrate(pool, auth.activityProjectId);
  } catch (err) {
    console.error(`haystack: migration failed: ${(err as Error).message}`);
    await pool.end();
    process.exit(1);
  }
  await pool.end();
  const repo = new PgItemRepository(databaseUrl, Number(process.env.HAYSTACK_POOL_MAX ?? "8"));
  const updates = new LiveUpdates(() => auth);
  const app = createApp({ getAuth: () => auth, repo, clock: new SystemClock(), updates });
  // Bundled UI (content-hashed assets; the shell carries no item data).
  app.use(express.static(uiDir, { index: "index.html", maxAge: 0 }));
  const listenAddr = process.env.HAYSTACK_LISTEN ?? "127.0.0.1";
  const port = Number(process.env.HAYSTACK_PORT ?? "47328");
  const server = http.createServer(app);
  updates.attach(server);
  await new Promise<void>((resolve) => server.listen(port, listenAddr, resolve));
  console.log(`haystack listening on ${listenAddr}:${port}`);

  // Graceful drain: stop accepting, finish in-flight, then close the pool.
  const shutdown = (signal: string) => {
    console.log(`haystack: ${signal}, draining`);
    updates.close();
    server.close(() => {
      void repo.close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 15000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

await main();
