# Explicit acceleration policy at the contained Manure VM boundary

This changes only CPU/machine admission in the existing outer runtime and
pre-exec attachment audit. **It does not launch a guest, replace the stock
driver, or turn generator-source observations into runtime acceptance.**

## Required selection (no default)

Both `manure-vm-runtime.py` and `manure-vm-audit.py audit-exec` require
`--acceleration-policy`:

| Value | Sole acceleration machine argument | CPU | Host preflight |
|---|---|---|---|
| `kvm-only` | `-machine accel=kvm` | exactly one `-cpu max` | accessible `/dev/kvm` required |
| `kvm-or-tcg` | `-machine accel=kvm:tcg` | exactly one `-cpu max` | no KVM requirement |

The second is an **explicitly permitted fallback list**, not TCG-only or proof of
which accelerator QEMU selected. No QEMU argv is rewritten; only the original
QEMU binary token is replaced, exactly as before. Unknown policies, alternate or
reordered fallback lists, extra acceleration/CPU flags, duplicate CPUs/machines,
and malformed patterns fail closed. The API requires an `AccelerationPolicy`
enum; passing a string/None is not implicit selection.

The only optional extra machine argument is exactly `memory-backend=mem0`, once,
paired with exactly one anonymous object
`memory-backend-memfd,id=mem0,size=1024M,share=on`. Either half alone, extra
objects/properties, other IDs/sizes, or file-backed objects are refused. Existing
`-m 1024`, `-smp 1`, and default edge/strict VM-name restrictions remain. This
**tightens** the old object-prefix and extra-machine checks; it does not authorize
a general QEMU machine/object grammar.

Pinned source authority: flake.lock nixpkgs
`31ecbaca1bdefa45dffc409f0250bd8039ea0010`, locally resolved to
`/nix/store/sxb2ijsbdhi8s1lvc6ph692nm84vms3y-source`:

- `nixos/lib/qemu-common.nix`: x86_64 Linux emits `accel=kvm:tcg`/`cpu max` when
  `forceAccel=false`; direct KVM when true.
- `nixos/modules/virtualisation/qemu-vm.nix`: Linux default anonymous memfd/mem0
  correspondence, and the generated memory/core values.
- `nixos/lib/testing/run.nix`: `requiredFeatures.kvm` independently defaults true
  for Linux VM tests; its documented false value permits emulated execution.

The fixture owner—not this patch—must explicitly pair
`requiredFeatures.kvm=false` and `qemu.forceAccel=false` for the TCG-capable test.
Selecting the runtime policy does not override either stock requirement.

## Unchanged containment

All disk regularity/canonical roots/backing-chain checks, no store exception for
guest disks, kernel/initrd handling, Unix mediation, sharing/device/network
refusals, unsupported-syntax admission, override clearing, 0700 labs, stock
driver shape checks, and exactly-four-image attachment/discovery cross-check
remain. Policy is baked into the wrapper, recorded with exact machine/CPU argv,
and checked against audit records afterward. An argv policy is not actual
accelerator telemetry. Failure still retains the lab and uses refusal125 before
real executable entry.

## No-guest verification

Use the pinned already available QEMU utilities; all temporary files stay in the
project. These commands run **qemu-img only**, never real QEMU or a driver:

```bash
cd /home/pavel/work/flakes/ponygirls/.worktrees/wt-ponygirls-manure-vm-audit-current
export PATH=/nix/store/rxskg9ll6fsixn3g8ig6q90za5kscqfj-qemu-for-vm-tests-11.1.2/bin:$PATH
mkdir -p target/manure-vm-audit-cpu/tmp
chmod 700 target/manure-vm-audit-cpu target/manure-vm-audit-cpu/tmp
export TMPDIR="$PWD/target/manure-vm-audit-cpu/tmp"
export YOLO_VM_STATE_DIR="$TMPDIR" PYTHONDONTWRITEBYTECODE=1
python3 nix/tests/manure-vm-audit.py selftest
python3 nix/tests/test_manure_vm_acceleration.py
```

Baseline: all30 old fixture labels passed. Commit63071850 then passed those
same30 plus27 new policy/exact-memory controls **under each policy** (114 label
executions, no skips). That receipt remains preserved. The follow-up adds one
explicit q35 refusal per policy:58 each/116 total, preserving all prior114.
All argv-rejection fixtures traverse the actual pre-exec entry with a no-exec sentinel;
manual authority dummies preserve the fixture's declared project=None when its
owned temporary directory is itself inside the checkout. The real production
repo-root discovery is unchanged.

The original nine focused tests cover actual runtime preflight, mandatory CLI/
API selection, sentinel-only executable entry and policy logging, actual owned
Unix socket/network/vfio/share refusals, unchanged stock-driver refusal,
environment clearing, and exact QEMU-token-only substitution. A handwritten
subprocess sentinel deliberately returns71 **before running the synthetic driver
control fixture**. That is not a generated-driver/guest success. Initial focused
v1 hit the Unix pathname-length limit; the fixture now binds a relative leaf in
its owned directory, immediately restoring cwd. v2 and original final v3 pass9/9,
zero skips/errors. The follow-up preserves those nine and adds q35-denial and
trusted CLI-boundary composition checks:11/11, zero skips/errors.

Evidence under ignored `target/manure-vm-audit-cpu/`: original-source hashes,
old30-label pass log, old actual validator CPU rejection on the evaluated pinned
generator prefix plus a real contained qcow2, new114-label log, focused v1/v2/v3 logs,
and complete `inventory.json`. The fail-first is explicitly **generator-prefix
plus controlled attachments**, not a newly built current Manure driver.

## Parent-only guest invocation after security/source review

Do not run this as part of the no-guest tests. The parent must first have the
actual candidate-contained driver/config/start-script identities, review all
effective argv against this boundary, and launch through its supervised lane:

```text
YOLO_VM_STATE_DIR=<approved canonical private lab root> \
  python3 nix/tests/manure-vm-runtime.py --acceleration-policy kvm-or-tcg \
  /nix/store/<ACTUAL_OBSERVED_CONTAINED_DRIVER>
```

The placeholder is not an observed driver. At patch preparation time the current
Manure VM owner had not supplied a newly built start script/effective argv. No
actual current-Manure-argv or TCG guest-boot acceptance is claimed. Existing KVM
users must now explicitly choose `kvm-only`; there is no legacy implicit mode.

## Complete fixture-label inventory

Each list is executed independently for **both** policies. Existing positives,
negative boundaries and token-substitution controls are retained, not counted
from source markers. Argv rejections hit the pre-exec path/sentinel; the two
substitution refusals remain separate pre-wrapper lexical checks. The follow-up
adds `unapproved-q35-with-exact-memory-pair` once per policy.

Original30 labels:

```text
dev-backed-drive
drive-without-file
exec-refuses-bad-lab
exec-refuses-outside
kernel-symlink-store
lab-backing-chain
lab-disk-no-backing
missing-kvm
outside-backing-chain
outside-symlink-drive
project-drive-with-project
project-drive-without-project
qmp-bare-unix-lab
qmp-outside-lab
qmp-tcp
serial-file
serial-stdio
store-backing-no-exception
substitution-hygiene
substitution-multi-refuses
substitution-placement
substitution-real-path
substitution-relative-refuses
tap-netdev
unknown-vm
unsupported-flag
virtconsole-lab-socket
virtconsole-outside-socket
virtconsole-unknown-chardev
virtio-9p
```

New27 labels (only `pinned-anonymous-memory-pair` is a positive; the other26
are required rejections):

```text
aux-without-object
cpu-without-value
duplicate-anonymous-object
duplicate-aux-machine
duplicate-cpu
extra-acceleration-machine
missing-cpu
object-without-aux
other-acceleration-policy
pinned-anonymous-memory-pair
resource-bound--m
resource-bound--smp
unapproved-accelerator-flag
unapproved-cpu-''
unapproved-cpu-'host'
unapproved-cpu-'max,+vmx'
unapproved-cpu-'max,max'
unapproved-machine-''
unapproved-machine-'accel=kvm,accel=tcg'
unapproved-machine-'accel=kvm:tcg:hvf'
unapproved-machine-'accel=tcg'
unapproved-machine-'accel=tcg:kvm'
unapproved-memory-object-memory-backend-file,id=mem0,size=1024M,mem-path=/tmp/host
unapproved-memory-object-memory-backend-memfd,id=mem0,size=1024M,share=on,seal=off
unapproved-memory-object-memory-backend-memfd,id=mem0,size=2048M,share=on
unapproved-memory-object-memory-backend-memfd,id=other,size=1024M,share=on
unknown-machine
```

## Follow-up: stateless boundary dependencies and q35 remains refused

The internal `_audit_exec` boundary now requires **all** authority and executable
entry dependencies explicitly: `project` and `exec_entry`, in addition to the
required acceleration policy. There are no defaults. The actual CLI always
composes `project=_repo_root()` and `exec_entry=os.execv`; there is no CLI root
selector, alternate executor, bypass, or skip. Selftests pass their declared
project authority and a manual no-exec function directly. They do not replace
module globals or mutate `os.execv`. The same validation/logging code runs before
the explicitly supplied boundary; localized unit-test observation verifies the
CLI passes real discovery/result and the real executable function.

The parent relayed an evaluated (not yet built/observed) current Manure option
set containing `-machine q35,smm=on` **as well as** memfd/mem0. This remains
**unapproved and refused**, including when all other controlled arguments use
the exact admitted memory pair. The controlled denial also includes the paired
`-global driver=cfi.pflash01,property=secure,value=on`; refusal is therefore for
the extra machine, not an unsupported global or a missing object.

Pinned `qemu-vm.nix:1363–1367` emits the q35/global pair conditionally on x86 and
`cfg.efi.OVMF.systemManagementModeRequired`. That is source-pattern context,
**not** an observed built current Manure start script or effective argv. The
existing generic cfi-global prefix check is not evidence of an approved complete
q35 shape. No machine/global guard was relaxed. A future change needs the actual
combined-source driver/start-script identity, verified options and effective
argument shape, explicit parent authority, and unchanged attachment/firmware
admission; a partial eval is not guest-launch approval.

Follow-up evidence is separate (`followup-selftest-v1.log`,
`followup-focused-v1.log`); original114+9 controls and old CPU fail-first files
are unchanged. This follow-up performs no driver build, guest launch, real QEMU
execution, systemd action, production edit, or sibling-worktree write.
