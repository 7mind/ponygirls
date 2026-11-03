# Transactional PostgreSQL retrieval

`ponygirls.retrieval.postgres.PostgresRetrieval(namespace,profile: Option[RetrievalProfile])`.
Every operation requires a caller-owned **non-autocommit** `Connection`; no method commits or opens a transaction. Initialize with `initialize(c)`. Namespace is bound data, not an SQL identifier. Library migrations and tables are `pony_retrieval_*`.

Authoritative source writes must call `put(c, SourceProjection(...))` in the **same** transaction; delete uses `remove(c,id)`. ALL eligibility/archive/audience changes must update that projection transactionally. Audience is live library policy, not cached allowed source IDs; app authenticates/revokes principals before queries. Chronicle does not use these ACL rows: its live owner/group SQL is retained.

Raw IDs/versions are reversible encoded keys; raw content/provenance/attribute values use UTF8 bytes, including NUL. Only FTS projection treats NUL as token separator. No original text is discarded. Exact `numeric` expiry is compared to caller-bound `query.now` before candidate limits/counts; never timestamptz-rounded.

Worker calls (separate short DB transactions):

1. `claim(c,leaseSeconds): Option[WorkClaim]` captures source/version/epoch/profile/run/fence/chunks.
2. `accepted(c,claim,firstOrdinal,count)` reuses committed batches across reclaimed leases.
3. Outside transactions call `EmbeddingClient.documents(...)`.
4. `accept(c,claim,firstOrdinal,vectors)` immutably commits validated batch.
5. `publish(c,claim): String` publishes only complete generation; `renew` / `fail` handle leases/retry.

There is no exactly-once provider call promise: response-before-commit crashes can repeat a call. Source/profile/fence/lease checks prevent stale publication. Old publication survives source/profile rebuild until complete replacement. Profile identity includes corpus policy: same vector space is NOT implicit policy compatibility; a new policy cannot serve old-policy snippets. A request with visible missing/incompatible publication returns typed unavailable (not a misleading empty complete result). Explicit same-version restoration after remove enqueues a fresh generation.

`search(c,query,vector: Option[List[Double]])` uses lexical HEAD exact/unbounded scope or exact profile+embedding-space matched published ANN semantic/hybrid (1000/leg), original-vector exact cosine rerank, RRF k60 and deterministic best-chunk entity grouping. `visible(c,query,id)` supports fresh-transaction delivery-time reauthorization; never relabel pinned hits with new source metadata. Filters are typed bound exact equality, applied before each candidate limit/count. No caller SQL fragments. Model absence or incompatible space is typed unavailable, not fallback.

`IndexingWorker(index,transactions: RetrievalTransactions,embedder,batchSize,leaseSeconds,pollInterval)` exposes `once` and `run`; the narrow transaction trait has `transaction[A](Connection => A): IO[A]`. Heartbeats renew fenced claims; retry/cancel preserves committed batches and never holds JDBC open during provider calls.
