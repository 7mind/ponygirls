# RDF target identity and checkpoint observation

The resource-managed projection now requires an explicit target ID and incarnation allocator. An owned Memory allocation starts a new store. Native reopening retains its persisted identity and does not allocate another incarnation.

One canonical, versioned identity occupies a reserved metadata graph outside all scope graphs. Opening validates its complete shape, format and exact target. Only a globally empty, unidentified store can initialize identity. Existing unidentified data, partial/extra metadata, unsupported formats and wrong targets fail closed without automatic stamping or repair. Identity installation rechecks within its write transaction. Resource cleanup is registered before initialization and qualification; the borrowed opening factory does not own repository shutdown.

A handle caches its opening binding, not a fresh readiness assertion. Every publish, read, traversal and observation verifies that the persisted identity still matches. Removing or replacing identity invalidates an open handle, including observations of absent scopes.

`observe(scope)` discovers the generation and validates the complete snapshot/index in one read transaction, returning both that snapshot and its instance-qualified checkpoint/digest. Absence is scope-specific. Partial checkpoints and negative generations are corruption, not absence; publication no longer silently replaces nonempty scope data missing its checkpoint.

A stored or copied identity does not establish physical-store uniqueness, shared-storage equivalence or authority correspondence. A publication return value alone is not acknowledgment evidence. The fenced session/ACK facade, incarnation-qualified scheduling and runner resource hook remain unfinished. Existing unqualified outbox APIs must not be treated as the completed runtime protocol.

Controls cover Memory and Native stores, reopening, wrong targets, unidentified data in default/scope/reserved graphs, malformed/duplicate/extra/unsupported identity metadata, concurrent opening, failed allocation, lock release, identity changes and snapshot/index corruption. No host store was migrated or deployed.
