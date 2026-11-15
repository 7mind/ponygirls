import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const derive = promisify(pbkdf2);
const ITERATIONS = 600000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

export async function passwordHash(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, ITERATIONS, KEY_BYTES, "sha256");
  return `pbkdf2-sha256$${ITERATIONS}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function passwordMatches(password, hash) {
  const parts = hash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || parts[1] !== String(ITERATIONS)) return false;
  const salt = Buffer.from(parts[2], "base64");
  const expected = Buffer.from(parts[3], "base64");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES || salt.toString("base64") !== parts[2] || expected.toString("base64") !== parts[3]) return false;
  const actual = await derive(password, salt, ITERATIONS, KEY_BYTES, "sha256");
  return timingSafeEqual(expected, actual);
}

export async function writePasswordHash(file, password) {
  await writeFile(file, `${await passwordHash(password)}\n`, { mode: 0o600 });
}
