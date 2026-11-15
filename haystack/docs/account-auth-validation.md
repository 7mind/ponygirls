# Account authentication validation

This change adds the separate account plane while preserving the current domain
API and audit identities. Browser cookies now identify independent durable
sessions; declarative and issued API credentials remain bearer-only.

Final integrated results (715 backend cases, JVM/native42 and complete browser
acceptance) are in the [validation summary](../../docs/drafts/20261115-0225-accounts-validation.md).
The source-bound run below is an earlier implementation checkpoint.

## Initial backend checkpoint

The pinned command:

```bash
nix develop .#chronicle --command bash haystack/scripts/test-postgres-scala.sh haystackServer/assembly
```

completed **33 suites / 712 cases**, zero failures, errors or skips, against an
owned disposable PostgreSQL cluster. Its fresh XML inventory matched exactly.
The source receipt includes the new account library and lossless parser, not only
Haystack sources. Retained receipt: `/tmp/nix-shell.ROOnZj/haystack-scala-report.WkUiwg`.

The assembly SHA-256 from that run is
`d8c6ebad9b2435c23253137d45bab13ca5afe3c536a34c24bfbd51bd3b070f4e`.
This is JVM evidence, not native-executable or deployed-service acceptance.

## Reproductions and corrections

- Token-only browser login initially returned 200 where the new contract requires
  rejection. Owned process and PostgreSQL account tests now exercise password
  login, restart survival, copied-cookie logout rejection, immutable configured
  tokens, issued-token revocation and independent sessions.
- A valid Alice actor with Bob's current cookie initially issued a Bob token.
  Mutations now verify the intended owner inside their existing transaction;
  wrong-owner actor is 409, malformed/missing/duplicate actor is 400.
- A runtime bearer revoked after a gated MCP read initially still delivered the
  captured result. Both ordinary HTTP and MCP revalidate captured authority
  before delivery; no protected result is delivered after that check rejects.
- Atomic cross-account login replacement initially inverted the sorted directory
  reconciliation lock order and produced PostgreSQL `40P01`. The deterministic
  trigger/lock-barrier regression now passes using the common `loginReplacing`
  operation, which acquires both owners in sorted order. A failed password leaves
  the previous session intact.

The shared library additionally has memory/real-PostgreSQL contracts and committed
lock-barrier regressions for removal, disable and password replacement. Those checks
remain separate from Haystack's transport checks.

## Other acceptance layers

The executable process suite and actual browser/preview checks are recorded by
`haystack/scripts/test-current.sh` and `haystack/scripts/test-browser.sh`, including
artifact kind/hash and exact inventories. Their final receipts must be evaluated
separately; the Scala result above does not substitute for those legs. Production
publication, input-pin updates and deployment are not part of this local validation.
