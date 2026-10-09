#!/usr/bin/env python3
"""manure contained VM runtime (owned helper, narrow).

Runs the ACTUAL contained driver built from the CURRENT candidate EXACT
source (driver build is NOT runtime). Adapts the parent contained-driver
diagnostic without hardcoded private paths.

Boundary design (reader-reviewed; do NOT overclaim):
- Textual preboot admission over generated scripts (substring denylists,
  lexical drive/channel prefix checks) is NOT a confinement proof: it
  cannot resolve placeholders, cannot see backing chains, and cannot tie
  discovered files to attached drives. This helper therefore does NOT
  admit launches textually. Instead it substitutes ONLY the QEMU binary
  token in the hash-logged generated start scripts with a lab-contained
  trusted pre-exec audit wrapper (all other bytes/config/testScript
  behavior identical); at QEMU invocation time — after generated images
  exist but BEFORE exec of real QEMU — the wrapper validates the EFFECTIVE
  argv/env with nix/tests/manure-vm-audit.py (SAME code path as its
  host-side negative fixtures): every attached drive and its full backing
  chain must be regular files canonically under the lab or the project
  (NO /nix/store exception for guest disks; -kernel/-initrd boot inputs
  are not guest disks and keep public store resolution), Unix channels
  must live under the lab (pre-existing host sockets fail closed), host
  sharing (9p/virtiofs/vhost-user-fs), TAP/bridge/VDE, vfio and /dev-backed
  drives are refused, KVM (`-machine accel=kvm`, no fallback list) with
  `-cpu max` is required, and anything outside the known-good generated
  patterns fails closed as unsupported launch syntax. A guest NEVER boots
  until this boundary verifies (refusal exit 125, real QEMU never execs).
- Post-run, the attached-drive mapping captured by the wrapper is
  cross-checked against the discovered lab images (every attached file
  must be found and vice versa), plus the regular/backing re-audit as
  defense in depth. Post enumeration or deny-lists alone are never treated
  as proof. No general-confinement claim is made (e.g. covert channels
  are out of scope); the claim is exactly: no outside/host-shared
  attachments reached QEMU on this run.

Mandatory containment (VM boundary):
- no host dirs/sockets/devices via 9p/virtiofs/equivalent, no TAP/bridge/
  VDE (not required here); ALL regular guest disk images (including any
  qcow2 backing files) ONLY canonical under the fresh lab (itself canonical
  under $YOLO_VM_STATE_DIR) or the project.
- stock driver actually shares host store/xchg/shared; never boot it —
  unexpected driver shapes (vlans/containers/backdoor/VM set) fail closed
  before any lab work, and unexpected launch syntax fails closed in the
  wrapper.
- pinned runNixOSTest defaults (useNixStoreImage=true,
  mountHostNixStore=false, useHostCerts=false, sharedDirectories={},
  vlans=[], interfaces={}, sshBackdoor=false, qemu.forceAccel=true).

Runtime:
- fresh 0700 lab under canonical YOLO root; explicitly clears inherited
  QEMU_*/NIXPKGS_QEMU_KERNEL_*/NIX_DISK_IMAGE/NIX_EFI_VARS/SHARED_DIR/
  USE_TMPDIR overrides (logged when present in the parent env) and sets
  controlled TMPDIR=lab/tmp, XDG_RUNTIME_DIR=lab/runtime,
  QEMU_NET_OPTS=restrict=on, cwd=lab (0700); user networking only;
- runs the driver (base testScript already includes FULL controller
  checks: installed defaults, health, LoadCredential, custom writes, TLS
  internal/external handoff, hostile headers, Host-port preservation,
  error/access/journal canaries, R5 bounds, HM-sandbox cache/resume via
  the generated yolo adapter and installed-default shells);
- optional second argv overrides test_script with a regular file under
  the invoking cwd (resolved strict, must stay under cwd);
- on success prints the audit manifest + attachment mapping, validates
  EXACTLY 4 regular contained images (edge/root, edge/store,
  strict/root, strict/store) with clean backing chains, cross-checks them
  against the wrapper-captured attachments, then REMOVES the disposable
  lab (QEMU cleanup; base images live in /nix/store). On failure the lab
  is retained and its path printed for diagnosis.

Usage:
  nix build .#checks.x86_64-linux.manure-vm.driver --no-link --print-out-paths  # EXACT source build
  python3 nix/tests/manure-vm-runtime.py /nix/store/...-nixos-test-driver [extra-test-script]
Env: YOLO_VM_STATE_DIR (canonical), /dev/kvm, qemu-system-x86_64, qemu-img.
No host changes, no deployment/DNS.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

CLEARED_EXACT = ("NIX_DISK_IMAGE", "NIX_EFI_VARS", "SHARED_DIR", "USE_TMPDIR")
CLEARED_PREFIXES = ("QEMU_", "NIXPKGS_QEMU_KERNEL_")

_AUDIT_MOD = Path(__file__).resolve().parent / "manure-vm-audit.py"


def _fail(msg: str) -> int:
    print(f"manure-vm-runtime: FAIL — {msg}", flush=True)
    return 1


def _sha_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_audit_lib():
    if not _AUDIT_MOD.is_file():
        raise RuntimeError(f"audit module absent: {_AUDIT_MOD}")
    spec = importlib.util.spec_from_file_location("manure_vm_audit", str(_AUDIT_MOD))
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load audit module spec")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    if len(sys.argv) not in (2, 3):
        print(__doc__, flush=True)
        return 2
    if shutil.which("qemu-img") is None:
        return _fail("qemu-img absent (need QEMU utilities, no fallback)")
    try:
        audit = _load_audit_lib()
    except Exception as exc:
        return _fail(f"cannot load audit module: {exc}")
    driver = Path(sys.argv[1]).resolve(strict=True)
    wrapper = driver / "bin/nixos-test-driver"
    if not wrapper.is_file():
        return _fail(f"driver wrapper absent: {wrapper}")
    try:
        text = wrapper.read_text()
    except OSError as exc:
        return _fail(f"cannot read driver wrapper: {exc}")
    match = re.search(r"--config (\S+)", text)
    if match is None:
        return _fail("driver wrapper has no --config (not a runNixOSTest driver?)")
    try:
        config = json.loads(Path(match.group(1)).read_text())
    except Exception as exc:
        return _fail(f"cannot load driver config: {exc}")
    if config.get("vlans") != [] or config.get("containers") != {}:
        return _fail("driver vlans/containers not empty (not contained)")
    if config.get("enable_ssh_backdoor") is not False:
        return _fail("ssh backdoor must be disabled")
    vms = config.get("vms", {})
    if set(vms) != {"edge", "strict"}:
        return _fail(f"expected vms {{edge,strict}}, got {set(vms)}")
    yolo_root = os.environ.get("YOLO_VM_STATE_DIR")
    if not yolo_root:
        return _fail("YOLO_VM_STATE_DIR unset (canonical lab root required)")
    try:
        root = Path(yolo_root).resolve(strict=True)
    except Exception as exc:
        return _fail(f"cannot resolve YOLO_VM_STATE_DIR: {exc}")
    if not root.is_dir() or not os.access(root, os.W_OK):
        return _fail("YOLO_VM_STATE_DIR not a writable dir")
    if not os.access("/dev/kvm", os.R_OK | os.W_OK):
        return _fail("/dev/kvm not accessible (KVM required, no fallback)")
    try:
        lab = Path(tempfile.mkdtemp(prefix="manure-", dir=root)).resolve(strict=True)
    except Exception as exc:
        return _fail(f"cannot create lab under YOLO root: {exc}")
    if not lab.is_relative_to(root):
        return _fail("lab escaped YOLO root (symlink race?)")
    os.chmod(lab, 0o700)
    if stat.S_IMODE(lab.stat().st_mode) != 0o700:
        return _fail("lab perms not 0700 after chmod")
    for name in ("tmp", "runtime", "logs"):
        (lab / name).mkdir(mode=0o700)
    # Pre-exec audit wiring: substitute ONLY the QEMU binary token in each
    # hash-logged generated start script with the lab-contained wrapper.
    # Textual admission is deliberately NOT performed here (insufficient);
    # the wrapper validates EFFECTIVE argv after images exist, pre-exec.
    manifest: dict = {"lab": str(lab), "driver": str(driver), "vms": {}}
    try:
        orig_cfg = Path(match.group(1)).resolve(strict=True)
        manifest["original_config"] = {"path": str(orig_cfg), "sha256": _sha_file(orig_cfg)}
    except Exception as exc:
        return _fail(f"cannot hash original driver config: {exc}")
    try:
        base_ts = Path(str(config.get("test_script", ""))).resolve(strict=True)
        if not base_ts.is_file() or not stat.S_ISREG(base_ts.lstat().st_mode):
            return _fail("base testScript is not a regular file (fail closed)")
        manifest["test_script_base"] = {"path": str(base_ts), "sha256": _sha_file(base_ts)}
    except Exception as exc:
        return _fail(f"cannot hash base testScript: {exc}")
    try:
        python_exe = str(Path(sys.executable).resolve(strict=True))
    except Exception as exc:
        return _fail(f"cannot resolve runner python: {exc}")
    for name, machine in vms.items():
        try:
            script_path = Path(machine["start_script"]).resolve(strict=True)
        except Exception as exc:
            return _fail(f"{name}: cannot resolve start script: {exc}")
        try:
            original = script_path.read_text()
        except OSError as exc:
            return _fail(f"{name}: cannot read start script: {exc}")
        wrapper_path = lab / f"qemu-audit-{name}.sh"
        try:
            new_text, real_qemu = audit.substitute_qemu(original, str(wrapper_path))
        except Exception as exc:
            return _fail(f"{name}: QEMU token substitution refused: {exc}")
        try:
            real_stat = Path(real_qemu).lstat()
        except OSError as exc:
            return _fail(f"{name}: real QEMU not stat-able: {exc}")
        if not stat.S_ISREG(real_stat.st_mode) or os.access(real_qemu, os.X_OK) is False:
            return _fail(f"{name}: real QEMU not an executable regular file")
        try:
            sha256_real_qemu = _sha_file(Path(real_qemu))
        except OSError as exc:
            return _fail(f"{name}: cannot hash real QEMU exe: {exc}")
        wrapper_text = (
            "#!/usr/bin/env bash\n"
            "# Pre-exec audit wrapper (generated into the lab; see audit-manifest.json).\n"
            "# Replaces ONLY the QEMU binary token; the start script is otherwise\n"
            "# byte-identical. Refusal exit 125 never execs real QEMU. Lab is a\n"
            "# baked literal (no TMPDIR/name guessing).\n"
            "set -u\n"
            f'REAL_QEMU={real_qemu}\n'
            f'AUDIT_MOD={_AUDIT_MOD.resolve()}\n'
            f'PYTHON={python_exe}\n'
            f'AUDIT_LAB={lab}\n'
            'exec "$PYTHON" "$AUDIT_MOD" audit-exec --lab "$AUDIT_LAB" "$REAL_QEMU" -- "$@"\n'
        )
        try:
            wrapper_path.write_text(wrapper_text)
            os.chmod(wrapper_path, 0o700)
            audited_path = lab / f"run-{name}-audited.sh"
            audited_path.write_text(new_text)
            os.chmod(audited_path, 0o700)
        except OSError as exc:
            return _fail(f"{name}: cannot write audited copy: {exc}")
        manifest["vms"][name] = {
            "start_script_original": str(script_path),
            "sha256_original": hashlib.sha256(original.encode()).hexdigest(),
            "start_script_audited": str(audited_path),
            "sha256_audited": hashlib.sha256(new_text.encode()).hexdigest(),
            "wrapper": str(wrapper_path),
            "sha256_wrapper": hashlib.sha256(wrapper_text.encode()).hexdigest(),
            "real_qemu": real_qemu,
            "sha256_real_qemu": sha256_real_qemu,
        }
        machine["start_script"] = str(audited_path)
        print(f"manure-vm-runtime: {name}: start script audit-wired (hashes logged)", flush=True)
    manifest_path = lab / "audit-manifest.json"
    config["global_timeout"] = 900
    if len(sys.argv) == 3:
        try:
            test_script = Path(sys.argv[2]).resolve(strict=True)
        except Exception as exc:
            return _fail(f"cannot resolve extra test script: {exc}")
        try:
            cwd = Path.cwd().resolve()
        except Exception as exc:
            return _fail(f"cannot resolve cwd: {exc}")
        if not test_script.is_relative_to(cwd) or not test_script.is_file():
            return _fail("extra test script must be a regular file under cwd")
        if not stat.S_ISREG(test_script.lstat().st_mode):
            return _fail("extra test script not a regular file")
        config["test_script"] = str(test_script)
        print(f"manure-vm-runtime: extra test script: {test_script} (under {cwd})", flush=True)
    if len(sys.argv) == 3:
        manifest["test_script_override"] = {
            "path": str(Path(config["test_script"]).resolve(strict=True)),
            "sha256": _sha_file(Path(config["test_script"]).resolve(strict=True)),
        }
        manifest["test_script_effective"] = manifest["test_script_override"]
        manifest["override_identity"] = manifest["test_script_override"]["path"]
    else:
        manifest["test_script_override"] = None
        manifest["test_script_effective"] = manifest["test_script_base"]
        manifest["override_identity"] = "NONE (base testScript)"
    config_file = lab / "driver.json"
    config_file.write_text(json.dumps(config))
    manifest["final_config"] = {"path": str(config_file), "sha256": _sha_file(config_file)}
    manifest["launch_env"] = {
        "cwd": str(lab),
        "TMPDIR": str(lab / "tmp"),
        "XDG_RUNTIME_DIR": str(lab / "runtime"),
        "QEMU_NET_OPTS": "restrict=on",
        "cleared_inherited": sorted(
            k for k in os.environ if k.startswith(CLEARED_PREFIXES) or k in CLEARED_EXACT
        ),
        # Names (never values) of everything else flowing to the driver:
        # proves no stray override rides along without printing secrets.
        "inherited_keys": sorted(
            k for k in os.environ
            if not k.startswith(CLEARED_PREFIXES) and k not in CLEARED_EXACT
        ),
        # Single list executed AND recorded: no placeholder, no drift.
        "driver_argv": [
            str(wrapper),
            "--config",
            str(config_file),
            "--keep-machine-state",
            "--output_directory",
            str(lab / "logs"),
            "--junit-xml",
            str(lab / "logs/result.xml"),
        ],
    }
    try:
        qemu_img_version = subprocess.run(
            ["qemu-img", "--version"], capture_output=True, text=True, timeout=30
        ).stdout.strip().splitlines()[0]
    except Exception as exc:
        return _fail(f"cannot query qemu-img version: {exc}")
    try:
        qemu_img_bin = shutil.which("qemu-img")
        if not qemu_img_bin:
            return _fail("qemu-img absent from PATH (backing-chain audit needs it)")
        manifest["code_identities"] = {
            "runner": {"path": str(Path(__file__).resolve()), "sha256": _sha_file(Path(__file__).resolve())},
            "audit_module": {"path": str(_AUDIT_MOD.resolve()), "sha256": _sha_file(_AUDIT_MOD.resolve())},
            "python": {"exe": python_exe, "version": sys.version.split()[0], "sha256": _sha_file(Path(python_exe))},
            "qemu_img": {"path": qemu_img_bin, "sha256": _sha_file(Path(qemu_img_bin)), "version": qemu_img_version},
        }
    except OSError as exc:
        return _fail(f"cannot hash code identity: {exc}")
    manifest_path.write_text(json.dumps(manifest, indent=2))
    cleared_present = [k for k in os.environ if k.startswith(CLEARED_PREFIXES) or k in CLEARED_EXACT]
    if cleared_present:
        print(
            "manure-vm-runtime: clearing inherited overrides: " + ", ".join(sorted(cleared_present)),
            flush=True,
        )
    env = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith(CLEARED_PREFIXES) and key not in CLEARED_EXACT
    }
    env.update(
        TMPDIR=str(lab / "tmp"),
        XDG_RUNTIME_DIR=str(lab / "runtime"),
        QEMU_NET_OPTS="restrict=on",
    )
    print("manure-vm-runtime: pre-exec audit wired; launching driver (guests boot ONLY via wrapper).", flush=True)
    print(f"manure-vm-runtime: private lab: {lab} (0700, cwd for driver)", flush=True)
    result = subprocess.run(
        manifest["launch_env"]["driver_argv"],
        cwd=lab,
        env=env,
    )
    if result.returncode != 0:
        return _fail(f"VM runtime failed: {result.returncode}; state retained at {lab}")
    # Post-run: re-audit discovered images with the SAME roots the wrapper
    # used (lab + project via git, so pre-exec and post-run agree; in
    # practice every generated drive resolves under the controlled lab).
    try:
        project = audit._repo_root()
    except Exception:
        project = None
    # Post-run: re-audit discovered images (defense in depth) and
    # cross-check them against the wrapper-captured attachments.
    images = sorted(path for path in (lab / "runtime").rglob("*") if path.suffix in (".qcow2", ".img")) + sorted(
        path for path in (lab / "tmp").rglob("*") if path.suffix in (".qcow2", ".img")
    )
    seen: set[Path] = set()
    uniq: list[Path] = []
    for image in images:
        try:
            resolved = image.resolve(strict=True)
        except Exception:
            return _fail(f"image not resolvable: {image}; state retained at {lab}")
        if resolved in seen:
            continue
        seen.add(resolved)
        uniq.append(image)
    images = uniq
    print(f"manure-vm-runtime: found candidate images: {len(images)}", flush=True)
    attached: set[str] = set()
    for record_file in sorted((lab).glob("audit-*.jsonl")):
        try:
            lines = record_file.read_text().splitlines()
        except OSError as exc:
            return _fail(f"cannot read audit log {record_file}: {exc}; state retained at {lab}")
        if len(lines) != 1:
            return _fail(
                f"audit log {record_file.name} has {len(lines)} records, expected exactly 1 "
                f"(unexpected relaunches); state retained at {lab}"
            )
        try:
            record = json.loads(lines[0])
        except Exception as exc:
            return _fail(f"audit log {record_file.name} unparsable: {exc}; state retained at {lab}")
        for drive in record.get("mapping", {}).get("drives", []):
            attached.add(drive["resolved"])
    for image in images:
        try:
            resolved = image.resolve(strict=True)
        except Exception:
            return _fail(f"image not resolvable: {image}; state retained at {lab}")
        if not resolved.is_relative_to(lab):
            return _fail(f"image escaped lab: {image}; state retained at {lab}")
        if not stat.S_ISREG(image.lstat().st_mode):
            return _fail(f"image not a regular file: {image}; state retained at {lab}")
        try:
            chain = audit._qemu_img_chain(image)
        except Exception as exc:
            return _fail(f"qemu-img info error for {image}: {exc}; state retained at {lab}")
        backings = [
            entry.get("backing-filename")
            for entry in chain
            if isinstance(entry, dict) and entry.get("backing-filename")
        ]
        print(
            f"manure-vm-runtime: image {image.relative_to(lab)} "
            f"format={chain[0].get('format') if chain else '?'} "
            f"backing={backings if backings else 'none'}",
            flush=True,
        )
        for backing in backings:
            try:
                audit._check_guest_disk(backing, lab=lab, project=project)
            except Exception as exc:
                return _fail(f"image {image} backing refused: {exc}; state retained at {lab}")
    print(f"manure-vm-runtime: validated contained regular images: {len(images)}", flush=True)
    if len(images) != 4:
        return _fail(
            f"expected exactly 4 regular images (edge/root, edge/store, strict/root, strict/store), "
            f"found {len(images)}; state retained at {lab}"
        )
    discovered = {str(image.resolve(strict=True)) for image in images}
    if attached != discovered:
        return _fail(
            f"attachment mapping mismatch: attached={sorted(attached)} discovered={sorted(discovered)}; "
            f"state retained at {lab}"
        )
    print(f"manure-vm-runtime: attachment mapping matches discovered files: {sorted(attached)}", flush=True)
    print("manure-vm-runtime: audit manifest:", flush=True)
    print(manifest_path.read_text(), flush=True)
    for record_file in sorted(lab.glob("audit-*.jsonl")):
        print(f"manure-vm-runtime: audit record {record_file.name}:", flush=True)
        print(record_file.read_text(), flush=True)
    print("manure-vm-runtime: OK (contained runtime passed; no general-confinement claim)", flush=True)
    try:
        shutil.rmtree(lab)
    except Exception as exc:
        return _fail(f"lab removal failed ({exc}); state retained at {lab}")
    if lab.exists():
        return _fail(f"lab still present after removal; state retained at {lab}")
    print("manure-vm-runtime: disposable lab removed and verified absent (QEMU cleanup; bases retained in /nix/store)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
