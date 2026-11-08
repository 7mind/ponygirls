# Rites

Scheduled repository agents using Pi's TypeScript SDK and a native Scala
coordinator. The service is under construction; the current milestone contains
a worker protocol foundation, not a runnable scheduler or forge integration.

See [the design and implementation ledger](../docs/drafts/20261108-2233-rites.md).
The confirmed target is a browser-managed multi-user service with
Chronicle-style statically provisioned accounts, repository grants, write-only
credentials, and Linux bubblewrap workers with regular outbound networking.

## Protocol development

From the repository root, use the pinned toolchain:

```bash
nix develop .#backend --command bash rites/scripts/generate.sh
nix develop .#backend --command bash -c 'cd rites && npm ci --ignore-scripts && npm run typecheck && npm test'
```

`rites/models/worker.baboon` owns the draft worker contract. Scala generation
omits a private runtime copy and will consume `shared/baboon-runtime` when the
coordinator project is integrated. The TypeScript boundary validates types,
field sets, UTF-8 byte limits, UUIDs, supported versions and terminal-outcome
consistency before invoking generated codecs. Generated TypeScript casts alone
are not input validation. No credentials are part of the wire schema.

A protocol `Completed` result means only that the worker finished; it does not
prove a repository delta, passing tests, sandbox cleanup or PR/MR publication.
The future supervisor must independently bind the result to the expected run
ID, observe process exit and enforce output/deadline limits while streaming.

Local live-model selections, provider configuration, tokens, raw traces and
private test settings belong outside this checkout and all Nix build inputs.
Tests use synthetic fixture names only. There is no default production model.
