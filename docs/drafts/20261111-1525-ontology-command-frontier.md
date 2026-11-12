# Primary external graph commands — Q56

Q56 revision 2 requires external `graph_apply` commands to retain a primary command Source and advance the source frontier atomically. This is implemented at both `GraphRepository.apply` entry points, not inferred from actor kind, transport or operation-name text. An Internal request trace through that entry point still denotes an external command for this accounting boundary.

## Ownership and publication

`GraphCommandEngine` wraps ordinary admission, producing one command Source and reusing the existing canonical GraphMutation input receipt. One successful batch publishes G+1 and F+1 with unchanged C, regardless of its operation count. Its Source identity is domain-separated from operation, input and generic capture identities; it is not a user alias. The Source context records the actual result references.

The Source text is the canonical submitted ApplyRequest. Occurrence is the service-observed request trace; reported contribution context is separate. Neither a command Source nor an authenticated contributor proves physical execution or Human presence. Public ingest cannot manufacture GraphCommand activity.

The shared `AdmissionEngine` remains frontier-neutral. Internal curator publication uses its separate path, so maintenance does not automatically retrigger itself. Owned memory/PostgreSQL runner controls cover both captured activity and command-only activity: one primary input produces one publication/model invocation, with no publication feedback loop.

Memory stages head, input, history, mutation index, primary records and outbox before assignment. PostgreSQL publishes these within the existing scope transaction. A late mutation-index insertion failure rolls everything back. An acknowledgment-loss control reconstructs the adapter and retrieves the original committed result.

## Retained integrity and replay

Replay returns the original result, changing only the response replay flag. It preserves the Source, receipt, occurrence, timestamp and frontier even after credential rotation. It first verifies retained command/index correspondence; it does not rebuild evidence from retry metadata.

Validation binds the canonical request, receipt, result aliases, Source and primary record. It reconstructs expected content using the retained pre-command snapshot and validated adoption evidence. The reconstructed principal is only an input to pure content validation, following curation integrity's precedent—not historical credential proof or fresh mutation authority.

At the publication generation, the entire expected snapshot must match. At later cuts, the complete command-attributed inventory must match in content and multiplicity, and all published record groups must remain exact. The latter includes actor records, which have no command provenance field. Raw historical reads for reconstruction avoid recursively revalidating every earlier command. A valid earlier snapshot remains readable when a later snapshot is corrupted.

Tests first reproduced acceptance of altered/extra attributed records and loss/relabeling of a command-introduced actor after a later capture. Both paths are now rejected, including through repository read/history/source/input/replay/outbox boundaries.

## Cutover and remaining scope

Migration 004 widens primary input kinds to include GraphMutation. It explicitly refuses a database containing pre-Q56 mutation rows; it does not invent historical Sources or frontiers. Such retained data requires a separately designed and authorized cutover. Tests use owned fresh PostgreSQL instances; no deployed database was migrated.

Fixture accounting now includes setup commands. Judgment tests select exact judgment identities rather than the first primary Source. Capsule work-context selection does not redact complete command evidence: affected records from another same-scope context may appear as supporting material, not selected work. Byte-bound tests still reject an oversized complete command Source rather than truncating it.

This milestone does not complete capsule persistence, concrete service/Main composition, worker/Pi integration, fenced RDF runtime projection, packaging or real-backend browser acceptance. It authorizes no deployment or Human study.
