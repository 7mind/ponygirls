# Retrieval core

Namespace `ponygirls.retrieval`; all public arguments are explicit.

- `EmbeddingSpace(model,revision,dimensions,sendDimensions,queryPrefix,documentPrefix,normalization)`: immutable v2 model/semantic identity, byte-identical to Chronicle. Endpoints and credentials are transport, not model identity. `revision` must identify the immutable artifact and any runtime/quantization/pooling semantics.
- `EmbeddingSpace.verified(id,descriptor)` verifies stored v1/v2 descriptors and returns the model-only identity; it does not attest provider weights or authorize a metadata migration. See [the explicit migration procedure](../../docs/drafts/20261105-2142-model-identity-migration.md).
- `RetrievalProfile(space,policy)`; service owns corpus/projection policy.
- `InputChunk(id,text,ChunkProvenance(field,pointer,start,end))`.
- `SourceProjection(id,version,chunks,attributes,audience,eligible,archived,expiresAt)`.
- Attributes: `Vector[ProjectionAttribute(AttributeKey.parse(key),AttributeValue(value))]`.
- Filters: `Vector[AttributeFilter]`, currently `AttributeFilter.Equal(key,value)`.
- `EpochSeconds.fromDouble` preserves the exact binary64 value (not a microsecond timestamp). Query time is caller-bound, explicitly `EpochSeconds`.
- `RetrievalQuery(principal,text,mode,filters,includeArchived,offset,limit,now)`.
- `RetrievalPage(hits,total,countScope,rankingLimit)`; hit carries immutable version/generation/profile/space/provenance.

`CandidateSql` is the shared ANN/original cosine/RRF ranking implementation. It accepts validated column identifiers, never caller/user SQL predicates. Service authorization stays in the candidate SQL relation before each limit. `Fusion` is a deterministic in-memory reference, not a claim that ANN is exact.
