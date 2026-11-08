// The RITES_* run environment shared by the supervisor and the worker: the
// pinned Node and bubblewrap binaries, the Nix store root, the worker runtime
// dir (worker + tool-runner code with its SDK links), the explicit toolchain
// PATH, and the optional host resolver/CA files. Every path that must be
// visible inside the tool-runner sandbox is validated to resolve inside the
// Nix store; the worker runtime only needs to exist on the host.

import { realpathSync, statSync, type Stats } from "node:fs";

export interface RunEnvironment {
  readonly node: string;
  readonly bwrap: string;
  readonly nixStore: string;
  readonly workerRuntimeDir: string;
  readonly toolchainPath: string;
  readonly resolvConf: string | null;
  readonly hosts: string | null;
  readonly nsswitchConf: string | null;
  readonly caBundle: string | null;
}

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new EnvironmentError(`missing required environment ${name}`);
  }
  return value;
}

function statExisting(path: string, label: string, wantDirectory: boolean): string {
  let stats: Stats | undefined;
  try {
    stats = statSync(path);
  } catch {
    stats = undefined;
  }
  if (stats === undefined) {
    throw new EnvironmentError(`${label} is not accessible: ${path}`);
  }
  if (wantDirectory) {
    if (!stats.isDirectory()) {
      throw new EnvironmentError(`${label} is not a directory: ${path}`);
    }
  } else if (!stats.isFile()) {
    throw new EnvironmentError(`${label} is not a regular file: ${path}`);
  }
  return path;
}

function realpath(path: string, label: string): string {
  try {
    return realpathSync(path);
  } catch {
    throw new EnvironmentError(`${label} does not exist: ${path}`);
  }
}

function storeFile(path: string, nixStore: string, label: string): string {
  const resolved = realpath(statExisting(path, label, false), label);
  if (resolved !== nixStore && !resolved.startsWith(`${nixStore}/`)) {
    throw new EnvironmentError(`${label} must resolve inside ${nixStore}`);
  }
  return resolved;
}

function storeDirectory(path: string, nixStore: string, label: string): string {
  const resolved = realpath(statExisting(path, label, true), label);
  if (resolved !== nixStore && !resolved.startsWith(`${nixStore}/`)) {
    throw new EnvironmentError(`${label} must resolve inside ${nixStore}`);
  }
  return resolved;
}

function optionalHostFile(env: Record<string, string | undefined>, name: string, fallbackPath: string): string | null {
  const value = env[name];
  if (typeof value === "string" && value.length > 0) {
    return realpath(statExisting(value, name, false), name);
  }
  let stats: Stats | undefined;
  try {
    stats = statSync(fallbackPath);
  } catch {
    stats = undefined;
  }
  if (stats === undefined || !stats.isFile()) {
    return null;
  }
  return realpath(fallbackPath, name);
}

/**
 * Read and validate the RITES_* environment. Throws EnvironmentError with a
 * message safe for stderr; never includes environment values.
 */
export function loadRunEnvironment(env: Record<string, string | undefined>): RunEnvironment {
  const nixStoreEnv = env.RITES_NIX_STORE;
  const nixStore = typeof nixStoreEnv === "string" && nixStoreEnv.length > 0 ? nixStoreEnv : "/nix/store";
  const resolvedStore = realpath(nixStore, "RITES_NIX_STORE");
  const node = storeFile(required(env, "RITES_NODE"), resolvedStore, "RITES_NODE");
  const bwrap = storeFile(required(env, "RITES_BWRAP"), resolvedStore, "RITES_BWRAP");
  const workerRuntimeDir = realpath(
    statExisting(required(env, "RITES_WORKER_RUNTIME"), "RITES_WORKER_RUNTIME", true),
    "RITES_WORKER_RUNTIME",
  );
  statExisting(`${workerRuntimeDir}/worker/main.js`, "worker entry", false);
  const entries = required(env, "RITES_TOOLCHAIN_PATH")
    .split(":")
    .filter(entry => entry.length > 0)
    .map((entry, index) => storeDirectory(entry, resolvedStore, `RITES_TOOLCHAIN_PATH[${index}]`));
  if (entries.length === 0) {
    throw new EnvironmentError("RITES_TOOLCHAIN_PATH has no entries");
  }
  return {
    node,
    bwrap,
    nixStore: resolvedStore,
    workerRuntimeDir,
    toolchainPath: [...new Set(entries)].join(":"),
    resolvConf: optionalHostFile(env, "RITES_RESOLV_CONF", "/etc/resolv.conf"),
    hosts: optionalHostFile(env, "RITES_HOSTS", "/etc/hosts"),
    nsswitchConf: optionalHostFile(env, "RITES_NSSWITCH_CONF", "/etc/nsswitch.conf"),
    caBundle: optionalHostFile(env, "RITES_CA_BUNDLE", "/etc/ssl/certs/ca-certificates.crt"),
  };
}

/**
 * The tool-runner entry the worker's broker requires; absent in supervisor
 * stub runtimes, so only the real worker validates it.
 */
export function validateToolRunnerEntry(environment: RunEnvironment): string {
  return statExisting(`${environment.workerRuntimeDir}/worker/tool-runner.js`, "tool-runner entry", false);
}
