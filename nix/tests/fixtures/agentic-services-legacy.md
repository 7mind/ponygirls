# Extraction baseline

Captured at `2026-10-31T13:04:07Z` offline by evaluating the read-only source module before extraction:

- Source: `paddock/modules/hm/agentic-services-server.nix`, checkout HEAD
  `645110616ad0aaf83a148ab1bbfa66483cfe328d`
- Source file SHA-256: `259c7b8784f0707010ee92f871de1a48dbba1b10da08af5fcdd452a5654ff77d`
- Credential helper SHA-256: `ea5640377ee9f7164bf4f1049a596258733923aa1fc08f1bd7cb4546c25e1350`
- Scenario: synthetic user `alice`, `services.example.test`, private address
  `100.64.0.2`, HTTPS, loopback alias, both stores enabled, legacy origins
  retained, existing `ivm` unit/state bindings. Host names and activity namespace
  are deterministically substituted with synthetic values in this fixture and
  its consumer configuration. No production system queried.
- Service packages replaced with `hello` solely for no-build rendering.
  Store references normalized to `@STORE@` (including their trailing path).
- The fixture preserves proxy, setup/crawler/PostgreSQL scripts, backend auth
  JSON and exact unit/timer names. Tests compare proxy behavior (ignoring only
  comments/whitespace), auth JSON, units, crawler and PostgreSQL scripts.
  Setup differs only by splitting static-directory creation into a gated
  command, and generic comments. Targeted setup assertions cover its contract.

The tests use the public rendered records and user-unit output of a standalone
Home Manager consumer boundary, not a downstream host configuration. These are
Behavioral-Active Blackbox-Group configuration tests. The credential suite is
Behavioral-Active Effectual-GoodCommunication: controlled temporary real files
are required to validate permissions, symlink rejection, inode preservation
and exclusive creation; a dummy filesystem cannot establish these guarantees.
