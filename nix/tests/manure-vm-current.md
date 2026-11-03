# Manure VM current-wire fixture port

Scope: `manure-vm.nix`, its guest-only current-client helper, and focused helper
checks. The function signature/callers are unchanged. No production service,
provider, package, credentials, legacy adapter, or lifecycle policy is patched.
This is fixture migration, not a product-regression diagnosis or a VM pass claim.

## Original invariant checklist (retained, not newly retired)

These are the original fixture's behavioral assertions, unchanged in intent:

| Original invariant | Current call / evidence |
|---|---|
| Two real nodes, no host store/dirs/certs/sockets/devices, no VLAN/interfaces/backdoor; actual owned services | Same `runNixOSTest` defaults/nodes; native ownership-ready proof; explicit `requiredFeatures.kvm=false` + `qemu.forceAccel=false` permit real TCG. Outer pre-exec attachment audit remains mandatory. |
| N1 custom storage root is0700 manure:manure | Original stat assertion unchanged. |
| Unauthenticated health through TLS; HTTP→HTTPS301 | Generated `Command.Version` on `/api/current`; same redirect status and exact destination path. Removed REST health is not accepted. |
| Direct invalid Host400, valid Host without trusted TLS403 | Current Version probes decode `BadHost` / `TlsRequired`, including reserved pre-envelope correlation ID. |
| Trusted peer's X-Forwarded-Proto honored; X-Forwarded-Host ignored; strict untrusted peer cannot spoof TLS | Same edge/strict cases through current commands and exact statuses/enum errors. |
| Loaded digest authenticates; cookie Whoami; login Origin required; bad token401 | `auth`: generated Login/Whoami, actual secure/HttpOnly/host-only cookie, missing-Origin403, invalid-token401, no rejection cookie. |
| Full internal handoff init/chunk/publish/grant/redeem/content bytes | Installed `ManureClient` current generated commands/raw chunk route; current ContentEnvelope redemption and exact `hello manure` bytes. |
| Launcher runtime config has credential paths, not digest material | Original two config grep assertions unchanged. |
| R5 manifest >1MiB but <4MiB admitted; >4MiB413 | `body-bounds`: generated InitUpload envelopes with the original2000/6000 manifest-entry corpus, same byte bounds/statuses. |
| Explicit default Host port passes; wrong port/host400 | Same three cases, generated Version and exact BadHost failures. |
| R6 query/header/user-agent canaries absent while sanitized request path/status remains observable | Original shared privacy helper/selftest, offset/status windows, redirect301, application404 and canaries retained; unknown current path replaces the removed prefix. |
| Upstream-refused502; separate access, every persistent error file, nginx journal and manure journal privacy | Original failure injection/channel checks retained; no invented application request-log schema. |
| Actual access-log `/dev/full` bind; changed nginx PID; worker FD inode equals device; real ENOSPC | Original mount/PID/FD/stat/write-error assertions retained. During the fault a single curl captures exact404 + generated current NotFound body and transport exit; journals remain canary-negative. |
| All four unsafe native nginx error channels disabled; restore/unmount; size unchanged; fresh sanitized records | Original context count, error-file loop, size and restoration checks retained. Positive post-restore record is now POST `/api/current`200. |
| M2 installed dashboard and external unlock HTML/JS/CSS byte equality and Referrer-Policy | `installed`: actual service MainPID executable equals installed native ELF; configured default share paths equal installed package paths; SERVED dashboard/current-codec JS/CSS and unlock HTML plus exactly2 resources match installed bytes, not checkout sources. |
| Correct SAN succeeds without `-k`; wrong SAN fails | Original curl CA/resolve controls retained with generated Version request/response validation. CERT_NONE helper probes do NOT establish SAN trust. |
| Real evaluated HM/yolo profile, hooks/cache/binds/env, exact yolo binary provenance | All evaluation pins and guest byte/path assertions retained. Real installed CLI, not a replacement uploader. |
| Standalone guard negative + enabled adapter occupied-cache negative prevents payload execution | Original guard/warning/file/sentinel assertions unchanged. |
| Absent custom cache bootstrapped through real host hook; whoami; token0600 writable outside but EROFS inside; cache writable | Original actual-yolo calls, token hash equality and shared token-RO checker unchanged. |
| Actual CLI SIGKILL137, durable nonempty incomplete receipts; cache contains no token/digest | `interrupt-upload` launches the installed CLI, waits its real PID after SIGKILL, retains ID/cache and proves progress; authoritative typed UploadStatus after the declared drain still must be nonempty/incomplete. Original cache privacy checks retained. |
| Same artifact resumed; already-acknowledged chunks not reuploaded; full fetch byte equality; cache cleaned | Same real HM CLI `--resume`; same-ID shared guard; exact missing-offset multiset/all200 from private nginx observer, byte equality plus SHA256, original empty-cache assertion. |

No additional historical tests are retired by this patch. The existing seven
architecture-retired modules remain exactly the allowlist in
`manure/docs/behavior-inventory.md`: `test_catalogue`, `test_server_http_opt_in`,
`test_server_lifecycle`, `test_server_limits`, `test_server_path_mode`,
`test_server_security`, `test_storage_durability`. Their domain/security/durability
requirements are not retired. This fixture does not redefine that register or
replace the current application's full target/native/browser suites.

## Explicit observer and fault qualifications

Current Scala Main emits `MANURE_READY` and sanitized startup failures, not the
retired Python `PUT chunks -> ...` / per-request journal format. CONTRACT's
allowlist/no-secret requirements do not mandate that old format. R6 now proves
actual backend request processing during a proven nginx log-write failure plus
separate-channel privacy and pre/post sanitized access observability. It does
**not** claim resilience of a nonexistent application per-request logger.

The second nginx log is PRIVATE TO THIS VM and resides at the same API-vhost
context as the original sanitized log (no inheritance replacement). A map admits
only the exact current chunk route, the literal fixture filename `hm-big.bin`,
and a canonical1..8-digit offset (including0). JSON contains only `uri`, `offset`, `status`:
no raw args, arbitrary filename query, headers, credentials or payload. The
post-baseline multiset must equal ALL missing offsets (including0 when missing)
for the exact artifact; every status must be200. Reuploading an acknowledged
offset, duplicate/omitted chunks, wrong artifact or499 all fail. Full fetched
bytes/SHA additionally prove successful complete publication.

An ADDED, DECLARED controlled service fault fences the observation window:
actual CLI SIGKILL+wait → orderly stop of owned manure/nginx → both inactive,
MainPID0, Result=success, no SIGKILL → start same service/root/PG/credentials/cache
→ own native ready+Version → authoritative UploadStatus → byte-offset cursor.
The provider PID must remain unchanged. There is no reset, adoption or rotation.
`Artifacts.status` shares the process gate and PostgreSQL metadata advisory lock
with chunk receipts, but a prior HTTP body can precede that gate; status alone
is NOT a drain. This VM proves client-kill + SERVICE-restart resume. It does not
claim the complementary same-live-server/no-service-restart case from this step;
existing actual-client live-resume proofs retain their independent scope.

## Validation and parent handoff

Local checks are narrow:15 pure current-response/evidence-guard cases, Nix parse,
evaluated Python-driver AST and actual Nix option/derivation evaluation. They are
not VM execution. Pure negatives include old health JSON, wrong correlation/error,
unsafe cookies, missing offset0, acknowledged-offset substitution with the SAME
count, duplicate/omitted offsets, wrong artifact,499/failure, extra/duplicate log
fields, empty/complete baseline and a cursor splitting a record.

The parent must merge the sole Nix owner's private provider-bootstrap aperture
fix before boot (the old stock dataDir ReadWritePaths fails226/NAMESPACE before
provider init). Do not precreate/adopt an unmarked data dir. The separately owned
runtime/audit port must admit the actual pinned TCG generated CPU/memfd shape
while preserving every disk/backing/socket/device/network/unsupported-argument
guard. Neither change is implemented here.

Only the parent launches long work. First build the frozen combined
`checks.x86_64-linux.manure-vm.driver`, then pass that REAL built driver through
the updated explicit-policy pre-exec runtime auditor in a fresh owned lab. Do
not run a stock shared driver or bypass its attachment guard. Evaluation paths
are planned outputs until built; effective QEMU argv is not established by eval.
No host systemd, production endpoints, host shares or activation are authorized.
