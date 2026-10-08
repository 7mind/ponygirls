# Haystack — GitHub accounting contract (frozen, Step 0)

Normative freeze of plan §9. Agents file via `gh`/tielu API on the trusted
`api.github.com` endpoint only. Memory write and GitHub write are not one
transaction: identical retries are replay-safe, but a crash between the two
services can leave a filed artifact unrecorded. That boundary is documented
to agents, not papered over.

## 1. Canonical node identity

After filing, resolve through version-pinned GraphQL with header
`X-Github-Next-Global-ID: 1`:

```graphql
query ($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issueOrPullRequest(number: $number) { __typename id }
  }
}
```

- Canonical node ID = returned opaque `id` **exactly** (never the input,
  REST, or legacy ID; never a prefix).
- Kind: `Issue` → `issue`, `PullRequest` → `pr`. Anything else → stop,
  report, do not mint a key.
- Only `github.com` in v1. Other hosts need a separate trusted-host
  contract. Never forward credentials to a host/redirect from a stored URL.

## 2. Deterministic complete key

```
item_component = "github-issue-<digest>" | "github-pr-<digest>"
digest = SHA-256 hex (64 lowercase chars, no truncation) of the UTF-8
  canonical JSON array ["github-artifact-v1", "github.com", kind, node_id]
complete_key = encode(activityProjectId) + ":" + item_component
```

Canonical JSON here = `model.md` §3.6 rules (all-string array; opaque node
ID preserved exactly). Namespace is always the server-authoritative
`activityProjectId` (from `whoami`), never local project knowledge.
Project context links to the accounting record; no second copy.

Synthetic vectors (node IDs stand in: real lookups frozen at
implementation time against fixtures, never live):

- `["github-artifact-v1","github.com","issue","I_example123"]`
  → `0f0471cc3cbdb2a4495cf96e0a8289679a161dc9efbb07865a85f4f21683821b`
  → key `agent-activity:github-issue-0f0471cc…821b`
- `["github-artifact-v1","github.com","pr","PR_example456"]`
  → `9b2b3a5640113ffd8e8bbee2a33dc270fe0870d2cc17d0633916eb3dd179f098`
  → key `agent-activity:github-pr-9b2b3a56…179f098`

(Digests computed with `sha256sum` over exact bytes, 2026-10-07. Independent
clients with different URL spellings/renames that resolve to the same node
ID derive the same key.)

## 3. Record shape and write discipline

- `type: github-issue|github-pr`, `status: actual`,
  `human-attention: required` (on first write), importance from evidence
  (not default-high).
- `fields.github`: canonical HTTPS URL (display/provenance only — strip
  tracking/fragments, validate host/path), kind, node ID, identity-format
  version (`github-artifact-v1`), sanitized public title/summary, affected
  version/commit, external state/time when known. Memory archive status ≠
  GitHub open/closed state.
- On existing key: verify stored kind/node ID first. Different/missing
  identity = collision fault — never overwrite. Preserve human edits and
  cleared attention on retries; renewed attention only for genuinely new
  material developments with a stated reason.
- If GitHub creation succeeded but identity resolution/memory write failed:
  keep a sanitized URL + pending-resolution payload, report incomplete
  accounting, do NOT re-file. Never mint a URL-derived alternate key.
- Existing equivalent issues are recorded as discovered/referenced, never
  described as agent-filed. Accounting for PRs does not authorize PRs.
- Future global-ID/API format changes require a reviewed alias/transition;
  never silently switch digest inputs for old artifacts.

## 4. Skill drafts

Same namespace + deterministic keys: `skill-draft-<name>` under
`activityProjectId`; cross-project links for originating context. Store
`fields.skill` as `{"type":"md","content":"<complete proposed SKILL.md>"}`,
including frontmatter. Keep `fields.skill_name` and `fields.triggers` as
siblings of that typed node, together with
`fields.rationale` (motivation, evidence incl. observed-vs-hypothetical
recurrence, alternatives, limits, benefit, overlap analysis).
See [field presentation](field-presentation.md) for typed snippets and
rendering rules.
Same-key CAS converges; semantic overlap across names is best-effort:
search the shared namespace first, link/reconcile on discovery, preserve
human edits/cleared attention, pick a distinct key on unrelated name
collision (never overwrite). Drafts are inert text until a separate
explicit installation action. No `approved`-label authority, no
credentials/private excerpts in drafts.
