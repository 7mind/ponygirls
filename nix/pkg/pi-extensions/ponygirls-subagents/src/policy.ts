/**
 * ponygirls-subagents — root authority and grant intersection.
 *
 * pi exposes no universal inherited approval/sandbox policy, so the
 * extension defines an explicit user-owned SupervisorPolicy. Delegation
 * computes:
 *
 *   delegable = root grants ∩ owner delegable grants ∩ requested profile
 *
 * before binding concrete filesystem views. Repository identities are
 * registered by the supervisor; a model-supplied path is never a grant.
 * Prompt text, model output, and copied session metadata are not grants.
 *
 * Fixed profiles:
 * - reader: read/grep/find/ls; no write/edit/bash, no project code execution.
 * - writer: reader reads plus write/edit/bash in its writer workspace.
 *
 * Isolation (see Isolation in types.ts) is chosen per child and never
 * decreases down the tree. Registered repositories, read roots, and
 * tool-job network denial bound sandboxed agents only; host-isolated
 * agents ("none", "worktree") run with the user's own authority.
 *
 * A workspace directory the caller prepares is the one path a spawn may
 * name; it is accepted only inside a root this policy lists.
 */

import { err } from "./errors.ts";
import { DEFAULT_LIMITS, type SchedulerLimits } from "./scheduler.ts";
import { ISOLATION_LEVELS, type AgentProfile, type GrantSet, type Isolation, type RepoGrant } from "./types.ts";

export const READER_TOOLS = ["read", "grep", "find", "ls"] as const;
export const WRITER_TOOLS = ["read", "grep", "find", "ls", "write", "edit", "bash"] as const;

/** Tools the worker proxy layer may ever expose. Closed set. */
export const KNOWN_PROXY_TOOLS = ["read", "grep", "find", "ls", "write", "edit", "bash"] as const;

/** Pinned Pi 1.1.0 builtin tools beyond the seven worker proxies (never delegable). */
export const PINNED_BUILTINS_EXTRA = ["powershell"] as const;

/** Child control/delegation and gate tools: never delegable via allowedTools. */
export const RESERVED_CHILD_TOOLS = [
  "send_message",
  "wait_agent",
  "list_agents",
  "read_agent",
  "spawn_agent",
  "interrupt_agent",
  "close_agent",
  "submit_gate_decision",
  "manage_gate",
] as const;

export interface SupervisorPolicy {
  revision: number;
  /**
   * Maximum tree depth (root = 0 children at depth 1). Default 1. The only
   * depth limit: grant intersection enforces it; the scheduler has none.
   */
  maxDepth: number;
  /** Whether any nesting is permitted at all. */
  nesting: boolean;
  /** Registered repositories: the only writable/readable origins. */
  repos: RegisteredRepo[];
  /** Models a child may be assigned by explicit override (children inherit their owner's otherwise). Null allows every model (no allowlist check). */
  allowedModels: Array<{ provider: string; id: string }> | null;
  /** Whether gate bypass is permitted by the governor. */
  gateBypassAllowed: boolean;
  /** Round ceiling; null permits unlimited agreement rounds. */
  gateMaxRoundsCeiling: number | null;
  /** Tool-job network default (deny unless an explicit grant allows). */
  toolNetwork: boolean;
  /**
   * Generic explicit full-name allowlist for governing-session external tools
   * (MCP etc). Patterns match full tool names with `*` as full-name glob
   * (other regex punctuation escaped, no implicit rewriting, no +/- grammar).
   * Default empty: no external delegation. Concrete names are resolved
   * against the governing session's current callable tools at each edge.
   */
  allowedTools: string[];
  /**
   * Pooled writer-worktree root (absolute host path) or null for the
   * default `<agentBaseDir>/subagents/<sessionId>/worktrees` layout.
   * When set, writer worktrees allocate under
   * `<worktreeRoot>/<sessionId>/worktrees/...` (cross-session separation).
   * Session/log/IPC/tmp dirs stay under the session root; saved allocations
   * keep their recorded absolute paths (no migration). The directory must
   * exist and be writable; when pi runs inside the yolo sandbox it must
   * additionally be listed in
   * `smind.hm.dev.llm.yolo.extraReadWritePaths` (missing paths are skipped
   * there, never created persistently). Never a store path: a literal
   * absolute string.
   */
  worktreeRoot: string | null;
  /** Directories a caller-prepared workspace must lie inside (absolute paths). Empty: none is accepted. */
  workspaceRoots: string[];
  /** Whether the governing session's own checkout may be assigned as a prepared workspace. */
  workspaceOwnerCheckoutAllowed: boolean;
}

export interface RegisteredRepo {
  repoId: string;
  /** Canonical checkout path (supervisor side, never mounted writable). */
  checkoutPath: string;
  /** Read roots derivable for children. */
  readRoots: string[];
  /** Writers allowed for this repo. */
  allowWriters: boolean;
}

export interface GrantRequest {
  profile: AgentProfile;
  isolation: Isolation;
  repoId: string | null;
  shell: boolean;
  network: boolean;
  model: { provider: string; id: string } | null;
  depth: number;
}

export function defaultSupervisorPolicy(): SupervisorPolicy {
  return {
    revision: 1,
    maxDepth: 1,
    nesting: false,
    repos: [],
    allowedModels: [],
    gateBypassAllowed: false,
    gateMaxRoundsCeiling: 3,
    toolNetwork: false,
    allowedTools: [],
    worktreeRoot: null,
    workspaceRoots: [],
    workspaceOwnerCheckoutAllowed: false,
  };
}

/** A tool name that allowedTools can never grant (built-in/control/delegation). */
export function isReservedToolName(name: string): boolean {
  return (
    (KNOWN_PROXY_TOOLS as readonly string[]).includes(name) ||
    (PINNED_BUILTINS_EXTRA as readonly string[]).includes(name) ||
    (RESERVED_CHILD_TOOLS as readonly string[]).includes(name)
  );
}

/**
 * Validate a configured allowedTools list. Fails visibly (never silently
 * discards) on malformed lists/patterns: non-array, non-string or empty
 * entries. Patterns are full names with optional `*` globs; leading `+`/`-`
 * is literal (no plus/minus grammar).
 */
export function validateAllowedTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw err("INVALID", "allowedTools must be an array of full tool-name patterns");
  return (raw as unknown[]).map((entry, i) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw err("INVALID", `allowedTools[${i}] must be a nonempty full tool-name pattern`);
    }
    return entry;
  });
}

/**
 * Validate a configured worktreeRoot. Absent (undefined) or null keeps the
 * default home layout. A present string must be a non-empty absolute path
 * with no NUL byte (a literal absolute string, never a store path).
 * Anything else fails visibly (INVALID), never a silent home fallback.
 */
export function validateWorktreeRoot(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw.length === 0 || !raw.startsWith("/") || raw.includes("\0")) {
    throw err("INVALID", "worktreeRoot must be null or an absolute path");
  }
  return raw;
}

/**
 * Upper bounds for the configurable scheduler limits. Each runnable agent is
 * a full pi worker process, so these only reject absurd values; host CPU,
 * memory, and provider rate limits set the practical ceiling.
 */
export const SCHEDULER_LIMIT_MAXIMA: SchedulerLimits = {
  maxRunnable: 64,
  maxResidentWorkers: 128,
  maxOpenAgents: 1024,
};

const SCHEDULER_LIMIT_KEYS = ["maxRunnable", "maxResidentWorkers", "maxOpenAgents"] as const;

/**
 * Validate the policy file's scheduler limits. An absent key keeps its
 * default; a present one must be an integer from 1 to its maximum. Limits
 * that could never bind fail too: a runnable agent holds a resident worker
 * and every resident worker is an open identity, so
 * maxRunnable <= maxResidentWorkers <= maxOpenAgents.
 */
export function validateSchedulerLimits(raw: Partial<Record<keyof SchedulerLimits, unknown>>): SchedulerLimits {
  const limits: SchedulerLimits = { ...DEFAULT_LIMITS };
  for (const key of SCHEDULER_LIMIT_KEYS) {
    const value = raw[key];
    if (value === undefined) continue;
    const max = SCHEDULER_LIMIT_MAXIMA[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
      throw err("INVALID", `policy ${key} must be an integer from 1 to ${max}; got ${JSON.stringify(value)}`);
    }
    limits[key] = value;
  }
  if (limits.maxRunnable > limits.maxResidentWorkers) {
    throw err("INVALID", `policy maxRunnable (${limits.maxRunnable}) must not exceed maxResidentWorkers (${limits.maxResidentWorkers}): each running agent holds a resident worker`);
  }
  if (limits.maxResidentWorkers > limits.maxOpenAgents) {
    throw err("INVALID", `policy maxResidentWorkers (${limits.maxResidentWorkers}) must not exceed maxOpenAgents (${limits.maxOpenAgents}): each resident worker belongs to an open identity`);
  }
  return limits;
}

/** Compile one full-name `*` glob (all other regex punctuation escaped). */
export function compileAllowedPattern(pattern: string): RegExp {
  const parts = pattern.split("*").map((chunk) => chunk.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${parts.join(".*")}$`);
}

/** Whether a concrete tool name matches any allowlist pattern. */
export function matchesAllowedTool(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => compileAllowedPattern(pattern).test(name));
}

/**
 * Resolve root-approved concrete capabilities: available governing tool names
 * filtered by allowlist patterns, excluding reserved built-in/control names
 * even when a wildcard matches them. Preserves available order.
 */
export function resolveAllowedConcrete(available: readonly string[], patterns: readonly string[]): string[] {
  if (patterns.length === 0) return [];
  return available.filter((name) => !isReservedToolName(name) && matchesAllowedTool(name, patterns));
}

/**
 * Intersect root authority, owner delegable grants, and the requested
 * profile. Returns the concrete GrantSet or a POLICY_DENIED error.
 * Every tree edge re-runs this; a child can never widen authority.
 */
export function intersectGrants(
  policy: SupervisorPolicy,
  owner: GrantSet | null,
  request: GrantRequest,
  /** Root-approved concrete external names at this edge (re-resolved, never cached widening). */
  rootExternalConcrete: readonly string[] = [],
): { ok: true; grants: GrantSet } | { ok: false; error: ReturnType<typeof err> } {
  if (request.depth > policy.maxDepth) {
    return { ok: false, error: err("POLICY_DENIED", `depth ${request.depth} exceeds maxDepth ${policy.maxDepth}`) };
  }
  if (request.depth > 1 && !policy.nesting) {
    return { ok: false, error: err("POLICY_DENIED", "nesting is disabled by root policy") };
  }
  const tools = request.profile === "reader" ? [...READER_TOOLS] : [...WRITER_TOOLS];
  if (owner) {
    for (const t of tools) {
      if (!owner.tools.includes(t)) {
        return { ok: false, error: err("POLICY_DENIED", `owner lacks delegable tool ${t}`) };
      }
    }
    if (request.shell && !owner.shell) {
      return { ok: false, error: err("POLICY_DENIED", "owner lacks delegable shell authority") };
    }
    if (request.network && !owner.network) {
      return { ok: false, error: err("POLICY_DENIED", "owner lacks delegable network authority") };
    }
    if (request.depth > owner.maxDepth) {
      return { ok: false, error: err("POLICY_DENIED", "request exceeds owner delegable depth") };
    }
    if (request.depth > 1 && !owner.nesting) {
      return { ok: false, error: err("POLICY_DENIED", "owner holds no delegation grant") };
    }
    if (ISOLATION_LEVELS.indexOf(request.isolation) < ISOLATION_LEVELS.indexOf(owner.isolation)) {
      return { ok: false, error: err("POLICY_DENIED", `owner runs with isolation ${owner.isolation}; a child cannot be less isolated (${request.isolation})`) };
    }
  }
  if (request.profile === "reader" && request.shell) {
    return { ok: false, error: err("POLICY_DENIED", "reader profile cannot hold shell authority") };
  }
  if (request.network && !policy.toolNetwork) {
    return { ok: false, error: err("POLICY_DENIED", "tool-job network denied by root policy") };
  }
  let repos: RepoGrant[] = [];
  if (request.isolation !== "sandbox") {
    if (request.repoId !== null) {
      return { ok: false, error: err("INVALID", "repo_id applies to sandbox isolation only") };
    }
    // Host-isolated agents keep their owner's repository grants (reads only
    // for readers) so they can still delegate sandboxed work.
    repos = (owner ?? rootGrants(policy)).repos.map((r) => ({ repoId: r.repoId, read: r.read, write: r.write && request.profile === "writer" }));
  } else if (request.repoId !== null) {
    const reg = policy.repos.find((r) => r.repoId === request.repoId);
    if (!reg) {
      return { ok: false, error: err("POLICY_DENIED", `unknown repository ${request.repoId}`) };
    }
    if (request.profile === "writer" && !reg.allowWriters) {
      return { ok: false, error: err("POLICY_DENIED", `repository ${request.repoId} denies writers`) };
    }
    const ownerRepo = owner?.repos.find((r) => r.repoId === request.repoId);
    if (owner && !ownerRepo) {
      return { ok: false, error: err("POLICY_DENIED", `owner holds no grant for repository ${request.repoId}`) };
    }
    if (ownerRepo && request.profile === "writer" && !ownerRepo.write) {
      return { ok: false, error: err("POLICY_DENIED", "owner holds no writer grant for repository") };
    }
    repos = [{ repoId: reg.repoId, read: true, write: request.profile === "writer" }];
  } else if (request.profile === "writer") {
    return { ok: false, error: err("POLICY_DENIED", "a sandboxed writer requires an approved repository (repo_id)") };
  }
  if (request.model && policy.allowedModels !== null) {
    const allowed = policy.allowedModels.some(
      (m) => m.provider === request.model!.provider && m.id === request.model!.id,
    );
    if (!allowed) {
      return { ok: false, error: err("POLICY_DENIED", `model ${request.model.provider}/${request.model.id} not in root allowlist`) };
    }
  }
  // External delegation: sandbox never gains parent external capabilities;
  // host children intersect owner delegable names with current root-concrete.
  // Reviewers are stripped at exposure (childTools) and execution time.
  let externalTools: string[] = [];
  if (request.isolation !== "sandbox") {
    const rootConcrete = rootExternalConcrete.filter((t) => !isReservedToolName(t));
    const ownerExternal = owner ? (owner.externalTools ?? []) : rootConcrete;
    externalTools = ownerExternal.filter((t) => rootConcrete.includes(t) && !isReservedToolName(t));
  }
  return {
    ok: true,
    grants: {
      tools,
      externalTools,
      repos,
      shell: request.profile === "writer" && request.shell,
      network: request.network && policy.toolNetwork,
      nesting: policy.nesting,
      maxDepth: Math.min(policy.maxDepth, owner?.maxDepth ?? policy.maxDepth),
      isolation: request.isolation,
    },
  };
}

/** Root agent's own grants: full policy authority bounded by registration. */
export function rootGrants(policy: SupervisorPolicy, rootExternalConcrete: readonly string[] = []): GrantSet {
  return {
    tools: [...KNOWN_PROXY_TOOLS],
    externalTools: rootExternalConcrete.filter((t) => !isReservedToolName(t)),
    repos: policy.repos.map((r) => ({ repoId: r.repoId, read: true, write: r.allowWriters })),
    shell: true,
    network: policy.toolNetwork,
    nesting: policy.nesting,
    maxDepth: policy.maxDepth,
    isolation: "none",
  };
}

/** Whether `path` is `root` or lies beneath it (lexical: both are resolved paths). */
export function pathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * A caller-prepared workspace is denied unless it lies inside an allowed
 * root. Both sides are resolved by the caller (symlinks followed), so a
 * link cannot place a workspace outside the roots it appears under.
 */
export function authorizeWorkspace(
  allowedRoots: string[],
  workspace: string,
): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
  if (allowedRoots.some((root) => pathWithin(workspace, root))) return { ok: true };
  return { ok: false, error: err("POLICY_DENIED", `workspace ${workspace} lies outside the policy's workspaceRoots`) };
}

/** Validate a proxy tool name against caller authority (post-transform). */
export function authorizeTool(
  grants: GrantSet,
  toolName: string,
): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
  if (!(KNOWN_PROXY_TOOLS as readonly string[]).includes(toolName)) {
    return { ok: false, error: err("POLICY_DENIED", `unknown tool ${toolName}`) };
  }
  if (!grants.tools.includes(toolName)) {
    return { ok: false, error: err("POLICY_DENIED", `tool ${toolName} not granted to caller`) };
  }
  return { ok: true };
}

/** Validate an external (governing-session) tool name against caller grants. */
export function authorizeExternalTool(
  grants: GrantSet,
  toolName: string,
): { ok: true } | { ok: false; error: ReturnType<typeof err> } {
  if (isReservedToolName(toolName)) {
    return { ok: false, error: err("POLICY_DENIED", `tool ${toolName} is never delegable via allowedTools`) };
  }
  if (!(grants.externalTools ?? []).includes(toolName)) {
    return { ok: false, error: err("POLICY_DENIED", `tool ${toolName} not granted to caller`) };
  }
  return { ok: true };
}
