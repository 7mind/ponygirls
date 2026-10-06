# ponygirls-tokemon

Provider quotas inside pi (`v1.0.0` verified): this repository's `tokemon`
dashboard (`nix/pkg/tokemon`) without the Claude profiles and
without yolo profile discovery. It covers only the providers the running pi
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

Quota adapters, ported from tokemon: `zai`, `kimi-coding`, `minimax`,
`openrouter`, `vercel-ai-gateway`, `github-copilot`, `openai-codex` (ChatGPT
plan; the `ChatGPT-Account-Id` header is sent when the login carries an
account id), `xai` (Grok
subscription; inference-key status), `xai-management`, and `meta` (Muse; one
key-mint POST, no retry). Any other provider is listed as "no quota endpoint".
Each target fails independently. An HTTP 429 holds that target's last result
until `Retry-After` passes. Targets that resolve to the same account are
merged into one row.

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
minute; `fetchedAt` says when they were fetched.

## Command

`/tokemon` opens a bottom panel replacing the editor (like `/usage` and
`/perf`) with tokemon's table: one row group per
account, its windows stacked inside the cells, sorted by provider and login.
The panel takes only the rows its table needs, so the transcript stays visible
above it. It refreshes every five minutes and shows a countdown.

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

Below the editor, directly under the text input, pi shows the current
provider's limited windows framed as editor border chrome
(`── zai {5h/1:30 [██░░░ 30%]} {7d/3d:05:40 [█░░░░ 10%]} ──…`: each window's
trailing duration, reset countdown, and usage bar), refreshed
at each turn end and on model switches; providers without quota rows,
errors, and rate limits clear it instead of parking stale text there.

## Tests

```bash
nix build .#checks.x86_64-linux.ponygirls-tokemon
```

The adapters are tested against tokemon's recorded fixtures
(`tests/fixtures`) through a scripted HTTP stand-in; no test touches the
network.
