# Native indexing recovery acceptance

From the repository root, using an actual native ELF (not a JVM or launcher script):

```bash
nix develop .#chronicle --command bash -c '
  cd chronicle/tests
  npm ci
  CHRONICLE_SERVER_COMMAND='\''["/absolute/path/to/chronicle-server"]'\'' \
    node --import tsx --test indexing-recovery.test.ts
'
```

This focused gate uses the locked test dependencies, generated API 1.9.0, an owned
PostgreSQL/pgvector cluster, synthetic private credential files, and a controlled
loopback annotation/embedding server. It checks seven-window recovery with prefix
checkpoint reuse, durable rejection exhaustion, restart, and authenticated owner
retry with retained retry-epoch history. Required tools or schema are hard errors,
not skipped cases. Native annotation timeout remains 900 seconds; observation,
RPC, startup and shutdown guards are finite. No production archive or external
model is accessed. This establishes workflow behavior, not semantic model quality.

`workflow.test.ts` is a separate, older acceptance entrypoint; this invocation does
not run it. Failure artifacts are retained in the reported private temporary
directory; the test stops its owned processes. Never publish credential files.
