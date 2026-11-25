# Per-account indexing preferences

Manure, Haystack and Chronicle use the same policy. Set it on each service; their
accounts and saved preferences are not synchronized.

```json
{"indexing":{"defaultEnabled":true,"allowOptIn":false,"allowOptOut":true}}
```

- Omit `defaultEnabled` to keep indexing on by default. To require opt-in, set
  `defaultEnabled` to `false` and `allowOptIn` to `true`.
- Omit `allowOptIn` or `allowOptOut` to turn that self-service option off. The
  flags govern explicit choices, not already saved choices. Resetting to the
  server default removes an exception; it does not opt in on a default-off server.
- The effective setting is **administrator override**, then **saved user
  choice**, then **server default**. Admins can force either value or remove
  their override regardless of the self-service flags. Removing a force restores
  the saved user choice, if any.

Users can see the effective setting in **Account settings → Profile →
Indexing**. Administrators use **Account settings → Users → row actions →
Indexing…**, then confirm with their current password. This does not require enabling self-signup
or enrollment. Accounts without a browser login cannot change their own
setting in the dashboard; an administrator can change it for them.

## What changes when indexing is off

This is a content indexing setting, not an access-control change. Uploads,
metadata browsing, direct access to the saved data and sharing still follow the
same rules. The setting controls whether the service indexes the account's data,
not whether that account can search other users' indexed data.

- **Manure:** The artifact creator decides eligibility for indexed retrieval of
  artifact names, metadata and paths. Catalogue, file bytes and content links are
  unchanged.
- **Haystack:** Both the item creator and the author of a revision must allow
  indexing for that revision. A shared or agent credential is an account, not
  a way to attribute text to the person using it. Browse still lists records
  and supports structured filters, but terms and phrases do not match a
  revision that is opted out. Direct reads, writes and history are unchanged.
- **Chronicle:** The archive owner controls indexing, including when sessions
  are shared with a group. Sessions are still listed and readable; they do not
  contribute content matches or generated index data while opted out.

Turning indexing off hides existing content results without deleting the
stored index. New background model work is paused. The services can still
maintain local data for direct reads, within-session find, and catching up if
indexing is turned back on; excluded content does not match across the corpus.
Requests that had already
passed the last provider-admission check can still finish or reach the provider.
Editing a preference does not ask a provider to erase anything.
Query embeddings are separate from indexing: when someone chooses a semantic
search, the service may still send the search text they type.

## Operations

NixOS exposes `smind.services.<service>.indexing`. Home Manager exposes
`smind.hm.services.agentic.<service>.indexing` for Manure and Haystack; pass
`indexing` in the Chronicle server settings. These are startup settings.

Apply the same flags to all instances serving one service database. Keep older
binaries out of that deployment: they do not honor the preferences and could
index or expose data current users opted out of. Do not use an older binary
against opted-out data as an unrestricted rollback.
