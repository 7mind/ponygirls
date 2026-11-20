# Transactional PostgreSQL retrieval

`ponygirls.retrieval.postgres.PostgresRetrieval(namespace,profile: Option[RetrievalProfile])`.
Every operation requires a caller-owned **non-autocommit** `Connection`; no method commits or opens a transaction. Initialize with `initialize(c)`. Namespace is bound data, not an SQL identifier. Library migrations and tables are `pony_retrieval_*`; `pony_retrieval_migrations` holds one checksummed row per version (v1 tables, v2 job back-off column `not_before` and the return of formerly `Failed` jobs to `Queued`).

Authoritative source writes must call `put(c, SourceProjection(...))` in the **same** transaction; delete uses `remove(c,id)`. ALL eligibility/archive/audience changes must update that projection transactionally. Audience is live library policy, not cached allowed source IDs; app authenticates/revokes principals before queries. Chronicle does not use these ACL rows: its live owner/group SQL is retained.

Raw IDs/versions are reversible encoded keys; raw content/provenance/attribute values use UTF8 bytes, including NUL. Only FTS projection treats NUL as token separator. No original text is discarded. Exact `numeric` expiry is compared to caller-bound `query.now` before candidate limits/counts; never timestamptz-rounded.

Worker calls (separate short DB transactions):

1. `claim(c,leaseSeconds,now): Option[WorkClaim]` captures source/version/epoch/profile/run/fence/chunks/attempt. A job is due when `Queued` and its earliest retry is at or before `now`, or `Running` with an expired (database-clock) lease.
2. `accepted(c,claim,firstOrdinal,count)` reuses committed batches across reclaimed leases.
3. Outside transactions call `EmbeddingClient.documents(...)`.
4. `accept(c,claim,firstOrdinal,vectors)` immutably commits validated batch.
5. `publish(c,claim): String` publishes only complete generation; `renew` extends the lease.
6. `fail(c,claim,now): Option[Instant]` returns a current claim to `Queued` with earliest retry `now + PostgresRetrieval.retryDelay(attempt)` = `min(RetryBase·2^(attempt−1), RetryCap)` (2 s, 5 min) and returns that time; `None` when the claim is no longer current. No attempt count is terminal.

There is no exactly-once provider call promise: response-before-commit crashes can repeat a call. Source/profile/fence/lease checks prevent stale publication. Old publication survives source/profile rebuild until complete replacement. Profile identity includes corpus policy: same vector space is NOT implicit policy compatibility; a new policy cannot serve old-policy snippets. Readiness is declared, not refused: semantic/hybrid rank only publications of the active profile and report the in-scope sources without one as `RetrievalPage.pending`. Explicit same-version restoration after remove enqueues a fresh generation.

Page limits must be positive; the caller owns its API/configuration ceiling. The
adapter binds the requested limit without imposing another page ceiling; ANN
candidate windows remain independently bounded.

`search(c,query,vector: Option[List[Double]])` uses lexical HEAD exact/unbounded scope or exact profile+embedding-space matched published semantic/hybrid candidates (1000/leg), original-vector exact cosine rerank, RRF k60 and deterministic best-chunk entity grouping. The semantic leg keeps each source's best chunk in a window of at most 1000 sources. A namespace with at most `CandidatePolicy.exactScanChunks` (20000) published chunks, counted per query with a bound of threshold+1, ranks that leg by an exact scan over the authorization join: the window is the nearest 1000 sources and semantic results equal the exact ranking. Above it the leg uses the HNSW index and keeps the distinct sources among the first 4000 chunks it returns (`candidatesPerLeg` × `annChunksPerCandidate`), so sources with more near chunks than that can still fill the read. The HNSW leg is approximate: it misses chunks the graph does not reach, e.g. ones inserted after a group of more than ~320 identical vectors (over 32 HNSW elements of 10 rows, whose neighbour lists then hold only each other). `visible(c,query,id)` supports fresh-transaction delivery-time reauthorization; never relabel pinned hits with new source metadata. Filters are typed bound exact equality, applied before each candidate limit/count. No caller SQL fragments. Model absence (`NotConfigured`) and a missing query vector (`EmbeddingFailed`) are typed unavailable, not fallback; `QueryVector(embedding,mode,text)` computes the query vector and maps a provider failure to `EmbeddingFailed`.

`IndexingWorker(index,transactions: RetrievalTransactions,embedder,batchSize,leaseSeconds,pollInterval,clock: IO[Instant],events: IndexingEvent => IO[Unit])` exposes `once` and `run`; the narrow transaction trait has `transaction[A](Connection => A): IO[A]`. Heartbeats renew fenced claims; retry/cancel preserves committed batches and never holds JDBC open during provider calls. `run` claims the next job right after a success and sleeps `pollInterval` only when idle or after a failure. Every failed attempt (error, cancellation, lost lease) reaches `events` as `IndexingEvent.AttemptFailed(namespace,sourceId,attempt,retryAt,code)`, a failed claim as `ClaimFailed(namespace,code)`; `line` renders identifiers and fixed codes only, never chunk text.
