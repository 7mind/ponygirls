import { constants } from "node:fs";
import { chmod, lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { passwordHash, passwordMatches } from "./credentials.mjs";

async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid()) throw new Error("Preview state must be an owned directory, not a symbolic link");
  await chmod(directory, 0o700);
}

async function privateFile(file, create) {
  let handle;
  let created = false;
  try {
    handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1) throw new Error("Preview state files must be privately owned regular files");
    await handle.chmod(0o600);
    if (created) {
      const content = await create();
      await handle.writeFile(content);
      return content;
    }
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}

async function exists(file) {
  try { await lstat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export async function preparePreviewState(directory, port) {
  if (!path.isAbsolute(directory) || !Number.isInteger(port) || port < 1 || port > 65435) throw new Error("Absolute preview directory and valid port required");
  await privateDirectory(directory);
  const marker = path.join(directory, "state.json");
  const pgData = path.join(directory, "pg");
  if (!await exists(marker) && await exists(pgData)) throw new Error("Unrecognized existing preview database; preserve it and inspect it manually");
  const identity = { version: 1, port };
  const saved = await privateFile(marker, async () => JSON.stringify(identity) + "\n");
  if (saved !== JSON.stringify(identity) + "\n") throw new Error("Preview state belongs to another version or port; refusing reuse");
  const tokenFile = path.join(directory, "token.txt");
  const passwordFile = path.join(directory, "password.txt");
  const passwordHashFile = path.join(directory, "password.hash");
  const secret = async file => {
    const text = await privateFile(file, async () => randomBytes(32).toString("base64url") + "\n");
    if (!/^[A-Za-z0-9_-]{43}\n$/.test(text) || Buffer.from(text.trimEnd(), "base64url").toString("base64url") !== text.trimEnd()) throw new Error("Invalid saved preview credential; refusing replacement");
    return text.trimEnd();
  };
  await secret(tokenFile);
  const password = await secret(passwordFile);
  const hash = await privateFile(passwordHashFile, async () => await passwordHash(password) + "\n");
  if (!await passwordMatches(password, hash.trimEnd())) throw new Error("Saved preview password and hash differ; refusing to invalidate existing sessions");
  if (await exists(pgData)) await privateDirectory(pgData);
  await privateFile(path.join(directory, "README.md"), async () => "# Haystack preview state\n\nPrivate credentials, PostgreSQL demo data, and durable browser sessions for this port.\nRestart quick-ui.sh with the same port to reuse them. Stop the launcher before changing\nthis directory. Removing it deliberately resets demo data and every preview session.\nThe retained token.txt is an API seed credential, never a browser cookie.\n");
  return { pgData, tokenFile, passwordFile, passwordHashFile };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePreviewState(path.resolve(process.argv[2]), Number(process.argv[3]));
}
