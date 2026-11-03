# Haystack policy-v2 complete native transport/browser acceptance

Immutable source `63e83da0809a2105a4cccd37f92660350ebb4c43`, parent task `bgt-a299a32a7e34e24f`, command exit0. Actual artifact `/nix/store/dld98mjhc74hvkav6z94l06r4qb5vb2b-haystack-native-artifact-0.1.0/libexec/haystack-server` SHA256 `d001828b20d7dd3efaef5d822a1ceeae843e1c46aec9b16699aa9242b7bd553f`;105-entry compiled manifest SHA256 `8df08d58b045a90d9f400ad345b633c7cc312eb3b8095ae3b3e29dc79ca12efc`.

Parent read actual immutable receipts, parsed fresh XML and checked source/artifact/proxy before-after equality before copying byte-exact output directories:

- `transport/`:34 exact positive inventory cases, zero failures/errors/skips. Real static-musl HTTP/MCP/WS/JDBC on owned non-superuser shared-provider fixtures.
- `browser/`:61 atomic cases,36 browser cases,1 markup case; all three exit0, zero failures/errors/skips, exact inventories and installed-asset hashes. Actual evaluated NixOS proxy SHA256 `3cb8da8c120cbe81ece43c2a05bef7ba70e6548e906475c96fd0afa3392a96c4`; screenshots are retained, not represented as independently visually reviewed here.

These new policy-v2 results supersede earlier native normal-config results only for their actual scopes. They complement separate complete705/31 Scala/PostgreSQL acceptance. Fresh JVM transport/browser and focused native large-pointer behavior remain separate gates; none of these establishes managed-unit/VM/deployment acceptance. No activation or production migration occurred.
