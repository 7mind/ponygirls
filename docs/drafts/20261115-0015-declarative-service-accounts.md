# Declarative browser accounts and preserved API credentials

## Contract

Haystack and Manure NixOS `users.<id>` and Home Manager
`smind.hm.services.agentic.{haystack,manure}.users.<id>` accept:

- `type`: `human` or `agent` (required).
- `displayName`: optional display label.
- `enabled`: defaults to `true`; disabling the account denies authentication and
  invalidates its browser sessions and issued API tokens.
- `login` and `passwordHashFile`: optional **paired**, human-only browser
  credentials. Login text is preserved exactly, without trimming or case
  normalization. Logins must be unique, including disabled accounts. Application
  validation enforces the 128-UTF16-unit limit and rejects control characters.
- `tokens.<token-id>.tokenHashFile`: immutable declarative API token IDs and
  runtime SHA-256 digest files. A password-only human can leave `tokens = { }`;
  agents remain token-only. An existing token-only human remains API-only until
  an explicit browser credential pair is configured.

`passwordHashFile` is a runtime string path, not a Nix path or hash value. The
file contains canonical standard-Base64
`pbkdf2-sha256$ITERATIONS$SALT$KEY`, with 600000–2000000 iterations, a 16-byte
salt and a 32-byte derived key. `chronicle-server password-hash` generates the
shared format using stdin; never pass a password in argv or a Nix value.
Password and token digest paths must be absolute and outside the Nix store.
NixOS passes password files through systemd `LoadCredential` to both migration
and serving units. Generated JSON contains credential references, never hash
bytes. Manure's owned launcher resolves its password credential reference
without opening the password file; application startup owns hash validation.

Configured token IDs and digest-file bindings do not change merely because
browser credentials are added. Settings lists configured tokens as immutable;
issuing or revoking a runtime token does not rewrite Nix declarations. Browser
sessions are independent secrets, not API bearer tokens. The server imposes no
idle or absolute browser-session expiry; logout and account revocation still
invalidate sessions. Browser eviction/persistence caps are outside this policy.
Chronicle's `limits.sessionTtlSeconds` remains accepted and serialized for
configuration compatibility, but no longer sets a browser-session timeout.

## NixOS example (synthetic identity)

```nix
smind.services.haystack.users.reader = {
  type = "human";
  login = "reader";
  passwordHashFile = "/run/secrets/reader-browser-pbkdf2";
  tokens.existing-api.tokenHashFile = "/run/secrets/reader-existing-api-sha256";
};
smind.services.manure.users.reader = {
  type = "human";
  login = "reader";
  passwordHashFile = "/run/secrets/reader-browser-pbkdf2";
  tokens = { };
};
```

The same explicit canonical hash file can be selected by Chronicle's
`users.reader.passwordHashFile`. It is the operator's responsibility to choose
and provision the intended common credential and declare each account. No
identity or password equivalence is inferred from a Unix username or an
existing service token.

## Existing combined Home Manager deployments

The combined module retains the fixed `agent` and `operator` account IDs and
both `default` token IDs. `users` adds explicit accounts; `agent`/`operator` are
reserved there rather than silently replacing existing credentials.

For each enabled service, the default operator browser login is `operator`.
Setup creates `credentials/SERVICE-operator.pbkdf2` from the existing
`credentials/SERVICE-operator.token`. It preserves all existing token bytes,
digest bytes and IDs. Repeated setup verifies and retains the existing PBKDF2
file, including its salt and inode. A changed agent source or mismatching
legacy operator hash fails closed; setup does not silently rotate credentials.
The Haystack and Manure operator tokens are separate service-specific
credentials, so this default does **not** unify their passwords.

To select an intentionally common canonical password hash instead:

```nix
smind.hm.services.agentic = {
  haystack.operator = {
    login = "service-operator";
    passwordHashFile = "/run/secrets/canonical-operator-pbkdf2";
  };
  manure.operator = {
    login = "service-operator";
    passwordHashFile = "/run/secrets/canonical-operator-pbkdf2";
  };
  haystack.users.reader = {
    type = "human";
    login = "reader";
    passwordHashFile = "/run/secrets/reader-browser-pbkdf2";
  };
};
```

An explicit `operator.passwordHashFile` bypasses unused legacy PBKDF2
provisioning. Setup validates the canonical file but does not copy, chmod or
rewrite it, and it leaves any old derived PBKDF2 file untouched. Replacing the
explicit canonical file is a deliberate password replacement, distinct from
silently changing a preserved operator token. Disabled services neither pass
credential-source arguments to setup nor read, validate or rewrite their
retained credential files. Disabling does not delete state.

Both NixOS and Home Manager migration units perform `check-config` before
`migrate`; serving requires successful migration. Manure's check is parse-only,
not proof of hash-file readability or validity. NixOS `LoadCredential` requires
referenced files to exist, while password-hash byte validation belongs to
application startup. Home Manager's explicit operator hash is additionally
validated by setup.

The preexisting Home Manager setup graph remains `Wants` + `After`, not
`Requires`, to avoid propagating secret-refresh stops through the stack. A
failed setup with retained valid files can therefore leave subsequent
configuration checks valid (for example, a changed agent source was refused,
but the old credential files remain valid). A configuration check does not
prove the current provisioner inputs were accepted. This change does not
broaden that failure/dependency policy. These unit declarations and local
checks are not evidence of successful live activation, migration or deployment.

## Migration boundary

No private credentials or live services were modified by this change. Real
`pavel`/`desertfury` account mappings and common credential selection remain
blocked on the operator's Q45 answer; legacy tokens do not establish those
identities. Offline deployment migration belongs to the separate migration
tool and requires explicit account inputs. Preserve each deployment's existing
state/credentials directory and all unrelated files.
