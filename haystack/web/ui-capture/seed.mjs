// Deterministic synthetic corpus for the UI capture harness. No real content:
// every title, description and field is generated from the word lists below.
export const PROJECTS = ["corporate-activity", "ponygirls", "bjork-yt", "search-quality", "ops-runbooks"];
export const ACTIVITY_PROJECT = "corporate-activity";
export const AUTHORS = ["op", "alice", "claude-agent", "codex-agent"];

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOUNS = ["index", "retention policy", "cursor", "token rotation", "embedding batch", "proxy timeout", "checkpoint", "shard", "replica lag", "query planner", "websocket heartbeat", "backfill", "schema migration", "rate limiter", "audit trail", "cache eviction", "session store", "deploy pipeline", "alert rule", "feature flag"];
const VERBS = ["Investigate", "Document", "Fix", "Rework", "Verify", "Prune", "Benchmark", "Migrate", "Audit", "Simplify", "Backfill", "Reproduce"];
const FACTS = ["is bounded by statement_timeout", "must be rotated every 90 days", "fails closed when the hash file is unreadable", "is invalidated on password replacement", "is compared in constant time", "uses canonical unpadded base64url", "is retained for 30 days", "never leaves the loopback interface"];
const TAGS = ["mcp", "auth", "urgent", "postgres", "ui", "perf", "security", "ops", "search", "ranking", "retention", "flaky-test", "docs", "infra", "yt", "nix", "scala", "native-image", "browser", "accounts"];
const LOREM = "The service validates every request at the boundary, records the attributed identity, and returns a typed fault for anything it cannot prove. Operators can inspect the effective configuration, replay a frozen payload, and compare revisions without leaving the dashboard.";

const pick = (r, list) => list[Math.floor(r() * list.length)];
const pad = (n, w) => String(n).padStart(w, "0");

function longMarkdown(r, title, size) {
  const sections = [];
  sections.push(`---\nname: ${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}\ndescription: ${title}\n---`);
  sections.push(`# ${title}\n\n${LOREM}`);
  for (let s = 0; s < size; s++) {
    sections.push(`## Step ${s + 1}: ${pick(r, VERBS)} the ${pick(r, NOUNS)}\n\n${LOREM} The ${pick(r, NOUNS)} ${pick(r, FACTS)}; see \`${pick(r, NOUNS).replace(/ /g, "_")}\` and **${pick(r, NOUNS)}**.\n\n- check ${pick(r, NOUNS)}\n- confirm ${pick(r, NOUNS)} ${pick(r, FACTS)}\n- record the outcome in a [runbook](https://example.invalid/runbooks/${s})`);
    if (s % 2 === 0) sections.push("```typescript\nconst limit = 20; // page size\nasync function load(cursor?: string): Promise<Page> {\n  const page = await api.search(query, { limit, cursor });\n  return page;\n}\n```");
    if (s % 3 === 0) sections.push("| Check | Expected | Observed |\n| --- | --- | --- |\n| digest | match | match |\n| latency p99 | < 200 ms | 143 ms |\n| lag | 0 | 0 |");
    if (s % 4 === 1) sections.push("> Note: this step is idempotent; repeating it never changes the committed revision.");
  }
  return sections.join("\n\n");
}

function codeField(r) {
  return { type: "code", language: pick(r, ["scala", "nix", "python", "bash", "json", "yaml"]), content: "def retry[A](attempts: Int)(op: => A): A =\n  try op\n  catch { case e: Exception if attempts > 1 => retry(attempts - 1)(op) }\n\nval cfg = Map(\"timeout\" -> 30, \"retries\" -> 3)\n" + "// padding line to give the block some height\n".repeat(12) };
}

const titleFor = (r, type, i) => {
  if (type === "github-issue") return `${pick(r, VERBS)} ${pick(r, NOUNS)} regression (issue #${1000 + i})`;
  if (type === "github-pr") return `${pick(r, VERBS)}: ${pick(r, NOUNS)} handling for large documents (PR #${2000 + i})`;
  if (type === "skill-draft") return `Skill: ${pick(r, VERBS).toLowerCase()} the ${pick(r, NOUNS)} safely`;
  if (type === "todo") return `${pick(r, VERBS)} ${pick(r, NOUNS)} before the next release`;
  return `${pick(r, NOUNS)[0].toUpperCase()}${pick(r, NOUNS).slice(1)} ${pick(r, FACTS)}`;
};

// Returns docs in dependency order (link targets precede sources).
export function buildCorpus({ count = 640 } = {}) {
  const r = mulberry32(20261117);
  const docs = [];
  const byProject = new Map(PROJECTS.map((p) => [p, []]));
  for (let i = 0; i < count; i++) {
    const project = i % 7 === 0 ? ACTIVITY_PROJECT : PROJECTS[1 + Math.floor(r() * (PROJECTS.length - 1))];
    let type;
    if (project === ACTIVITY_PROJECT) type = r() < 0.45 ? "github-issue" : r() < 0.7 ? "github-pr" : "skill-draft";
    else type = r() < 0.4 ? "fact" : r() < 0.7 ? "todo" : r() < 0.85 ? "decision" : r() < 0.93 ? "skill-draft" : "note";
    const item = `${type}-${pad(i, 4)}`;
    let title = titleFor(r, type, i);
    if (i % 41 === 5) title += " — " + "very long title segment that keeps going to exercise wrapping ".repeat(3).trim();
    if (i % 97 === 11) title = "UNBROKEN_IDENTIFIER_" + "x".repeat(110);
    const archived = r() < 0.1;
    const attention = !archived && r() < 0.14 ? "required" : "cleared";
    const importance = r() < 0.27 ? "high" : r() < 0.02 ? "critical" : "low";
    const tags = Array.from({ length: Math.floor(r() * 5.5) }, () => pick(r, TAGS)).filter((t, k, a) => a.indexOf(t) === k);
    if (i % 53 === 7) tags.push("an-exceptionally-long-tag-name-that-has-no-natural-break-points-at-all");
    const peers = byProject.get(project);
    const links = [];
    for (let k = 0, n = Math.floor(r() * 3.2); k < n && peers.length > 0; k++) links.push([pick(r, ["related-to", "motivated-by", "supersedes", "blocks"]), pick(r, peers)]);
    let fields = {};
    if (type === "skill-draft") fields = { skill: { type: "md", content: longMarkdown(r, title, 3 + Math.floor(r() * 9)) }, skill_name: title.slice(7, 40), triggers: ["after a failed deploy", "when the queue grows"] };
    else if (type === "github-issue" || type === "github-pr") fields = { url: `https://example.invalid/org/repo/${type === "github-pr" ? "pull" : "issues"}/${1000 + i}`, state: r() < 0.5 ? "open" : "closed", author: pick(r, AUTHORS), labels: ["bug", "ui"], body: { type: "md", content: longMarkdown(r, title, 1 + Math.floor(r() * 3)) } };
    else if (type === "fact" && i % 5 === 0) fields = { evidence: { type: "md", content: longMarkdown(r, title, 2) }, snippet: codeField(r), measured: { p50_ms: 12, p99_ms: 143, samples: 9007199254740993 } };
    else if (type === "todo") fields = { owner: pick(r, AUTHORS), due: "2026-12-01", checklist: ["reproduce", "fix", "verify"] };
    const description = i % 13 === 3 ? Array.from({ length: 6 }, () => LOREM).join("\n\n") : `${LOREM.slice(0, 80 + Math.floor(r() * 160))}`;
    const doc = { key: `${project}:${item}`, author: pick(r, AUTHORS), revisions: r() < 0.2 ? 2 + Math.floor(r() * 4) : 1,
      document: { title, description, fields, type, status: archived ? "archived" : "actual", importance, "human-attention": attention, links, tags } };
    docs.push(doc); peers.push(doc.key);
  }
  return docs;
}

// Fixed records the captures navigate to by key.
export const HERO = {
  skill: () => buildCorpus().find((d) => d.document.type === "skill-draft" && d.key.startsWith(ACTIVITY_PROJECT + ":") && JSON.stringify(d.document.fields).length > 6000),
};
