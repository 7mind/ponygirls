# Trusted workflow v3 helpers

`workflow_v3.py` is an **owner-only in-process helper**, not an MCP tool, model
SDK, agent controller, provider loop or executable provisioning service. It never
launches PostgreSQL, a native server or a model. Existing workflow/Bridge files
and historical seeds are unchanged. No retained protocol-version or generated
codec-project layout is assumed: read probes use the actual MCP JSON tool shapes.

## Bound inputs and entry points

```python
from pathlib import Path
from workflow_v3 import BoundFile, WorkflowManifest, IngestLimits

manifest = WorkflowManifest(
    owned=BoundFile(Path('/absolute/owned.json'), owned_sha256),
    native_config=BoundFile(Path('/absolute/config.json'), config_sha256),
    model_catalog=BoundFile(Path('/absolute/model-catalog.json'), model_catalog_sha256),
    fixture=BoundFile(Path('/absolute/fixture.json'), fixture_sha256),
)
limits = IngestLimits.from_config(manifest.native_config.json())
```

`model_catalog` is the SQL-derived **index profile/embedding space catalog**, not
the model's MCP tool catalog. `owned.json` retains the existing Bridge manifest
shape, including exact native executable/PID/origin/ELF hash, runId, Read/Ingest
credential paths and catalog/profile hashes. All four files require absolute,
regular, nonsymlink paths and exact raw byte hashes. `fixture_sha256` is a property
of the fixture binding. The passed fixture object must match the bound JSON
values/types ignoring object-key order; reserialized JSON is **not** reported as
the original raw-file hash. Bound config/catalog/origin/profile relationships are
checked; caller remains responsible for launching that exact frozen config.

Production entry points, with all arguments explicit:

- `provision_documents(manifest, fixture, directory, limits) -> receipts`
- `verify_publication(sql, manifest, fixture, fixture_sha, receipts, output, rubric)
  -> (catalog, eligibility_proof)`
- `fixed_retrieval(manifest, fixture, task, mode, catalog, output) -> wrapper`
- `fingerprint(sql) -> {policy, tables, sha256}`

The caller creates a fresh real empty output directory for each phase. The public
wrappers preserve declared attempt inputs and explicit setup failure metadata;
outputs use exclusive creation and mode 0600. No overwrite, silent retry,
reindex, fixture alteration, annotation relabeling or supplemental content occurs.
A failed/uncertain ingest retains its request identity; do not resubmit it under a
new identity automatically.

The injected `sql(statement) -> str` closure must already verify the **owned**
PostgreSQL PID/executable/data/listener/credentials and enforce the existing 5s
statement / 8s process deadlines. It runs against the pinned PostgreSQL 18.6,
UTF-8 controlled database with the repository migrations and pgvector installed.
The helper emits SELECT/CTE reads only. It creates no SQL credential manifest,
external controller or subprocess. Timeouts/errors fail setup; they do not
increase deadlines or establish a product regression.

## Trusted ingestion boundary

`IngestLimits` is immutable and constructed from the actual bound config's
`maxBodyBytes/maxFileBytes/maxFiles/maxMessages`. It validates positive integer
limits and refuses to exceed the authorized 8 MiB body / 4 MiB raw file / 10000
message envelope. The request also satisfies the bound (possibly smaller)
limits before any send. All documents and credential prerequisites are checked
before the first ingest submission.

`prepare_ingest(document, run_id, limits, request_id)` preserves supplied message
roles (missing old-adapter role is `user`), text and raw JSONL fidelity, sets
parent/timestamp null and consecutive recordIndex, and computes exact UTF-8 file
and concatenated source digests. Paths are fixed safe relative raw file paths;
document/run identities cannot escape artifact directories. Namespace is
`context-eval-v3`, discovery root `synthetic`, producer identity `runId-docId`,
project `relevance-<runId>`, expectedRevision 0, with a fresh UUID request.

The raw request retains input NUL. Actual Core.SnapshotProjection replaces it in
archived messages with literal **six ASCII characters** `\u0000`, never removal;
preflight uses the corrected stable source oracle. Other Unicode is preserved.
Raw JSONL is distinct from the normalized archive projection.

`TrustedIngestClient` has only a fixed `/api/ingest` POST route on a numeric
loopback origin. Production uses ProxyHandler({}) and NoRedirect, existing Bridge
ownership checks before/after, fresh 0600 regular nonsymlink credential reads,
and exact bound static-token owner + Ingest-only scope. Config limits must still
match the supplied limits. The receipt is capped at 4096 bytes; socket and
exclusive main-thread wall deadline are 30s. A preexisting real-time signal timer
is an explicit incompatible prerequisite, not silently replaced. Receipt UUIDs,
request identity and fresh revision 1 are validated. Headers/tokens are never
written to artifacts.

`<doc>.request.json` is the **exact sent body**. `<doc>.receipt.json` retains exact
HTTP receipt bytes, including whitespace. `receipts.json` is the separate parsed
receipt map. Per-document proof hashes bind exact request/receipt bytes and source
JSONL digest, sizes and principal, without credentials. A prior implementation
hashed a reserialized receipt; a preserved regression RED preceded correction.

This is deliberately separate from the unchanged small read-only Bridge budgets:
65536 bytes/call, 1048576 cumulative bytes, 64 calls, 60 seconds. No subclass,
budget override or model ingestion authority is introduced.

## Publication and source preflight

Source/schema evidence was read from all actual migrations and
Core/ArchiveProjection/SearchPolicy/IndexProfiles/Database/Models/IndexCheckpoints,
not invented columns or vector functions. SQL selects only source metadata,
UTF-8 length and `encode(sha256(convert_to(value->>'text','UTF8')),'hex')` hashes;
it does not return giant text, revision snapshots or vectors to Python/JVM.
This bounds transferred proof data, **not** database decompression/CPU cost.

For every closed `reader`/`restricted` document, preflight checks receipt-bound
UUIDs and native ingest receipt membership, live owner, nonretired current
publication/revision, exact run namespace/project, bound profile/owner target,
Complete job/run identity and actual completed window count. Every message must
match id, role, dense position, recordIndex, normalized byte length and SHA-256.
Accepted annotation windows are checked; embedding checkpoint vector-array counts
must match actual stored piece count (computed in SQL, vectors never returned).
The source publication is reread to detect changes while checked.

The finite eligibility gate is **at least 1001 actual current published compatible
reader-authorized Problem retrieval pieces inside the exact project filter**,
not sessions and not an archive-fragment lower bound. Candidate SQL follows the
actual visibility/group ACL, publication/revision, profile-space compatibility and
vector dimension predicates. It checks piece/chunk/search links, rejects unknown
corpus session injection, invalid/zero/nonfinite stored vectors, and records
session/distinct-vector counts as descriptive metadata, not quality evidence.
`vector_dims` and `vector_norm` are the repository's actual supported functions.

Every rubric anchor and qualifier must be covered by actual Problem spans **and**
chunk/search source links; adjacent ranges merge across passages/pieces, holes do
not. Source positions and Unicode scalar endpoints must match the frozen source.
Expected Problem messages need actual indexed coverage, not necessarily complete
Problem classification of unrelated giant-message body. Expected Context messages
need full Context coverage and zero Problem/chunk/search overlap. Other actual
Context/Problem overlap also fails. Nothing infers Problem status from publication
or answer success. The complete rubric is validated against the bound fixture and
constructed catalog, so unknown required documents cannot silently disappear.

Small public probes use the unchanged Bridge: exact Read-only whoami for both
distinct principals and get_chunks(offset=0,limit=1, flat revision/generationId)
for each publication. No get_session(first100), whole-message reads or giant
snapshot transfer. Pins/counts and literal single-span probe source bytes are
validated separately from SQL source proofs. Legacy multi-span diagnostic remains
explicit; no fabricated whole-message source or model observation is created.

Catalog shape retains `fixtureSha256/documents[sessionId,view,principal,jobId]`,
index coverage and exact provenance hashes. Proof labels explicitly say **trusted
owner source proof, not agent-observed evidence**. Native Complete jobs/accepted
checkpoints and bound model descriptors are structural evidence; genuine external
provider execution and source/native binding still need the caller's retained
controlled-run evidence. This finite fixture does not prove general ACLs.

## Retrieval-only fixed baselines

`fixed_retrieval` requires the frozen per-mode fixedQueries policy
`lexical-curated-keywords-semantic-hybrid-natural-question-v1`; missing new mode
queries fail, with no fallback to task.query. Its one read is search_sessions with
actual assigned query, mode, exact project, limit 5, offset 0 and declared task
principal. It never retrieves hit messages.

Outputs: `fixed-retrieval-v3.json = {request: actual_sent_args, result: SearchResult}`,
original raw SearchResult value sidecar `retrieval.json`, request sidecar
`request.json`, and the production Bridge's actual request/result trace. In this
context “raw SearchResult” is the unchanged parsed result object, not the outer
HTTP/MCP envelope bytes (old Bridge owns its transport capture). Curated lexical
keywords versus semantic/hybrid natural questions are **not a same-query lexical
comparison**. No relevance/success answer is manufactured.

## Hash-only immutable-state policy

`digest-state-v3` uses the **same 16 tables** and same six selected jobs columns as
the original fingerprint, not the initially miscounted 19. No old fingerprint or
historical seed hash is changed or relabeled. For each allowlisted table, one
SELECT hashes `row_to_json(t)::text` in PostgreSQL, orders fixed 64-character row
hashes by its stable primary key and hashes their fixed-width concatenation.
Count is bound separately. Only table name/count/digest leaves PostgreSQL; an
overall canonical JSON hash includes the explicit policy and table summaries.

Jobs include only id/session_id/revision/profile/state/run_id, excluding leases,
attempts and transient progress as before. Other exclusions inherit the original
scope (not a claim to fingerprint every database/security table). This does not
attest physical HNSW index state or provider quality. Do not compare v3 hashes to
`legacy-full-state-v1` hashes; the parent binds/dispatches policy explicitly.

## Tests and evidence boundaries

`provision_with_client`, `verify_with_bridge` and `fixed_with_bridge` are explicit
in-process composition seams. Tests use stateful handwritten ingest/HTTP/source/
index/fingerprint stores, not auto-generated mocks, fake Popen or credentials for
an external service. Source-vector/piece counts are derived from the manual
store; responses are not evidence of a real publication. Test labels are
Behavioral-Active/Blackbox-Group, specified origin plus retained direct-audit REDs.

```bash
python3 -m unittest discover -s chronicle/eval/relevance/tests -v
node --test chronicle/eval/relevance/tests/*.test.mjs
```

These tests establish Python contract behavior, not actual SQL syntax/execution,
real native HTTP/provider behavior or genuine index eligibility. Parent must run
owned native roundtrips and actual SELECTs under the retained deadlines before
trials, preserve all failures, freeze all helper dependencies, and run affected
full application suites. Do not manage any unowned embedding listener/process.
