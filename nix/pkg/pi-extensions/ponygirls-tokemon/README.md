# ponygirls-tokemon

Provider quotas inside pi (`v1.0.0` verified): this repository's `tokemon`
dashboard (`nix/pkg/tokemon`) without external Claude/Codex profiles or
yolo profile discovery. It covers only the providers the running pi
is configured for.

## Install

Wired via `nix/hm/pi.nix` (`programs.pi.settings.extensions`). Ad hoc,
without deploying: `./pi-test` at the repository root. Manually:

```bash
pi --extension /path/to/ponygirls-tokemon
```

## What is queried

Targets come from pi's agent directory (`PI_CODING_AGENT_DIR`, default
`~/.pi/agent`) and the environment:

- every `auth.json` entry (OAuth logins and API keys). An entry with no
  usable secret is listed with the reason;
- the API-key environment variables pi reads for providers with a plan
  surface (`ZAI_API_KEY`, `KIMI_API_KEY`, `XAI_API_KEY`, …; see
  `ENV_PROVIDER_KEYS` in `src/discovery.ts`), unless the same key is already
  stored in `auth.json`. `XAI_MANAGEMENT_API_KEY` is not a pi variable; it
  reads xAI team billing;
- `models.json` providers covered by neither. pi resolves their key at query
  time. `openai-completions` endpoints without a quota adapter (llama-swap,
  Ollama) are omitted.

OAuth access tokens are resolved through pi's model registry, which refreshes
an expired login. That includes logins whose auth is a header only, such as
kimi-coding's `Authorization: Bearer …`. Copilot and Meta query with the
stored refresh/identity token instead, as tokemon does.

Quota adapters, ported from tokemon: `anthropic` (Claude OAuth personal
quota/spend; API keys have no subscription quota endpoint), `zai`, `kimi-coding`, `minimax`,
`openrouter`, `vercel-ai-gateway`, `github-copilot`, `openai-codex` (ChatGPT
plan; the `ChatGPT-Account-Id` header is sent when the login carries an
account id), `xai` (Grok
subscription; inference-key status), `xai-management`, and `meta` (Muse; one
key-mint POST, no retry). Any other provider is listed as "no quota endpoint".
Codex enterprise/business monthly allowance is shown as `monthly credits`,
separate from rolling quotas and the credit balance. Claude accepts both modern
`spend` money objects and legacy `extra_usage` cents, including spend-only
enterprise responses. Missing limits stay unknown, never unlimited. When an
enterprise account exposes no spend through OAuth, the note says
`enterprise spend unavailable through OAuth`; this does not mean zero spend.
No organization-admin key or browser cookie is used. Anthropic requires a usable
OAuth login configured in pi; this extension does not import or refresh Claude
Code profiles. API-key usage cannot reveal enterprise subscription spend.

Each target fails independently. Except for shared Anthropic responses below,
an HTTP 429 holds that target's last result until `Retry-After` passes.
Targets that resolve to the same account are merged into one row.

## Shared Anthropic cache

All pi instances and the standalone Python dashboard coordinate through one
SQLite file: `$XDG_CACHE_HOME/tokemon/state.sqlite`, or
`~/Library/Caches/tokemon/state.sqlite` on macOS and
`~/.cache/tokemon/state.sqlite` elsewhere. The directory/file modes are
0700/0600. It contains endpoint URLs, SHA-256 hashes of Authorization values,
last successful response bodies (including account metadata), and timestamps;
it never stores the credentials themselves. Different credentials are isolated.

`BEGIN IMMEDIATE` reserves each endpoint/credential's next request before
network access. Only the reservation owner records its response; a timestamp
fence rejects late completions after a newer reservation. Minimum spacing is
five minutes, including after a process exits mid-request. A 429 backs off for
at least 30 minutes, or longer if Retry-After requests it. Manual refreshes do
not bypass these limits. Other clients such as Claude Code do not participate
in this coordination, so rate limits remain possible.

Readers keep displaying the last successful body after failed refreshes.
Its success timestamp is never replaced with the cache-read or failed-attempt
time. Values at least five minutes old show `stale Nm`; migrated cache entries
with no known success timestamp show `stale (age unknown)`. A cold cache with
an in-flight request or failed request has no quota values to display yet.
Storage failures fail closed rather than issuing uncoordinated requests.

## Tool

`tokemon({ include_models?: boolean, include_quotas?: boolean, include_context?: boolean })` returns JSON (`include_models` defaults to false, `include_quotas` and `include_context` to true):

```json
{
  "fetchedAt": "2026-10-06T11:46:54.000Z",
  "providers": [
    {
      "provider": "zai", "source": "auth.json", "location": "~/.pi/agent/auth.json",
      "login": null, "plan": "lite",
      "windows": [
        { "name": "credits (5h)", "used": 94, "limit": 2000, "unit": "credits",
          "unlimited": false, "state": "ok", "resetsAt": "…", "resetsIn": "2h 22m" }
      ],
      "note": null, "error": null, "rateLimited": false, "retryAt": null
    }
  ],
  "models": { "zai": [{ "id": "glm-5.3", "efforts": ["off", "minimal", "low", "medium", "high"] }] },
  "context": { "tokens": 12345, "contextWindow": 200000, "percent": 6.17 }
}
```

`state` is `ok`, `low` (90% or more used), `EXHAUSTED`, or `unlimited`.
`models` (each provider's available models with the effort levels pi can run
them at) is present only with `include_models: true`. `include_quotas: false`
drops the quota `windows` (plan, login, notes, and errors stay). `context` is
the calling session's context size and usage; it is present unless
`include_context: false` or the usage is unknown. Answers are cached for a
minute. Top-level `fetchedAt` is report assembly time; each provider exposes
`fetchedAt`, `ageSeconds`, `stale`, and `nextRefreshAt`. Anthropic values may
be older during backoff/failures. An unknown legacy success timestamp is null,
not the current time.

## Command

`/tokemon` opens a bottom panel replacing the editor (like `/usage` and
`/perf`) with tokemon's table: one row group per
account, its windows stacked inside the cells, sorted by provider and login.
The panel takes only the rows its table needs, so the transcript stays visible
above it. It refreshes every five minutes; the title rule shows the last
update and the countdown, and the key hints sit below a rule. Usage bars are
coloured by the window's Status (ok `success`, low at 90 %+ `warning`, EXHAUSTED `error`;
the empty part dim). Provider names keep their brand hue, with OKLCH lightness
adjusted to at least 4.5:1 contrast against a reference background for the
theme's appearance (dark `#2E3440`, light `#FBF1C7`).

| Key | Action |
|---|---|
| `r` | refresh now |
| `i` | show or hide rows without quota data (errors, no endpoint) |
| `m` | show or hide each provider's available models below the table |
| `↑` `↓` / `j` `k`, `PgUp` `PgDn`, `Home` `End` / `g` `G`, mouse wheel | scroll |
| `esc` / `q` | close |

On a narrow terminal the provider locations are hidden first. Next, Status
wraps between words, and each window's other cells stay level with its
status. Then Plan, Provider, and Status are hidden, in that order. The
caption names what was hidden. Outside the TUI (print/json modes) the
command emits the table once as a notification.

## Quota widget

On the editor's top-right border pi shows the current provider's limited
windows (`── ⠙ Working ────────────────── zai {5h/1:30 [██░░░ 30%]} {7d/3d:05:40 [█░░░░ 10%]} ──`: each window's
trailing duration, reset countdown, and usage bar, coloured as in the table), refreshed
on session start, at each turn end, on model switches, and every five minutes
while idle. Age/reset countdowns redraw every 30 seconds without network
requests. Last known Anthropic bars stay visible with a `⚠ stale Nm` marker;
providers without quota rows clear the badge. Timers stop on session shutdown.
Border placements need pi with earendil-works/pi#10602; this flake's
pi-coding-agent carries it as a patch.

## Tests

```bash
nix build .#checks.x86_64-linux.ponygirls-tokemon
```

The adapters are tested against tokemon's recorded fixtures
(`tests/fixtures`) through a scripted HTTP stand-in; no test touches the
network. Real-filesystem/process tests cover competing Node writers, legacy
migration, late-writer fencing, failures/backoff, and Python/Node cache
interoperability. For direct Node runs, set `TOKEMON_PYTHON_SOURCE` to the
absolute `nix/pkg/tokemon/src` path to enable the cross-language contract;
the Nix check always enables it.
