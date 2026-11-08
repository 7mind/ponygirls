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
Good-Communication tests. The eight native scenarios are the controlled
Good-Communication leg and are never silently replaced by fixture success.
