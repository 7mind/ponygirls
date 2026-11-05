# Transport-independent model identity and retained-work migration

## Contract

`embedding-space-v2` binds the model ID, immutable revision, dimensions,
`sendDimensions`, query/document preprocessing prefixes and normalization.
A revision must account for artifact digest/commit and semantically relevant
runtime, quantization, context and pooling choices. An endpoint, credential,
proxy, timeout or DNS name is not a model artifact.

Chronicle's `index-profile-descriptor-v2` additionally binds the annotation
model/revision/request policy/response budget and problem-passage kernel.
Neither annotation nor embedding identity includes its endpoint.

A matching descriptor is a configuration assertion, not provider attestation.
Before approving retained metadata, independently verify the old and new model
artifacts and semantic settings. A reused model alias, equal dimensions or a
healthy HTTP endpoint is insufficient. Do not change a revision to make IDs
match, introduce an endpoint alias, or force reindex compatible vectors.

## Chronicle procedure

1. Retain a recoverable pre-migration database and record its resource identity,
   schema, source revision/publication IDs, vector/content hashes and accepted
   checkpoint counts. Keep the original source authoritative until final sync.
2. Use the complete intended user/static-token configuration. Both `serve` and
   `serve-standby` call normal database initialization: schema registration,
   credential reconciliation and archive-projection backfill can write data.
   `serve-standby` exposes the **same writable API**, but never starts background
   indexing workers. It is not a read-only database or an ingestion fence.
3. Stop old workers and wait for their live leases to expire. Keep business
   clients away from a shadow copy; do not run two authoritative writers.
4. Independently verify artifact/runtime compatibility, then approve exact
   retained profile IDs and the configured canonical profile in a bounded plan:

   ```json
   {
     "version": "model-identity-migration-v1",
     "legacyProfiles": ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
     "canonicalProfile": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
   }
   ```

   These are synthetic IDs, not a deployable plan. No endpoint or credential
   belongs in this file. Unknown fields, empty/duplicate/invalid IDs, plans over
   32 KiB and plans targeting a different configured model/policy are rejected.
5. Run:

   ```bash
   chronicle-server migrate-model-identities CONFIG.json PLAN.json
   ```

   The command first performs normal initialization as described above. The
   subsequent **model metadata operation** is one transaction, not a promise
   that initialization and metadata migration form one atomic operation. It
   verifies original descriptor/profile hashes, exact semantic compatibility,
   quiescence, immutable mappings and checkpoint-namespace collisions. Only
   explicitly approved current-policy legacy profiles are migrated. Unsupported
   or unapproved profiles are not made executable or silently reindexed.
6. Compare content/vector hashes, publication IDs, runs, target epochs and
   accepted outputs with the baseline. Repeating the approved migration must be
   idempotent. Verify native reads, semantic inference and accepted-work reuse
   before enabling workers or directing clients to the destination.

The operation retains original registry records and updates control references
in the singleton/owner targets, jobs, generations, search projection and rebuild
requests. It does not rewrite raw sessions, vector values or historical result
JSON. A rebuild request's canonical target is control state; replay still binds
to its original immutable result receipt and selection token.

Accepted checkpoint hashes historically included profile and embedding-space
IDs. A per-`(job_id,run_id)` namespace preserves those original hash inputs;
authority, claims and publication use the verified canonical model identity.
A later explicit rebuild has a new run and uses the canonical namespace, never
another run's accepted output. This preserves accepted work, not exactly-once
provider execution for unaccepted in-flight requests.

Rollback uses the retained pre-migration database/recovery procedure; do not
blindly reverse many-to-one ID mappings or overwrite newer target writes.

## Shared retrieval consumers

`PostgresRetrieval.initialize` registers the configured v2 profile but never
implicitly relabels existing publications. The explicit library operation is:

```scala
index.migrateModelIdentities(connection, approvedLegacyProfiles)
```

The caller owns the transaction and independently verified approval. The method
requires the exact configured model/projection policy, namespace-scoped retained
profiles and no live legacy leases. It preserves publication IDs, epochs, runs,
vector values and accepted embeddings. Original profile records remain retained.
The embedding acceptance digest is vector-only; unlike Chronicle's checkpoint
hashes, it needs no legacy input-hash namespace.

This is a library API, not a new Haystack/Manure native CLI subcommand. An
embedding-enabled application must wire its explicit maintenance driver before
upgrading retained v1 data; do not assume ordinary startup migrates it or use an
unreviewed SQL rewrite. Lexical-only installations do not acquire embeddings or
provider calls from this change.
