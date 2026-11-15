import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { passwordHash, passwordMatches } from "./credentials.mjs";

async function ownedDirectory(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.uid !== process.getuid()) throw new Error("Preview state must be an owned directory, not a symbolic link");
  return stat;
}

async function createDirectory(directory) {
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  return ownedDirectory(directory);
}

async function namespaceParent(directory, anchor) {
  if (!path.isAbsolute(directory) || directory !== path.resolve(directory) || !path.isAbsolute(anchor) || anchor !== path.resolve(anchor) || await realpath(anchor) !== anchor) throw new Error("Preview namespace requires canonical paths and a trusted anchor");
  const relative = path.relative(anchor, directory);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Preview namespace must be beneath its trusted anchor");
  let parent = anchor;
  for (const component of relative.split(path.sep).slice(0, -1)) {
    parent = path.join(parent, component);
    await createDirectory(parent);
  }
}

function checkFile(stat) {
  if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1) throw new Error("Preview state files must be privately owned regular files");
}

async function readOwnedFile(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try { checkFile(await handle.stat()); return await handle.readFile("utf8"); }
  finally { await handle.close(); }
}

async function privateFile(file, create) {
  let handle;
  let created = false;
  try {
    handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    created = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  }
  try {
    checkFile(await handle.stat());
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

function validSecret(text) {
  return /^[A-Za-z0-9_-]{43}\n$/.test(text) && Buffer.from(text.trimEnd(), "base64url").toString("base64url") === text.trimEnd();
}

export async function preparePreviewState(directory, port, anchor) {
  if (!path.isAbsolute(directory) || !Number.isInteger(port) || port < 1 || port > 65435) throw new Error("Absolute preview directory and valid port required");
  await namespaceParent(directory, anchor);
  await createDirectory(directory);
  const marker = path.join(directory, "state.json");
  const pgData = path.join(directory, "pg");
  const tokenFile = path.join(directory, "token.txt");
  const expected = JSON.stringify({ version: 1, port }) + "\n";
  if (await exists(marker)) {
    if (await readOwnedFile(marker) !== expected) throw new Error("Preview state belongs to another version or port; refusing reuse");
  } else {
    if (await exists(pgData)) throw new Error("Unrecognized existing preview database; preserve it and inspect it manually");
    if ((await readdir(directory)).some(name => name !== "token.txt")) throw new Error("Unrecognized existing preview state; refusing adoption");
    if (await exists(tokenFile) && !validSecret(await readOwnedFile(tokenFile))) throw new Error("Invalid saved preview credential; refusing replacement");
  }
  await chmod(directory, 0o700);
  const saved = await privateFile(marker, async () => expected);
  if (saved !== expected) throw new Error("Preview state belongs to another version or port; refusing reuse");
  const passwordFile = path.join(directory, "password.txt");
  const passwordHashFile = path.join(directory, "password.hash");
  const secret = async file => {
    const text = await privateFile(file, async () => randomBytes(32).toString("base64url") + "\n");
    if (!validSecret(text)) throw new Error("Invalid saved preview credential; refusing replacement");
    return text.trimEnd();
  };
  await secret(tokenFile);
  const password = await secret(passwordFile);
  const hash = await privateFile(passwordHashFile, async () => await passwordHash(password) + "\n");
  if (!await passwordMatches(password, hash.trimEnd())) throw new Error("Saved preview password and hash differ; refusing to invalidate existing sessions");
  if (await exists(pgData)) { await ownedDirectory(pgData); await chmod(pgData, 0o700); }
  await privateFile(path.join(directory, "README.md"), async () => "# Haystack preview state\n\nPrivate credentials, PostgreSQL demo data, and durable browser sessions for this port.\nRestart quick-ui.sh with the same port to reuse them. Stop the launcher before changing\nthis directory. Removing it deliberately resets demo data and every preview session.\nThe retained token.txt is an API seed credential, never a browser cookie.\n");
  return { pgData, tokenFile, passwordFile, passwordHashFile };
}

export async function reservePreviewState(directory, anchor) {
  await namespaceParent(directory, anchor);
  await mkdir(directory, { mode: 0o700 });
  const stat = await ownedDirectory(directory);
  return { dev: stat.dev, ino: stat.ino };
}

export async function removeStoppedPreviewState(directory, ownership) {
  if (!await exists(directory)) return;
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.dev !== ownership.dev || stat.ino !== ownership.ino) throw new Error(`Preview cleanup ownership changed; preserve ${directory}`);
  if (await exists(path.join(directory, "launcher.lock")) || await exists(path.join(directory, "pg", "postmaster.pid"))) throw new Error(`Preview shutdown unconfirmed; preserve ${directory}`);
  await rm(directory, { recursive: true, force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePreviewState(path.resolve(process.argv[2]), Number(process.argv[3]), path.resolve(process.argv[4]));
}
