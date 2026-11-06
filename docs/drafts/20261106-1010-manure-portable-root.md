# Manure portable root identity — implementation and procedure review candidate

**This document is not execution authority.** An operator must separately authorize
binding migration, publication/deployment, projected token/RBAC provisioning and
application forwarding. Configured operational backup **and successful restoration**
remain independent production prerequisites. Preserve authoritative sources and do
not promote a retained import merely because staging recovery succeeds.

The current revision moves the deployment-specific CSI driver pin into required
trusted configuration. Its integrated acceptance passed:163backend/32storage,
339native,8installed-client cases and13portable-VM check groups, zero failures,
errors or skips. Current evidence is
`/nix/store/bkpbczqipsb24xxy3bkb158m8d8s7j2w-manure-current-acceptance-composition`;
current ELF SHA256 is
`db6d97a4bbd9f4dc42d0409144370ce707bbda4940c063e893517f055c168d18`.
Earlier code-pinned receipts below remain historical evidence, not a substitute
for this revision. Main integration preserved the exact native/acceptance build graph.

Prior code-pinned JVM snapshot (historical):161 backend tests/15suites and32 storage tests/1suite, zero
failures/errors/skips. The corrected source-bound static-musl ELF passed the complete
339-case native target/browser inventory plus Node/codec gates, including four
explicit opt-in/maintenance regressions. A contained VM separately passed native
plan-only, explicit16→76-byte binding migration and fresh-Pod exact replay against
owned PG, controlled TLS authority and a private guest ext4 volume. Extended native
V2 startup/auth/fetch, schema reconciliation, wrong-CA/SAN denials, held-root refusal,
modeled foreign-volume/marker/copied-inode refusal and restored-root reopening also
passed in that VM. The final in-tree mandatory composition also passed:161backend,
32storage,339native and8installed-client cases, plus13 completion-recorded portable
check groups with exact source/ELF binding. These inventories overlap and are not
summed. The actual native cross-network-namespace `serve` contender refused with
`root-locked`; exact guest residue and unmount checks passed. No actual Kubernetes
authority, attachment or node-handoff acceptance has run. Independent source review is advisory,
not procedure approval.

## Why this exists

Retained staging evidence09:42:29 shows the same PVC/directory inode7864321 after
rescheduling, while Linux device number changed64800→64816 (253:32→253:48). The
original16-byte `root_owner` binding correctly refused startup with
`migration-required`. These are historical observations, not current readiness checks.

Descriptor-local device/inode checks remain necessary for no-follow traversal, root
replacement and operation leases. They are not portable ownership. A copied
filesystem UUID/marker and a caller-selected attachment device label alone are not
independent clone authority; see <https://kubernetes.io/docs/concepts/storage/persistent-volumes/#csi>.

The old abstract AF_UNIX claim was also namespace-local: a real owned JVM holder did
not exclude a contender in another owned network namespace (expected exit3, observed0).
After adding a directory-inode `flock`, the same probe denied the contender (exit3)
and allowed it after the owned holder exited (exit0).

## Narrow supported authority and trust boundary

The opt-in `root_authority` adapter supports explicitly qualified CSI block-backed
**ext4/xfs** deployments, not arbitrary NFS/RWX/FUSE/tmpfs/overlay storage. Required
`expected_csi_driver` pins the exact authenticated PV driver; it is deployment policy,
not volume ownership proof. A driver mismatch refuses. Moving this pin out of source
does not qualify untested providers or replace independent attachment-fencing checks.
It trusts the API's TLS/authentication, kubelet/CSI honoring the observed mount mapping,
the kernel, and the provider enforcing actual single-node attachment fencing. A RWO
label alone does not prove fencing. API declarations are not hardware attestation
against a malicious kubelet/CSI implementation. Privileged mount manipulation and
hostile same-UID filesystem mutation remain outside the existing confinement boundary.

Configuration fragment (illustrative, not a deployment manifest):

```json
{
  "root_authority": {
    "kind": "kubernetes-csi-v1",
    "expected_csi_driver": "storage.example.test",
    "api_origin": "https://kubernetes.default.svc",
    "ca_file": "/run/root-authority/ca.crt",
    "token_file": "/run/root-authority/token",
    "pod_uid_file": "/run/root-authority/pod-uid",
    "namespace": "nexus-team-tools",
    "pod_name": "core-0",
    "container_name": "manure"
  }
}
```

Required future deployment review:

- Exact-resource GET for the selected Pod/PVC/PV, including a separate control volume
  if used. No list/watch/write permissions or automatic credential acquisition.
- A read-only pod-bound projected API token and an independent read-only downward-API
  `metadata.uid` file. The adapter rereads rotating files and matches the token's bound
  Pod UID to both that local projection and the API Pod. A copied token alone is not
  the local Pod witness. API authentication validates the token; locally decoded JWT
  claims are not treated as signature verification.
- CA/token/UID input paths must be absolute/normalized and outside the writable payload
  and imported-control roots. Current core token automount is disabled; this task has
  not provisioned any of these projections or permissions.

An observation performs Pod→PVC→PV→Pod GETs. It requires exact names/kinds/UIDs,
non-deleting resources, Bound reciprocal claim UID/name/namespace, filesystem RWO or
RWOP access, a driver exactly matching `expected_csi_driver` and an immutable opaque
volume handle. Driver names are canonical DNS names; handles are nonempty valid UTF-8,
contain no control characters and are bounded to256UTF-8bytes. The driver/handle
digest recipe is unchanged, so the same original identity retains identical bytes. It rejects ephemeral Pod-owned PVCs, read-only payload mounts, subPath,
subPathExpr, propagation and ambiguous covering mounts. Token/UID files must map to
read-only projections with the expected source fields.

The kernel check binds the pinned root descriptor's filesystem type/device major/minor
to the exact longest covering mount entry and the declared mount's actual filesystem.
It requires the whole filesystem mount root `/`, writable ext4/xfs and private
propagation (an `unbindable` private entry is permitted). Shared/slave/propagate-from,
subtree, unexpected nested covering mounts and unsupported filesystems refuse.
Unknown optional mount fields also refuse rather than silently widening support.
This correlates descriptor filesystem observations with the mount table; it is not
independent hardware or visible-mount-ID attestation. Correct runtime mapping remains
an explicit kubelet/CSI assumption. The development
host's `/` was independently observed as `shared:1`; it is not assumed a qualifying
portable volume.

Bounds are deliberate deployment preconditions: each API body≤64KiB, mountinfo≤1MiB,
request including its body≤5seconds and observation≤15seconds. No redirects, ambient
proxy, token/API-body logging, UUID/device-label fallback or hidden retries. Oversize,
forbidden, malformed, incomplete and unavailable observations refuse. Dense/oversized
Pod deployments need a separately reviewed contract change, not a silent cap bypass.

## Ownership format and exclusion

With authority absent, legacy16-byte big-endian device/inode bindings and original
physical first-adoption policy remain unchanged. Authority-enabled normal startup
requires an applied portable binding: it refuses unbound and unmigrated V1 roots
before schema/adoption effects. It never silently adopts V1 or upgrades it. Pending
receipt/marker/preparation state remains a prior refusal; an unbound import cannot
use portable planning as adoption.

V2 is76bytes: `MNR2` +32-byte driver/handle digest +8-byte root inode +32-byte marker
digest. `.manure-root-owner-v2` contains exactly32 random bytes. Normal observation
never creates or repairs it. The hash is an identity fingerprint, **not a signature**.
The marker alone never establishes volume ownership.

Pod/node/device and Pod/PVC/PV object UIDs are not permanent disk identity. The driver
and immutable provider handle, inode and marker distinguish another volume, directory
copy, reformat/inode reuse with a foreign marker, and copied-marker volume clones under
the stated trusted-runtime premise. Actual cloud-clone/reformat acceptance is pending;
controlled handle/inode/marker negative tests are not that acceptance.

A nonblocking directory `flock` is acquired before JDBC/schema/recovery/HTTP and held
through lease, stream and resource drainage. It excludes cooperating new processes on
the same kernel across network namespaces. Existing descriptor/no-follow/revalidation
checks and the old namespace claim remain. The lock covers this root inode, not every
directory on a volume. Cross-node exclusion still requires real storage attachment
fencing. **Legacy binaries/controllers must be stopped and fenced externally.** An empty
`pg_stat_activity` sample is a diagnostic prerequisite, not proof of that exclusion.

Portable ownership observation is non-adopting. Authority-absent legacy initialization
can still perform original physical first adoption after its existing checks; it is
not independently attested portable adoption. Full runtime initialization may perform
same-definition schema/projection reconciliation; no claim of zero physical writes is
made for ordinary application startup.

## Native maintenance commands

```bash
"$REVIEWED_BIN" plan-root-identity "$PRIVATE_CONFIG" "$PRIVATE_PLAN" "$PRIOR_VOLUME_EVIDENCE_REFERENCE"
"$REVIEWED_BIN" migrate-root-identity "$PRIVATE_CONFIG" "$PRIVATE_PLAN" "$EXPECTED_PLAN_SHA256"
```

These are templates, **not instructions to run now**. The CLI validates the plan SHA;
it does not establish human approval, enforce an approval deadline, or independently
pin its own executable/configuration digest. The plan and receipt also contain no
complete configuration or executable digest: a substituted CA/token/native-library
configuration is not detected merely by matching its DB/path fields. The reviewed
operator procedure must pin and retain the exact complete config and executable in
its external execution envelope before every invocation.
Do not call a fingerprint an authorization token.

### Plan

Planning takes scoped physical claims/leases, reads the existing DB/root/authority,
checks no other database client, and writes only the requested create-new0600 plan.
It does not initialize the application graph, create a marker, reconcile data, change
the binding or create the migration receipt table. Output must be outside payload,
control and `/nix/store`; real-parent alias checks prevent writing through an alias.

The strict versioned≤32KiB plan binds DB URL/user/name/OID, payload/control paths,
original legacy bytes, observed physical and API witnesses, marker, destination and
optional imported-receipt witnesses. It records an external continuity reference.
**V1 has no historical provider ID:** a nonempty reference is not native proof of the
prior volume. Independent reviewed provenance is mandatory; matching counts or copied
content cannot manufacture it.

### Apply and recovery

First apply requires the exact reviewed plan hash, complete current witness/physical
match, same DB/config paths/destination and exact old binding. Before pending intent
exists, a changed device, Pod/PVC/PV UID or mount witness requires fresh planning and
review, even if durable volume identity is unchanged. `contextRefreshed` is therefore
false on initial application; it describes only identical-intent recovery/replay.
Apply then:

1. Commits an immutable pending intent (creating its separate receipt table/function/
   guard only if absent; original migration ledger versions1..3 are unchanged).
2. Creates a plan-specific preparation file; partial replay accepts only its exact
   expected prefix. It writes/fsyncs the32bytes, publishes with `RENAME_NOREPLACE` and
   fsyncs the root directory. No foreign marker is overwritten or deleted.
3. Revalidates and CAS-transitions the exact old binding to V2 while sealing the same
   pending row as applied in one DB transaction. Original legacy/plan bytes remain.

The receipt guard permits only pending→applied, not ordinary UPDATE/DELETE of its
identity/definition. Missing/disabled/changed guards refuse rather than being repaired.
No auth, payload, imported control receipt or unrelated metadata rewrite is permitted.

After a crash/uncertain acknowledgement, preserve the plan/hash, marker/preparation and
pending/applied state. Ordinary V1 startup remains refused. There is no automatic
abort/delete/replan or rollback of ambiguous marker state. **Only that exact immutable
intent** may resume/replay; retain the plan outside the data/control roots. Lost-plan,
changed binding/DB or conflicting/corrupt state requires operator investigation, not
superuser editing disguised as recovery.

On an existing identical pending/applied intent, fresh authority may observe changed
Pod/PVC/PV UIDs, mount witness or node-local device number. This is an explicit replay
policy, not durable object-UID ownership: the same CSI driver/handle, root inode,
expected marker/prefix, old-binding CAS, DB target, configured paths, destination and
imported receipt witnesses still must match. No plan/receipt is rewritten. CLI
`contextRefreshed` reports whether the current witness/physical observation differs
from the original plan; it does not mean a durable audit record was updated. The
operator must capture fresh observations and the command result externally. Every
resume outside its reviewed permission window needs fresh approval/reinspection.

## Imported roots

The original OWNER/COMPLETE/PAYLOAD bytes, their exact SHA-256 hashes and original
physical tuples are retained. Migration independently observes the control volume and
binds its inode and those hashes into the immutable plan. Portable startup uses only
that exact accepted old-tuple mapping after payload/control authority checks. This
allows node-local device renumbering without rewriting historical receipts.

First adoption still performs the complete original inventory comparison. It never
filters the V2 marker/preparation files to bless a copied root, and portable planning
requires a preexisting legitimate legacy binding. A normal already-bound root needs
no new control directory or payload reorganization.

## Review/execution checklist — all live steps remain blocked

The supported entry is an already legitimate V1 binding with schema migrations1–3
present, not a fresh unbound root. Do not create a V1 binding merely to qualify an
unknown root for conversion. With authority configured, ordinary `migrate CONFIG`
also refuses unbound/V1 state; it can perform schema reconciliation after the
explicit identity migration has applied. Any separately needed older schema upgrade
uses its existing reviewed legacy policy before opting in, never an ownership-check
bypass or direct binding edit.

1. Review code/native ABI and this procedure; verify actual SRE ownership, configured
   backup and successful restore before production import. No source freeze/handoff,
   client cutover, HM activation or retirement is implied by staging recovery.
2. Retain a private execution envelope: reviewed native ELF/source/config hashes,
   target cluster/namespace/DB/root/PVC/PV/provider observations, original binding and
   imported hashes, continuity evidence, exact approved effects, owner/approval
   reference and a finite permission deadline. Requalify credentials/clock immediately
   before an operation; historical observation or an expired window is not authority.
3. Establish old-volume continuity independently. Retained pre-reschedule mappings,
   immutable API object/source history and attachment/audit records may contribute;
   no complete continuity proof is claimed here. Stop on missing/conflicting evidence.
4. Review minimal projections/RBAC and actual provider attachment fencing separately.
   Stop/fence every legacy writer/restart controller. Preserve authoritative sources
   and rollback material. Do not pin a node as a purported permanent identity fix.
5. Run plan only within its approved scope; compare before/after ownership, metadata,
   payload/control hashes and named plan output. Review plan and continuity evidence.
6. Recheck the external hashes/deadline, full target identity, exclusions and fresh
   authority; only a separately authorized operator may apply. Capture exact output.
7. On any uncertain result, inspect the exact plan/receipt/marker and current logical
   identity. Follow the explicit replay policy; never rewrite bindings or remove a
   foreign marker. Keep service/forwarding blocked if preconditions cannot be proven.
8. Separately qualify native auth/payload/import preservation, provider clone and real
   node-handoff/concurrent-writer behavior, then all five HTTPS application acceptance
   gates. No readiness/cutover inference follows from an HTTP probe or successful CLI.

## Evidence and outstanding acceptance

Private evidence is retained outside Git under
`debug/20261106-1003-manure-portable-root/` in the parent workspace:

- Pre-change126backend/29storage baseline and legitimate V1 device-renumbering refusal.
- `root-network-namespace-fail-first.log` → `root-network-namespace-fixed.log`: real
  same-kernel cross-network-namespace contender denial and release after exit.
- `review-regressions-fail-first-v2.log`: three intended semantic failures before
  corrections (pending Pod refresh, authority paths in payload, propagated mount).
  An earlier test compilation error is not part of that reproduction evidence.
- `extended-migration-tests.log`, receipt
  `manure/backend/target/validation-runs/20261106T112352Z.2gdjYb`:157backend/32storage,
  all positive and zero failures/errors/skips. Six injected checkpoints, pending exact
  replay, partial/foreign marker, stale/conflicting plan, immutable SQL guard,
  simulated historical device/Pod changes, byte-exact imported receipts, preserved
  artifact/auth behavior, directory clone and foreign volume/marker denials.
- Controlled real TLS API adapter tests use a dummy mount verifier; descriptor/kernel
  checks additionally use real filesystems and controlled mountinfo. Simulated old
  device tags and changed API object IDs are explicitly not a real Kubernetes move.
- A32KiB deep malformed JSON reproduction survived with the expected domain refusal;
  the proposed parser-stack-overflow hypothesis was not reproduced and was not patched.

- `portable-optin-fail-first.log`: two semantic startup failures before correction
  (authority-enabled unbound adoption and unmigrated V1 startup were wrongly allowed).
  `portable-optin-fixed.log`, receipt `20261106T121050Z.wvYx7m`:161backend/32storage,
  zero failures/errors/skips, including unknown-CA and wrong-SAN refusal before any API
  request. Existing pending-without-marker startup refusal remains tested.
- Earlier candidate ELF SHA `cdf084d6049e104f1a209e038f40fa6ef84de483033da5c2c4987eace92d3675`
  passed full native inventory335/335 and separate Node/codec gates. Its first gate
  attempt stopped before tests because two declared shared-source witnesses were
  omitted from the filtered bundle. A fail-first source-closure assertion reproduced
  this; the bundle now derives exact leaf references from the unchanged owner registry.
  Positive closure and negative unrelated/server-source tests pass. This input fix did
  not alter that ELF. Neither this baseline nor its host mount refusal covers the
  subsequent opt-in startup correction.

- Prior code-pinned source-bound ELF SHA
  `6d684d134c2f29a7c92f91053ced14b4c7b4973b95e765d2ccd61dd397304fdf`
  passed339/339 cases with zero failures/errors/skips/expected failures/unexpected
  successes, exact inventory equality and Node/codec gates. The four new startup
  refusal/maintenance-stage cases are included, not inferred from the335baseline.
- A contained VM executed native plan-only/explicit migration/fresh-Pod replay on
  owned PostgreSQL, controlled TLS API and private guest-owned whole ext4 volume.
  Its extended receipt is
  `/nix/store/x8cc30ydbf1422cviclxndkj36bchyi8-vm-test-run-manure-owned-portable-native/portable-native.log`:
  native V2 startup/auth/fetch, schema reconciliation, unknown-CA/wrong-SAN refusal
  before HTTP, held-root denial, modeled foreign handle, tampered marker and same-volume
  copied-inode refusal, then restoration/reopening all passed on the same corrected ELF.
  A prior extended attempt failed in the owned Python TLS listener fixture after only
  the unknown-CA check; the fixture correction did not change production code.
  This is not real Kubernetes authentication, actual CSI attachment fencing or a
  node handoff.
- The probe is now `manure/tests/portable_root_probe.py`, executed by the Linux
  `manure-portable-root` VM check, not Python unittest discovery. The public Linux
  `manure-unittests` composition requires it alongside JVM, installed-client and
  full native gates, with exact artifact/runtime/test-source/hash equality. Its
  final in-tree receipt is separate from the private V5 snapshot:
  `/nix/store/3s03w7hy54d4lxd6nqrl2c37zx3xi82f-manure-current-acceptance-composition`.
  JVM161/32, native339, installed-client8 and all13 portable check groups passed,
  with zero failures/errors/skips and exact shared test source
  `/nix/store/4j28myphda6y6hr9rh256a59x0b30ncr-manure-target-tests-source`.
  The portable VM is
  `/nix/store/27rc3cyyv02hc8j28pa86cnk0aya8g08-vm-test-run-manure-owned-portable-native`:
  checks are recorded only after their assertions complete; the other-network-namespace
  contender runs actual native `serve` and requires `root-locked`. The same-namespace
  planner may hit the original abstract claim instead and is not sole flock evidence.
  Exact guest residue and unmount checks passed. Source closure also passed. Final
  independent source/procedure review found no remaining in-bound blockers; this is
  advisory review, not human procedure approval or real CSI acceptance.

Remaining: human procedure review, a separately authorized execution/deployment
envelope, genuine Kubernetes/RBAC/CSI clone-fencing/node-handoff evidence, and all
five-domain acceptance. Q25 independently retains the SRE backup/restore gate. Host user-namespace
privatization was unavailable and no host policy was changed or mount guard weakened;
a contained disposable VM fixture is being used instead. No deployment readiness is
claimed.
