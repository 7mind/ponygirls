# xAI plans: what tokemon can and cannot meter

Status as of 2026-10-01. xAI does not publish how a SuperGrok Business seat is
metered, so tokemon's xAI rows rest partly on observation of one account and
partly on inference. This note separates the two so the adapter
(`nix/pkg/tokemon/src/tokemon/adapters/xai.py`) can be corrected when xAI
documents the terms or the behaviour changes.

## Credential kinds and where each is metered

| Credential | tokemon provider | Meter tokemon reads |
|---|---|---|
| OAuth login, personal subscription | `xai` | Weekly/monthly usage pool from the Grok CLI proxy (`cli-chat-proxy.grok.com/v1/billing?format=credits`) |
| OAuth login, team seat | `xai` | None; the row points to the team's credits |
| Inference API key (`XAI_API_KEY`) | `xai` | None; key name and blocked state only |
| Management key (`XAI_MANAGEMENT_API_KEY`) | `xai-management` | Team billing: cycle usage against included credits, prepaid balance |

A team seat is detected by `teamName` in the proxy's `/v1/user` response, the
same field the Grok CLI uses to decide that an account has no consumer billing.

## Observed

One SuperGrok Business team with a single $30 seat, bought 2026-10-01.

- The team's invoice preview (`management-api.x.ai`,
  `/v1/billing/teams/{team}/postpaid/invoice/preview`) lists every kind of
  usage as a per-token line, each tagged with a product:
  - `api`: requests to `api.x.ai`, by OAuth token and by API key alike;
  - `grok-build`: requests through the Grok CLI proxy;
  - `grok-chat`: chat on grok.com in the team workspace.
- `coreInvoice.totalWithCorr` is the cycle's usage in cents. API usage showed
  up within seconds; grok.com chat lagged by several minutes.
- `defaultCredits` was 14819 cents and did not move while usage rose.
  `defaultCreditsIssued` mirrored the usage with the opposite sign, and the
  amount payable stayed zero.
- 14819 cents equals $150 prorated over the calendar month from the minute the
  seat's payment method was added.
- The seat's consumer pool (`/v1/billing?format=credits`) kept reporting a
  weekly period with no `creditUsagePercent` after usage on all three routes.
- grok.com Settings → Usage showed a dollar "Spend" figure labelled "Usage
  from Grok product surfaces. Excludes API usage", matching the `grok-chat`
  invoice lines.
- The Management API answers a management key only: an OAuth token gets HTTP
  500 and an inference key HTTP 401. The Grok CLI proxy answers an OAuth token
  only.
- `effectiveSpendingLimit` and the prepaid ledger were both zero.

## Inferred

- A Business seat's allowance is a monthly dollar credit ($150 for the $30
  seat) shared by chat, Grok Build and API usage, charged at per-token rates.
  tokemon shows `totalWithCorr` against `defaultCredits` on that basis.
- The credit renews each calendar month. tokemon derives the reset time from
  `billingCycle`; this has not been watched across a month boundary.
- The weekly pool is not used for team seats, so tokemon does not show it for
  them.

## Unknown

- Whether the credit is per seat and pooled across a team.
- What happens when the credit runs out. A zero spending limit suggests usage
  stops unless prepaid credit is added; this was not tested.
- Whether the $150 is tied to the seat or is a separately granted credit that
  happened to start at the same minute.
- The allowance, and the per-seat price, of a SuperGrok Heavy business licence.
- Whether other Grok products (Imagine, Voice) appear as further invoice
  products; only `api`, `grok-build` and `grok-chat` were exercised.

## Published sources checked

None states an allowance for a business seat.

- Grok Business user guide and licence management (docs.x.ai/grok/user-guide,
  docs.x.ai/grok/management): a seat has the "full benefits of SuperGrok";
  SuperGrok Heavy is "upgraded performance for demanding workloads".
- Grok FAQ, Usage & Limits (docs.x.ai/grok/faq): describes the consumer weekly
  pool as a percentage with a per-product breakdown that includes API. The
  observed team seat does not behave this way.
- x.ai/pricing, x.ai/grok/business, the enterprise terms of service: no
  quantities.

## Other fragile points

- The Grok CLI proxy endpoints are undocumented. tokemon sends the client
  version the proxy advertises as its minimum (`/v1/settings`
  `min_client_version`, 1.0.13 on 2026-10-01); a later bump may be needed.
- The prepaid ledger is inverted (a top-up is negative cents). That handling
  follows the documented example and has not been seen with a non-zero balance.
