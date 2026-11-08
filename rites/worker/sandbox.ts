// Bubblewrap command construction for the Rites tool-runner sandbox. The
// repository agent never runs here: only one built-in tool execution per
// invocation. The sandbox is a fresh root with a minimal /dev, a
// namespace-scoped /proc, tmpfs /tmp, /run and HOME, the Nix store
// read-only, the worker runtime read-only (SDK code only), and the workspace
// read-write. The operator model config is deliberately NOT bound: the model
// credential must never be visible to repository code or tool output.
// Networking stays shared (regular outbound networking); user, PID, IPC and
// UTS namespaces are unshared so no host process state or ambient
// credentials leak in (--clearenv drops NODE_OPTIONS, NODE_PATH,
// LD_PRELOAD, BASH_ENV and everything else).

export interface ToolRunnerSandboxConfig {
  readonly bwrap: string;
  readonly node: string;
  readonly nixStore: string;
  readonly workspace: string;
  readonly workerRuntimeDir: string;
  readonly toolchainPath: string;
  readonly resolvConf: string | null;
  readonly hosts: string | null;
  readonly nsswitchConf: string | null;
  readonly caBundle: string | null;
}

export const SANDBOX_WORKSPACE = "/workspace";
export const SANDBOX_WORKER_RUNTIME = "/rites-worker";
export const SANDBOX_HOME = "/home/rites-worker";
export const SANDBOX_CA_BUNDLE = "/etc/rites/ca-bundle.crt";

/**
 * The full bubblewrap argument vector for one tool-runner invocation. Pure:
 * no paths are resolved or validated here; the broker does that before
 * calling. `toolName` is the built-in tool name (read, bash, ...) and
 * `remainingMs` the tool-runner's own abort budget.
 */
export function toolRunnerArgs(config: ToolRunnerSandboxConfig, toolName: string, remainingMs: number): string[] {
  const args: string[] = [
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--die-with-parent",
    "--clearenv",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/run",
    "--ro-bind",
    config.nixStore,
    "/nix/store",
    "--ro-bind",
    config.workerRuntimeDir,
    SANDBOX_WORKER_RUNTIME,
    "--bind",
    config.workspace,
    SANDBOX_WORKSPACE,
    "--tmpfs",
    SANDBOX_HOME,
  ];
  if (config.resolvConf !== null) {
    args.push("--ro-bind", config.resolvConf, "/etc/resolv.conf");
  }
  if (config.hosts !== null) {
    args.push("--ro-bind", config.hosts, "/etc/hosts");
  }
  if (config.nsswitchConf !== null) {
    args.push("--ro-bind", config.nsswitchConf, "/etc/nsswitch.conf");
  }
  if (config.caBundle !== null) {
    args.push("--ro-bind", config.caBundle, SANDBOX_CA_BUNDLE);
  }
  args.push(
    "--setenv",
    "HOME",
    SANDBOX_HOME,
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "PATH",
    config.toolchainPath,
    "--setenv",
    "GIT_CONFIG_GLOBAL",
    "/dev/null",
    "--setenv",
    "GIT_CONFIG_SYSTEM",
    "/dev/null",
    "--setenv",
    "PI_TELEMETRY",
    "0",
    "--setenv",
    "PI_SKIP_VERSION_CHECK",
    "1",
  );
  if (config.caBundle !== null) {
    args.push("--setenv", "SSL_CERT_FILE", SANDBOX_CA_BUNDLE);
  }
  args.push(
    "--chdir",
    SANDBOX_WORKSPACE,
    "--",
    config.node,
    `${SANDBOX_WORKER_RUNTIME}/worker/tool-runner.js`,
    toolName,
    String(remainingMs),
  );
  return args;
}
