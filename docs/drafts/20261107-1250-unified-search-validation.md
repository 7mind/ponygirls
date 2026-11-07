# Single-expression search and compact upload validation

## Scope

- Haystack: one Boolean query editor, no separate project/tag/archive controls or filter-button row. The visible applied expression is sent unchanged, with no hidden project parameter. Legacy URL filters migrate into visible predicates; unsafe migrations fail closed.
- Manure: one query editor with local, caret-aware completion. Dashboard and MCP `search` share expression fixtures and compile to the existing typed catalogue/retrieval requests. Search remains explicit; typing/completion does not invoke retrieval or embedding providers. Catalogue and lexical/semantic/hybrid modes retain their distinct matching and paging contracts.
- Quick upload: one desktop row with short file input, three adjacent access choices, Upload and Dismiss. Narrow layouts wrap; staging, retry identities and transient passwords remain intact.
- No deployment, protocol-model change, backend ranking change or production-data access.

Base source: `5a32c195`. Worker commits: `054b74be` (Manure query/MCP), `d0602be3` (Haystack editor), `7a7a5b9c` and `49e3dee9` (Manure editor/upload). Parent corrections and verification are included in the final integration commit.

## Verification

All application commands use `nix develop .#chronicle --command …`, with locked npm dependencies. PostgreSQL and native services run in owned disposable fixtures. Native executables are reused only after checking their compiled-input manifests against the candidate; acceptance is freshly executed, not reused from earlier UI work.

| Check | Result |
|---|---|
| Haystack locked `npm ci --offline`, web typecheck and production build | Passed |
| Haystack complete native browser harness, actual evaluated NixOS HTTPS proxy and installed web assets | 66 atomic leaf cases, 41 browser cases (39 main + HTTPS restart + preview restart), 1 markup case; zero failures/errors/skips; exact inventory and unchanged source/artifact receipt |
| Manure complete native target inventory | 357 Python cases, all 32 Node cases, 74 strict codec vectors and TypeScript goldens; zero failures/errors/skips, exact inventory and unchanged source/artifact checks |
| Manure Python/JavaScript shared expression fixtures | 76 fixtures; complete Node gate also checks strict current codecs, network capture and upload behavior |
| Manure focused route-draft, maximum-length sort, TLS and official SDK regressions | Passed |
| Installed Manure client and backend-source Nix checks | Passed; final package rebuilt after application corrections |
| Independent integrated source review | Initial sort-overflow finding reproduced and corrected; no outstanding substantive findings in reviewed candidate |

Haystack native artifact SHA-256: `b334021257e467f38c75f847310f6a0b612f3513dcd0edc171ece9486a1a2198`.
Its complete browser receipt binds installed assets, proxy JSON, source manifest, compiled-input manifest and executable digest.

Manure native artifact SHA-256: `37165972d36100a3a299b8ba03139894bd770c3e27a33075f9c25f70280bebf8`.
The successful fresh report is `manure-full-20261107T124957Z`; it retains the complete inventory, summary, logs and before/after source and executable hashes. All 49 installed dashboard files match the tested source exactly. Fixture tools, Playwright and the MCP SDK were explicitly rooted for the final run after an earlier prerequisite-only attempt found a temporary SDK output missing. No test result from that prerequisite failure was reused.

Representative full commands:

```bash
nix build .#haystack .#haystack-proxy-fixture
nix develop .#chronicle --command bash -c 'cd haystack && npm ci --offline --no-audit --no-fund && npm run typecheck -w web && npm run build -w web'
# With explicit selected artifact/manifest/report/proxy and owned fixture wrappers:
bash scripts/haystack-native-acceptance.sh browser "$HAYSTACK_ELF" "$HAYSTACK_COMPILED_INPUTS" "$FRESH_REPORT" "$EVALUATED_PROXY_JSON"
# With explicit native executable, Playwright/Chromium/SDK/viewer paths and paired owned database provisioner:
python3 manure/scripts/target-suite.py --scope full --report "$FRESH_REPORT"
nix build .#manure .#checks.x86_64-linux.manure-client .#checks.x86_64-linux.backend-source
```

Full environment and command scripts, failed attempts, fresh reports, inventories and screenshots are retained locally under `debug/unified-search-20261107/` after integration. No stale report files are combined with a later run.

## Reproduced corrections

- Installed client source filtering omitted the new parser module. Actual installed invocation failed with `ModuleNotFoundError: manure.query`; the package allowlist and build-time parser assertion now cover it.
- Sorting a valid 4096-character query could exceed the expression limit after applied state had already changed. Chromium reproduced the uncaught exception. Serialization now precedes mutation, and an unrepresentable sort leaves query/results unchanged with a visible explanation.
- A deferred submitted-route callback could overwrite a newer draft. A held real-browser hashchange callback reproduced `submitted` replacing `newer draft`. Applying the submitted controls synchronously and preserving subsequent drafts across the matching route callback fixes it.
- TLS attack-phase attribution could include a legitimate bootstrap request when a test planted a cookie before initial session observation completed. Explicit login/catalogue readiness barriers now separate phases; no request/response filtering or security assertions were relaxed.
- SDK tests still assumed eight tools after adding `search`; source and installed-package failures were reproduced before updating the nine-tool contract. Browser tests also now distinguish the native input length bound from parser rejection of programmatically injected over-limit input.

Real IME hardware, assistive-technology sessions, semantic classification quality, deployment and production acceptance were not claimed. Browser composition checks use controlled events. Reusable procedure analysis found overlap with the installed `query-filters` skill, not a distinct new skill candidate.
