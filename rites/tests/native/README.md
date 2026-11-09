# Rites native acceptance

Fixture-only checks (do **not** constitute native acceptance):

```sh
rites/scripts/test-native.sh --selftest
```

Native acceptance requires all three explicit artifacts and the pinned backend
shell's `POSTGRES_HOME`:

```sh
rites/scripts/test-native.sh NATIVE_LAUNCHER WORKER_EXECUTABLE NATIVE_ELF
```

`NATIVE_LAUNCHER` must exec the supplied `NATIVE_ELF` for `serve`, so
`/proc/<serve-pid>/exe` can be verified against it. `WORKER_EXECUTABLE` is the
actual `rites-worker`, not a shell/model substitute. The launcher also provides
`check-config`, `migrate`, and `password-hash`.

The suite creates a fresh owned SCRAM PostgreSQL cluster and loopback-only Git,
forge, model, and OAuth fixtures. All identities, credentials, model names, and
tokens are synthetic. Native runs are serial against one fresh database. Reports
are appended under `rites/server/target/native-validation-runs/`; plaintext
secrets and raw authorization headers are not recorded.

The self-tests are Behavioral-Active tests. Document/protocol tests are BA;
real owned Git/HTTP fixture tests are Behavioral-Active Blackbox/Effectual
Good-Communication tests. The nine native scenarios are the controlled
Good-Communication leg and are never silently replaced by fixture success.
The credential regression recursively searches `/workspace` for the synthetic
model and forge credential literals with quiet fixed-string matches. Search
errors are distinct from absence. It requires provider-visible
`PROBE_EXECUTED+DENIED:credential-content` and
`PROBE_EXECUTED+DENIED:.rites-model.json` tool results before allowing the
subsequent write; absence of a file or absence of a witness is not success.
Forge `/user` and PR/MR author IDs use realistic numeric JSON values.

A separate browser/native leg (not another native-suite case and not a UI
fixture substitution) uses the packaged web root, real native API and owned
credential/repository/model fixtures in pinned Chromium:

```sh
rites/scripts/test-native.sh --browser-native \
  NATIVE_LAUNCHER WORKER_EXECUTABLE NATIVE_ELF \
  WEB_ROOT NODE_MODULE_ROOT CHROMIUM
```

`NODE_MODULE_ROOT` is the absolute `node_modules` directory containing the
pinned `playwright-core`. The browser drives owner login, write-only
credential/repository/rite creation, manual publication and history, then an
owner-to-viewer principal change with private-state checks. Reports go to
`browser-native-validation-runs`; the nine-case native report is unchanged.
