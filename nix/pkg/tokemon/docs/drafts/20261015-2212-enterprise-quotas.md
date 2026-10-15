# Own-account enterprise allowances

Only the authenticated member's existing OAuth endpoints are queried. No
organization administration credentials, usage aggregation, or billing APIs are
introduced. These are synthetic contract fixtures, not captured enterprise
responses or verification of an upstream defect.

## Claude

`/api/oauth/usage` and `/api/oauth/profile` support enterprise profiles with
monetary spend but no rolling quota. Modern enabled `spend` produces one
**extra usage** row, converting `amount_minor` using its currency exponent.
A limit with a different currency is unknown, never compared against usage.
If modern spend is unavailable, enabled legacy `extra_usage` is used instead:
`used_credits` and `monthly_limit` are cents, divided by 100 (USD when legacy
currency is absent). The two representations are never added together.
`resets_at` is preserved when supplied and parseable. Missing limits remain
unknown, not unlimited; an explicit zero remains zero.

Enterprise organizations (`enterprise` or `claude_enterprise`) without usable
monetary spend show **enterprise spend unavailable through OAuth**, even if
rolling windows exist. Rolling `limits` remain independent of spend. Only when
no modern rolling windows parse, legacy `five_hour`, `seven_day`,
`seven_day_opus`, and `seven_day_sonnet` `utilization` / `resets_at` provide
rolling windows without duplicates. Legacy percentages must be finite and
nonnegative; Opus and Sonnet retain scoped names.
Disabled or malformed monetary data does not fabricate a spend row.

## Codex

`/wham/usage` supports `spend_control.individual_limit` from the supplied schema
in <https://github.com/openai/codex/pull/24812>:

```json
{"limit":"25000","used":"8000","remaining":"17000","used_percent":32,"remaining_percent":68,"reset_at":1778137680}
```

The **monthly credits** row uses `used` and `limit` as credits, not dollars or
percentages. `used` is required; absent/null `limit` remains unknown. Malformed,
negative, boolean, and non-finite amounts are not accepted. `reset_at` is an
absolute epoch in seconds; missing, malformed, or out-of-range resets remain
unknown. Percentages and remaining amounts do not invent a missing allowance.
`spend_control.reached: true` exhausts only the monthly row. Otherwise exhaustion
is left unspecified so normal used-versus-limit derivation remains available.
Purchased **credits** balances and rolling rate limits stay separate. Rows are
ordered rolling windows, monthly credits, then balance credits.

## Offline checks

From the repository root, with the package's Python dependencies installed:

```bash
TOKEMON_LIVE=0 PYTHONPATH=nix/pkg/tokemon/src:nix/pkg/tokemon/tests \
  python3 -m unittest discover -s nix/pkg/tokemon/tests
```

Live endpoint tests explicitly skip. Fixture origin: user-supplied feature
contract and Codex schema reference; no credentials or live requests used.
