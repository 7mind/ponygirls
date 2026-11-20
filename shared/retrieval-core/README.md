# Retrieval core

Namespace `ponygirls.retrieval`; all public arguments are explicit.

- `EmbeddingSpace(model,revision,dimensions,sendDimensions,queryPrefix,documentPrefix,normalization)`: immutable v2 model/semantic identity, byte-identical to Chronicle. Endpoints and credentials are transport, not model identity. `revision` must identify the immutable artifact and any runtime/quantization/pooling semantics.
- `EmbeddingSpace.verified(id,descriptor)` verifies a stored v2 descriptor and returns the model-only identity; anything else, including a retired v1 descriptor, is `unavailable`. It does not attest provider weights.
- `RetrievalProfile(space,policy)`; service owns corpus/projection policy.
- `InputChunk(id,text,ChunkProvenance(field,pointer,start,end))`.
- `SourceProjection(id,version,chunks,attributes,audience,eligible,archived,expiresAt)`.
- Attributes: `Vector[ProjectionAttribute(AttributeKey.parse(key),AttributeValue(value))]`.
- Filters: `Vector[AttributeFilter]`, currently `AttributeFilter.Equal(key,value)`.
- `EpochSeconds.fromDouble` preserves the exact binary64 value (not a microsecond timestamp). Query time is caller-bound, explicitly `EpochSeconds`.
- `RetrievalQuery(principal,text,mode,filters,includeArchived,offset,limit,now)`.
- `RetrievalPage(hits,total,countScope,rankingLimit,pending)`; hit carries immutable version/generation/profile/space/provenance. `pending` counts the sources inside the query's scope (audience, filters, archived, expiry) whose current head has no publication under the active profile; lexical reports 0.
- `RetrievalError(code,detail,reason)`: query-time unavailability is `code = "unavailable"` with `reason = Some(UnavailableReason)` from the closed set `NotConfigured` (`not-configured`, "semantic retrieval is not configured; lexical-only capability") and `EmbeddingFailed` (`embedding-failed`, "query embedding failed"); build it with `RetrievalError.unavailable(reason)`. `reason.text` is the fixed client-safe message.

`CandidateSql` is the shared ANN/original cosine/RRF ranking implementation. It accepts validated column identifiers, never caller/user SQL predicates. Service authorization stays in the candidate SQL relation before each limit. `CandidatePolicy.exactScanChunks` and `annChunksPerCandidate` are the exact-scan threshold and HNSW read-ahead of `retrieval-postgres`'s semantic leg (Chronicle builds its own leg). `Fusion` is a deterministic in-memory reference, not a claim that ANN is exact.
