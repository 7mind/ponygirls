# First failed full-base Manure runtime — SAFE EVIDENCE ONLY

Immutable source fe4352; parent-approved run20261103T133136Z.7ccdae79 failed1.
This is a preserved failure, not VM/full-service acceptance and not a tested
rejection of strict (strict never booted). Source/time/assertions/containment
were not relaxed.

## Established scope

- Actual XML parsed: one stock-driver `main`, one failure, zero errors/skips;
  message `test case failed`. Not an application-case count. Startup stopped
  at edge manure readiness; no app assertions reached.
- Edge effective pre-exec audit passed with two attached images, and edge
  guest boot was observed. Strict has no audit record/boot. Final four-image
  postrun audit/crosscheck did NOT execute. Not whole-runtime containment pass.
- Requested policy kvm-or-tcg; actual runtime-manifest host KVM-accessible
  observation was false. **Selected accelerator UNKNOWN** without direct
  selection tracing. Earlier TCG wording was inference and is withdrawn.
- Provider prestart exited1, retried, then start-limit-hit. First cause unknown.
- Final offline metadata: root/data/socket/backups UID/GID71:71/0700; root
  names exactly backups/data/socket, no root marker. PG_VERSION exists size3
  and initialized PG directory names/postmaster.pid exist. No file contents
  read. No live-server/version assertion from those names. Persistent rootFS
  final snapshot has ~973MiB free. Not historical mode/tmpfs/RAM/OOM proof.
- Metadata is reached partial state, not provenance/chronology of the first
  failing attempt or proof which hook initialized it. Retry unmarked-data
  guard could be a consequence; do not diagnose it as original cause.

## Ownership/absence is distinct from failure

At13:35:09.693504Z the supervisor verified owned-subtree absence with retained
pidfds, subreaper orphan reaping and empty kernel children. Runtime failed1;
cleanup was successful (not a separately executed cleanup process exit0).
At13:45:04.813309Z all six recorded identities, including supervisor, were
absent. That fresh check concerns only recorded identities; not whole-host or
fresh unknown-subtree absence. No signals/cleanup were performed by this review.

## Privacy/provenance limits

Raw serial, environment, config, XML, audit JSON and images are NOT in this safe
bundle. Their approved bytes/digests are recorded where available. No SQL or
regular PG/file contents were read, and no whole-image hashing/conversion was
performed. Full original lab/raw evidence remain privately retained pending
explicit parent decision. The metadata observer source archive is private,
non-executable, reconstructed from the exact executed tool/heredoc text; its
hash was computed now, not an execution-time self-hash. Raw-byte reader and
ext4 source-segment hashes are separately given. No reexecution for bundling.
Filesystem metadata checksums were not verified.

`source-and-controls.json` records exact full-source/runtime/audit/full-base/
start/config identities, four kernel-only supervisor controls and source-review
scope. Those controls/review are not VM or application evidence.

No new guest, build, runner, execution authority, source patch or cleanup was
created/performed for this evidence bundle. Only approved own-debug archival
files were written. Future preparation is gated by the separate procedure.
