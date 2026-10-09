#!/usr/bin/env python3
"""manure VM launch validator (owned helper, narrow, host-executed).

Validates an EFFECTIVE QEMU launch (concrete argv after shell expansion,
images already generated) BEFORE any guest boots. Used two ways with the
SAME code path:
- pre-exec audit wrapper: manure-vm-runtime.py substitutes ONLY the QEMU
  binary token in the hash-logged generated start scripts with a wrapper
  that execs `python3 <this-module> --audit-exec <real-qemu> -- <argv...>`;
  all other bytes/config/testScript behavior stays identical;
- negative/positive fixtures: `--selftest` exercises the validator with
  an outside-resolving symlink drive, an outside backing chain (real
  qemu-img files, no guest, no QEMU launch), forbidden sharing args, and
  a valid lab-contained launch.

Containment roots: the lab (canonical under $YOLO_VM_STATE_DIR) and the
project checkout (git toplevel of this file). GUEST DISK images and their
qcow2 backing files must be regular files canonically under one of those
roots — NO /nix/store exception for guest disks (copy any needed immutable
base into the lab first, otherwise fail closed). Kernel/initrd executable
boot inputs are NOT guest disk backings: absolute /nix/store paths are
allowed for -kernel/-initrd only (public store binary resolution stays
okay). Unix console/monitor channels must live under the lab (VM-owned
mediation); pre-existing host sockets outside the lab fail closed. Host
directory/socket/device sharing (9p/virtiofs/vhost-user-fs), TAP/bridge/VDE
netdevs, vfio, and /dev-backed drives are refused. KVM is required
(`-machine accel=kvm`, no accel fallback list) with the generated
`-cpu max`. Anything not matching the known-good generated patterns fails
closed as unsupported launch syntax (patterns are pinned to the nixpkgs
in flake.lock; generator changes need re-verification, not silent widening).

This proves confinement of the ATTACHED drives (not merely enumerating
found files) and never launches QEMU itself.
"""
from __future__ import annotations

import argparse
import json
import os
import stat
import subprocess
import sys
from pathlib import Path

AUDIT_FAIL_EXIT = 125


class AuditError(Exception):
    pass


def _repo_root() -> Path | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(Path(__file__).resolve().parent), "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if out.returncode == 0 and out.stdout.strip():
            return Path(out.stdout.strip()).resolve()
    except Exception:
        pass
    return None


def _canonical(path: Path) -> Path:
    return path.resolve(strict=True)


def _is_under(path: Path, root: Path) -> bool:
    try:
        return path.is_relative_to(root)
    except ValueError:
        return False


def _qemu_img_chain(image: Path) -> list[dict]:
    out = subprocess.run(
        ["qemu-img", "info", "--backing-chain", "--output=json", str(image)],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if out.returncode != 0:
        raise AuditError(f"qemu-img info failed for {image}: {out.stderr[-500:]}")
    try:
        data = json.loads(out.stdout)
    except Exception as exc:
        raise AuditError(f"qemu-img info unparsable for {image}: {exc}")
    return data if isinstance(data, list) else [data]


def _check_guest_disk(path_text: str, *, lab: Path, project: Path | None) -> Path:
    """A guest disk/backing must be a regular file under lab or project."""
    p = Path(path_text)
    if not p.is_absolute():
        raise AuditError(f"guest disk path not absolute: {path_text}")
    try:
        resolved = _canonical(p)
    except Exception:
        raise AuditError(f"guest disk not resolvable: {path_text}")
    if not stat.S_ISREG(p.lstat().st_mode):
        raise AuditError(f"guest disk not a regular file: {path_text}")
    if _is_under(resolved, lab):
        return resolved
    if project is not None and _is_under(resolved, project):
        return resolved
    raise AuditError(
        f"guest disk outside lab/project (copy any needed base into the lab, "
        f"no /nix/store exception): {path_text}"
    )


def _check_backing_chain(image: Path, *, lab: Path, project: Path | None) -> list[str]:
    chain = _qemu_img_chain(image)
    backings = [
        entry.get("backing-filename")
        for entry in chain
        if isinstance(entry, dict) and entry.get("backing-filename")
    ]
    for backing in backings:
        _check_guest_disk(backing, lab=lab, project=project)
    return backings


def _split_drive_params(spec: str) -> dict[str, str | None]:
    params: dict[str, str | None] = {}
    for chunk in spec.split(","):
        if "=" in chunk:
            key, _, value = chunk.partition("=")
            params[key] = value
        else:
            params[chunk] = None
    return params


def audit_argv(
    argv: list[str],
    *,
    lab: Path,
    project: Path | None,
    allowed_vms: tuple[str, ...] = ("edge", "strict"),
) -> dict:
    """Validate EFFECTIVE QEMU argv. Returns attachment mapping on success.

    Raises AuditError (fail closed) on anything outside the known-good
    generated patterns. NEVER launches QEMU.
    """
    if not argv:
        raise AuditError("empty argv")
    drives: list[str] = []
    unix_channels: list[str] = []
    machine_values: list[str] = []
    cpu_values: list[str] = []
    vm_name: str | None = None
    i = 0
    tokens = argv[1:]
    # Pre-scan -chardev socket ids so -device virtconsole can be tied to its
    # backend (fail closed when the id is missing or not a lab socket).
    chardev_sockets: dict[str, str] = {}
    j = 0
    while j < len(tokens):
        if tokens[j] == "-chardev" and j + 1 < len(tokens):
            spec = tokens[j + 1]
            cid: str | None = None
            cpath: str | None = None
            for chunk in spec.split(","):
                if chunk.startswith("id="):
                    cid = chunk.split("=", 1)[1]
                if chunk.startswith("path="):
                    cpath = chunk.split("=", 1)[1]
            if cid is not None and cpath is not None and "socket" in spec:
                # Containment now (not later): an outside/pre-existing-host
                # socket id must never become referenceable by -device.
                cpath_obj = Path(cpath)
                if not cpath_obj.is_absolute() or not _is_under(
                    cpath_obj.resolve(strict=False), lab
                ):
                    raise AuditError(
                        f"-chardev socket outside lab (fail closed): {cpath[:160]}"
                    )
                chardev_sockets[cid] = cpath
        j += 1
    while i < len(tokens):
        tok = tokens[i]
        if tok == "-drive":
            i += 1
            if i >= len(tokens):
                raise AuditError("-drive without value (unsupported launch syntax)")
            spec = tokens[i]
            params = _split_drive_params(spec)
            if "file" not in params or not params["file"]:
                raise AuditError(f"-drive without file= (unsupported): {spec[:120]}")
            drives.append(params["file"])
        elif tok in ("-cdrom", "-hda", "-hdb", "-hdc", "-hdd", "-pflash", "-blockdev"):
            raise AuditError(f"unsupported drive syntax (fail closed): {tok}")
        elif tok == "-machine":
            i += 1
            if i >= len(tokens):
                raise AuditError("-machine without value")
            machine_values.append(tokens[i])
        elif tok == "-cpu":
            i += 1
            if i >= len(tokens):
                raise AuditError("-cpu without value")
            cpu_values.append(tokens[i])
        elif tok == "-name":
            i += 1
            if i >= len(tokens):
                raise AuditError("-name without value")
            vm_name = tokens[i]
        elif tok == "-m":
            i += 1
            if i >= len(tokens) or tokens[i] != "1024":
                raise AuditError(f"unexpected -m value (fail closed): {tokens[i] if i < len(tokens) else None}")
        elif tok == "-smp":
            i += 1
            if i >= len(tokens) or tokens[i] != "1":
                raise AuditError("unexpected -smp value (fail closed)")
        elif tok == "-device":
            i += 1
            if i >= len(tokens):
                raise AuditError("-device without value")
            val = tokens[i]
            head = val.split(",")[0]
            if head.startswith("virtio-") or val.startswith("usb-tablet,"):
                pass
            elif head == "virtconsole":
                # Console must ride a lab-contained Unix socket chardev
                # (driver serial capture: VM-owned mediation, same rule as
                # -chardev channels). Resolve via the pre-scanned map.
                cid = None
                for chunk in val.split(",")[1:]:
                    if chunk.startswith("chardev="):
                        cid = chunk.split("=", 1)[1]
                        break
                if cid is None or cid not in chardev_sockets:
                    raise AuditError(
                        f"virtconsole without lab-socket chardev (fail closed): {val[:120]}"
                    )
            else:
                raise AuditError(f"unsupported -device (fail closed): {val[:120]}")
        elif tok in ("-usb", "-no-reboot", "-nographic"):
            # -usb: input devices for the test console. -no-reboot makes
            # guest reboot requests exit QEMU instead of rebooting (prevents
            # reboot loops). -nographic disables graphical output (serial
            # only). All strictly reduce guest capabilities, attach nothing
            # host-side, and are required by generated scripts.
            pass
        elif tok == "-net":
            i += 1
            if i >= len(tokens) or tokens[i] != "nic,netdev=user.0,model=virtio":
                raise AuditError(f"unexpected -net value (fail closed): {tokens[i] if i < len(tokens) else None}")
        elif tok == "-netdev":
            i += 1
            if i >= len(tokens):
                raise AuditError("-netdev without value")
            val = tokens[i]
            if not val.startswith("user,id=user.0,"):
                raise AuditError(f"non-user netdev refused (no TAP/bridge/VDE): {val[:120]}")
        elif tok == "-object":
            i += 1
            if i >= len(tokens) or not tokens[i].startswith("memory-backend-memfd,"):
                raise AuditError(f"unexpected -object (fail closed): {tokens[i] if i < len(tokens) else None}")
        elif tok == "-global":
            i += 1
            if i >= len(tokens) or not tokens[i].startswith("driver=cfi.pflash01,"):
                raise AuditError(f"unexpected -global (fail closed): {tokens[i] if i < len(tokens) else None}")
        elif tok == "-kernel":
            i += 1
            if i >= len(tokens):
                raise AuditError("-kernel without value")
            # Boot input, NOT a guest disk: resolve FIRST (the link itself may
            # live anywhere, e.g. lab-local), then require a store-contained
            # regular target. Guest-disk symlink strictness does NOT apply.
            try:
                ktarget = Path(tokens[i]).resolve(strict=True)
            except OSError as exc:
                raise AuditError(f"-kernel not resolvable: {tokens[i][:120]}: {exc}")
            if not str(ktarget).startswith("/nix/store/"):
                raise AuditError(f"-kernel resolves outside /nix/store: {tokens[i][:120]}")
            try:
                if not stat.S_ISREG(ktarget.stat().st_mode):
                    raise AuditError(f"-kernel target not a regular file: {tokens[i][:120]}")
            except OSError as exc:
                raise AuditError(f"-kernel not stat-able: {tokens[i][:120]}: {exc}")
        elif tok == "-initrd":
            i += 1
            if i >= len(tokens):
                raise AuditError("-initrd without value")
            try:
                ktarget = Path(tokens[i]).resolve(strict=True)
            except OSError as exc:
                raise AuditError(f"-initrd not resolvable: {tokens[i][:120]}: {exc}")
            if not str(ktarget).startswith("/nix/store/"):
                raise AuditError(f"-initrd resolves outside /nix/store: {tokens[i][:120]}")
            try:
                if not stat.S_ISREG(ktarget.stat().st_mode):
                    raise AuditError(f"-initrd target not a regular file: {tokens[i][:120]}")
            except OSError as exc:
                raise AuditError(f"-initrd not stat-able: {tokens[i][:120]}: {exc}")
        elif tok == "-append":
            i += 1
            if i >= len(tokens):
                raise AuditError("-append without value")
            # Kernel cmdline is guest-side after boot, not a host attachment.
        elif tok in ("-serial", "-monitor", "-qmp"):
            i += 1
            if i >= len(tokens):
                raise AuditError(f"{tok} without value")
            val = tokens[i]
            if tok == "-serial" and val == "stdio":
                # Guest serial over QEMU's own stdio pipes to the driver
                # (how console output reaches the test log): anonymous
                # pipes, no host file/socket involved. Required.
                i += 1
                continue
            # Observed generated form first: bare `unix:<path>,...`
            # (e.g. -qmp unix:.../qmp,server=on,wait=off).
            m = None
            for part in val.split(","):
                if part.startswith("unix:"):
                    m = part[len("unix:") :]
                    break
            if m is None:
                for key in ("unix:path=", "addr.path=", "path="):
                    if key in val:
                        m = val.split(key, 1)[1].split(",")[0]
                        break
            if not m:
                if "unix:" not in val and "addr.path" not in val and "path=" not in val:
                    raise AuditError(f"non-Unix {tok} channel refused: {val[:120]}")
                raise AuditError(f"unparsable {tok} channel (fail closed): {val[:120]}")
            mp = Path(m)
            if not mp.is_absolute() or not _is_under(mp.resolve(strict=False), lab):
                # Pre-existing host sockets outside the lab fail closed here;
                # VM-owned channels must live under the lab.
                try:
                    is_sock = stat.S_ISSOCK(mp.lstat().st_mode)
                except OSError:
                    is_sock = False
                if is_sock:
                    raise AuditError(f"{tok} channel is an existing host socket: {m[:160]}")
                raise AuditError(f"{tok} channel outside lab (fail closed): {m[:160]}")
            unix_channels.append(m)
        elif tok == "-chardev":
            i += 1
            if i >= len(tokens):
                raise AuditError("-chardev without value")
            val = tokens[i]
            if "socket" not in val or "path=" not in val:
                raise AuditError(f"non-socket -chardev refused: {val[:120]}")
            m = val.split("path=", 1)[1].split(",")[0]
            mp = Path(m)
            if not mp.is_absolute() or not _is_under(mp.resolve(strict=False), lab):
                try:
                    is_sock = stat.S_ISSOCK(mp.lstat().st_mode)
                except OSError:
                    is_sock = False
                if is_sock:
                    raise AuditError(f"-chardev channel is an existing host socket: {m[:160]}")
                raise AuditError(f"-chardev channel outside lab (fail closed): {m[:160]}")
            unix_channels.append(m)
        elif tok.startswith("-"):
            raise AuditError(f"unsupported QEMU flag (fail closed): {tok[:80]}")
        else:
            raise AuditError(f"unexpected positional argv token (fail closed): {tok[:120]}")
        i += 1
    if vm_name not in allowed_vms:
        raise AuditError(f"unexpected -name (fail closed): {vm_name!r}")
    if not any(v == "accel=kvm" for v in machine_values):
        raise AuditError("KVM accel required (-machine accel=kvm absent)")
    if any("accel=kvm:" in v for v in machine_values):
        raise AuditError("accel fallback list refused (KVM must be direct)")
    if "max" not in cpu_values:
        raise AuditError("-cpu max required (fail closed)")
    joined = " ".join(argv)
    for bad in (
        "-fsdev",
        "virtio-9p",
        "vhost-user-fs",
        "vhost-user-vsock",
        "-virtfs",
        "virtiofsd",
        "tap,",
        ",tap",
        "bridge,",
        "vde,",
        "vfio-pci",
        "file=/dev/",
    ):
        if bad in joined:
            raise AuditError(f"forbidden host share/device/net refused: {bad}")
    attached: list[dict] = []
    for disk in drives:
        resolved = _check_guest_disk(disk, lab=lab, project=project)
        backings = _check_backing_chain(resolved, lab=lab, project=project)
        attached.append({"drive": disk, "resolved": str(resolved), "backing": backings})
    return {"vm": vm_name, "drives": attached, "unix_channels": sorted(set(unix_channels))}


QEMU_BIN_RE = r"/bin/(qemu-system-x86_64|qemu-kvm)(?![A-Za-z0-9_.-])"


def substitute_qemu(script_text: str, wrapper_path: str) -> tuple[str, str]:
    """Replace ONLY the QEMU system binary token with the wrapper.

    Returns (new_text, real_qemu_path). Fails closed unless exactly one
    occurrence exists (qemu-img and other qemu-* names never match).
    All other bytes stay identical (caller hash-logs before/after).
    """
    import re as _re

    matches = _re.findall(QEMU_BIN_RE, script_text)
    if len(matches) != 1:
        raise AuditError(
            f"expected exactly 1 QEMU system binary token, found {len(matches)} "
            "(unsupported launch syntax, fail closed)"
        )
    m = _re.search(
        r"(/nix/store/[A-Za-z0-9._+\-]+/bin/(?:qemu-system-x86_64|qemu-kvm))(?![A-Za-z0-9_.-])",
        script_text,
    )
    if m is None:
        raise AuditError("QEMU token is not an absolute /nix/store path (fail closed)")
    real_qemu = m.group(1)
    new_text = script_text[: m.start(1)] + wrapper_path + script_text[m.end(1) :]
    if real_qemu in new_text:
        raise AuditError("substitution incomplete (real path still present)")
    return new_text, real_qemu


def _make_qcow2(
    path: Path, size_mb: int = 8, backing: Path | None = None, backing_fmt: str = "qcow2"
) -> None:
    cmd = ["qemu-img", "create", "-f", "qcow2"]
    if backing is not None:
        cmd += ["-F", backing_fmt, "-b", str(backing)]
    cmd += [str(path), f"{size_mb}M"]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise RuntimeError(f"qemu-img create failed: {proc.stderr[-500:]}")


def _base_argv(*, lab: Path, vm: str = "edge") -> list[str]:
    return [
        "/bin/false-qemu",
        "-machine",
        "accel=kvm",
        "-cpu",
        "max",
        "-name",
        vm,
        "-m",
        "1024",
        "-smp",
        "1",
        "-device",
        "virtio-blk-pci,drive=d0",
        "-net",
        "nic,netdev=user.0,model=virtio",
        "-netdev",
        "user,id=user.0,restrict=on",
    ]


def selftest() -> int:
    """Negative/positive fixtures against the ACTUAL validator (no guest,
    no QEMU launch; needs python3 + qemu-img on PATH). Returns exit code."""
    import shutil
    import tempfile

    failures: list[str] = []

    def expect_reject(label: str, argv: list[str], *, lab: Path, project: Path | None) -> None:
        try:
            audit_argv(argv, lab=lab, project=project)
        except AuditError as exc:
            print(f"selftest {label}: correctly rejected ({exc})", flush=True)
            return
        failures.append(label)
        print(f"selftest {label}: FAIL — accepted but must refuse", flush=True)

    def expect_accept(label: str, argv: list[str], *, lab: Path, project: Path | None) -> dict:
        try:
            result = audit_argv(argv, lab=lab, project=project)
        except AuditError as exc:
            failures.append(label)
            print(f"selftest {label}: FAIL — refused but must accept ({exc})", flush=True)
            raise SystemExit(1)
        print(f"selftest {label}: correctly accepted", flush=True)
        return result

    yolo_root = os.environ.get("YOLO_VM_STATE_DIR")
    if yolo_root:
        tmp_parent: str | None = yolo_root
    else:
        tmp_parent = None
    lab = Path(tempfile.mkdtemp(prefix="vm-audit-selftest-lab-", dir=tmp_parent)).resolve()
    outside = Path(tempfile.mkdtemp(prefix="vm-audit-selftest-outside-", dir=tmp_parent)).resolve()
    try:
        if shutil.which("qemu-img") is None:
            print("selftest: FAIL — qemu-img absent (no fallback)", flush=True)
            return 1
        # Positive: lab-contained regular disk, no backing.
        good = lab / "good.qcow2"
        _make_qcow2(good)
        argv = _base_argv(lab=lab) + ["-drive", f"file={good},if=none"]
        result = expect_accept("lab-disk-no-backing", argv, lab=lab, project=None)
        assert result["drives"][0]["backing"] == [], result
        # Positive: lab-contained backing chain.
        base = lab / "base.qcow2"
        _make_qcow2(base)
        overlay = lab / "overlay.qcow2"
        _make_qcow2(overlay, backing=base)
        argv = _base_argv(lab=lab) + ["-drive", f"file={overlay},if=none"]
        result = expect_accept("lab-backing-chain", argv, lab=lab, project=None)
        assert result["drives"][0]["backing"] == [str(base)], result
        # Negative: outside-resolving symlink drive (no guest launch).
        secret = outside / "secret.img"
        _make_qcow2(secret)
        link = lab / "evil-link.qcow2"
        try:
            link.symlink_to(secret)
        except OSError as exc:
            print(f"selftest symlink fixture unavailable: {exc}", flush=True)
            return 1
        argv = _base_argv(lab=lab) + ["-drive", f"file={link},if=none"]
        expect_reject("outside-symlink-drive", argv, lab=lab, project=None)
        # Negative: outside backing chain (real qemu-img files, no guest).
        out_base = outside / "out-base.qcow2"
        _make_qcow2(out_base)
        out_overlay = lab / "out-overlay.qcow2"
        _make_qcow2(out_overlay, backing=out_base)
        argv = _base_argv(lab=lab) + ["-drive", f"file={out_overlay},if=none"]
        expect_reject("outside-backing-chain", argv, lab=lab, project=None)
        # Positive: store-symlink -kernel accepted (boot input resolves
        # store-contained; guest-disk symlink strictness does not apply).
        _store_samples = sorted(Path("/nix/store").glob("*-bash-*/bin/bash"))
        klink = lab / "kern-link"
        if not _store_samples or not _store_samples[0].is_file():
            print("selftest kernel-symlink: skipped (no store bash sample)", flush=True)
        else:
            try:
                klink.symlink_to(_store_samples[0])
            except OSError as exc:
                print(f"selftest kernel-symlink fixture unavailable: {exc}", flush=True)
                return 1
            argv = _base_argv(lab=lab) + [
                "-drive", f"file={good},if=none",
                "-kernel", str(klink),
                "-initrd", str(_store_samples[0]),
            ]
            try:
                audit_argv(argv, lab=lab, project=None)
            except AuditError as exc:
                failures.append("kernel-symlink-store")
                print(f"selftest kernel-symlink-store: FAIL — refused ({exc})", flush=True)
            else:
                print("selftest kernel-symlink-store: correctly accepted", flush=True)
        # Negative: /nix/store backing for guest disks (no exception).
        store_candidates = sorted(Path("/nix/store").glob("*-bash-*/bin/bash"))
        if store_candidates and store_candidates[0].is_file():
            store_backed = lab / "store-backed.qcow2"
            # An ELF binary is not qcow2: declare raw backing format so the
            # chain resolves and the AUDIT (not image creation) refuses it.
            _make_qcow2(store_backed, backing=store_candidates[0], backing_fmt="raw")
            argv = _base_argv(lab=lab) + ["-drive", f"file={store_backed},if=none"]
            expect_reject("store-backing-no-exception", argv, lab=lab, project=None)
        else:
            print("selftest store-backing-no-exception: skipped (no store bash sample)", flush=True)
        # Negative: forbidden sharing/net.
        argv = _base_argv(lab=lab) + ["-drive", f"file={good},if=none", "-netdev", "tap,id=t0"]
        expect_reject("tap-netdev", argv, lab=lab, project=None)
        argv = _base_argv(lab=lab) + ["-drive", f"file={good},if=none", "-device", "virtio-9p-pci,fsdev=f0"]
        expect_reject("virtio-9p", argv, lab=lab, project=None)
        argv = _base_argv(lab=lab) + ["-drive", f"file=/dev/sda,if=none"]
        expect_reject("dev-backed-drive", argv, lab=lab, project=None)
        # Negative: missing KVM / wrong CPU / unknown VM / stray flag.
        argv = [a for a in _base_argv(lab=lab) if a != "accel=kvm"] + ["-drive", f"file={good},if=none"]
        expect_reject("missing-kvm", argv, lab=lab, project=None)
        argv = _base_argv(lab=lab, vm="intruder") + ["-drive", f"file={good},if=none"]
        expect_reject("unknown-vm", argv, lab=lab, project=None)
        argv = _base_argv(lab=lab) + ["-drive", f"file={good},if=none", "-display", "none"]
        expect_reject("unsupported-flag", argv, lab=lab, project=None)
        # Positive: bare `unix:` qmp channel under lab (generated form).
        argv = _base_argv(lab=lab) + [
            "-drive", f"file={good},if=none",
            "-qmp", f"unix:{lab}/qmp,server=on,wait=off",
        ]
        result = expect_accept("qmp-bare-unix-lab", argv, lab=lab, project=None)
        assert result["unix_channels"] == [f"{lab}/qmp"], result
        # Positive: -serial stdio (driver console pipes, no host file).
        argv = _base_argv(lab=lab) + ["-drive", f"file={good},if=none", "-serial", "stdio"]
        expect_accept("serial-stdio", argv, lab=lab, project=None)
        # Negative: -serial to a host file / TCP.
        argv = _base_argv(lab=lab) + ["-drive", f"file={good},if=none", "-serial", "file:/tmp/serial.log"]
        expect_reject("serial-file", argv, lab=lab, project=None)
        # Negative: qmp outside lab / non-Unix.
        argv = _base_argv(lab=lab) + ["-drive", f"file={good},if=none", "-qmp", f"unix:{outside}/qmp,server=on"]
        expect_reject("qmp-outside-lab", argv, lab=lab, project=None)
        argv = _base_argv(lab=lab) + ["-drive", f"file={good},if=none", "-qmp", "tcp:127.0.0.1:4444,server=on"]
        expect_reject("qmp-tcp", argv, lab=lab, project=None)
        # Positive: virtconsole on a lab-socket chardev (driver serial).
        argv = _base_argv(lab=lab) + [
            "-drive", f"file={good},if=none",
            "-chardev", f"socket,id=shell,path={lab}/shell,server=on,wait=off",
            "-device", "virtconsole,chardev=shell",
        ]
        result = expect_accept("virtconsole-lab-socket", argv, lab=lab, project=None)
        assert result["unix_channels"] == [f"{lab}/shell"], result
        # Negative: virtconsole on unknown/outside chardev.
        argv = _base_argv(lab=lab) + [
            "-drive", f"file={good},if=none",
            "-device", "virtconsole,chardev=ghost",
        ]
        expect_reject("virtconsole-unknown-chardev", argv, lab=lab, project=None)
        argv = _base_argv(lab=lab) + [
            "-drive", f"file={good},if=none",
            "-chardev", "socket,id=s,path=/tmp/outside-sock,server=on",
            "-device", "virtconsole,chardev=s",
        ]
        expect_reject("virtconsole-outside-socket", argv, lab=lab, project=None)
        # Negative: drive without file=.
        argv = _base_argv(lab=lab) + ["-drive", "if=none"]
        expect_reject("drive-without-file", argv, lab=lab, project=None)
        # Exec-path refusal (actual _audit_exec entry, no exec: outside drive
        # must exit 125 AND write no audit log). The drive file really exists
        # so refusal is FOR the outside-lab rule (not missing-file).
        _make_qcow2(outside / "nope.qcow2")
        bad_argv = (
            ["qemu", "-machine", "accel=kvm", "-cpu", "max", "-name", "edge",
             "-m", "1024", "-smp", "1", "-device", "virtio-blk-pci,drive=d0",
             "-net", "nic,netdev=user.0,model=virtio", "-netdev", "user,id=user.0,restrict=on",
             "-drive", f"file={outside}/nope.qcow2,if=none"]
        )
        rc = _audit_exec("/bin/false", bad_argv, str(lab))
        if rc != AUDIT_FAIL_EXIT:
            failures.append("exec-refuses-outside")
            print("selftest exec-refuses-outside: FAIL — exit was not 125", flush=True)
        elif list(lab.glob("audit-*.jsonl")):
            failures.append("exec-refuses-outside")
            print("selftest exec-refuses-outside: FAIL — refusal wrote audit log", flush=True)
        else:
            print("selftest exec-refuses-outside: correctly refused pre-exec", flush=True)
        # Exec-path lab handling: unresolvable lab fails closed (no exec).
        rc = _audit_exec("/bin/false", _base_argv(lab=lab), str(lab / "does-not-exist"))
        if rc != AUDIT_FAIL_EXIT:
            failures.append("exec-refuses-bad-lab")
            print("selftest exec-refuses-bad-lab: FAIL", flush=True)
        else:
            print("selftest exec-refuses-bad-lab: correctly refused", flush=True)
        # Positive: project-contained drive accepted only when that project
        # root is explicitly given (spec-literal lab-or-project roots).
        projroot = Path(tempfile.mkdtemp(prefix="vm-audit-selftest-proj-"))
        try:
            projdisk = projroot / "proj.qcow2"
            _make_qcow2(projdisk)
            argv = _base_argv(lab=lab) + ["-drive", f"file={projdisk},if=none"]
            expect_accept("project-drive-with-project", argv, lab=lab, project=projroot)
            expect_reject("project-drive-without-project", argv, lab=lab, project=None)
        finally:
            shutil.rmtree(projroot, ignore_errors=True)
    finally:
        shutil.rmtree(lab, ignore_errors=True)
        shutil.rmtree(outside, ignore_errors=True)
    # Substitution fixtures: exact single-token replacement, nothing else.
    sample = (
        "#!/bin/sh\n"
        "qemu-img create -f raw foo 1M\n"
        "exec /nix/store/abc-qemu-for-vm-tests-11.1.1/bin/qemu-system-x86_64 -machine accel=kvm -cpu max\n"
    )
    new_text, real = substitute_qemu(sample, "/lab/qemu-audit-edge.sh")
    if real != "/nix/store/abc-qemu-for-vm-tests-11.1.1/bin/qemu-system-x86_64":
        failures.append("substitution-real-path")
        print("selftest substitution-real-path: FAIL", flush=True)
    else:
        print("selftest substitution-real-path: correctly extracted", flush=True)
    if "/lab/qemu-audit-edge.sh -machine accel=kvm" not in new_text:
        failures.append("substitution-placement")
        print("selftest substitution-placement: FAIL", flush=True)
    else:
        print("selftest substitution-placement: correctly placed", flush=True)
    if "qemu-img create" not in new_text or "qemu-system-x86_64" in new_text:
        failures.append("substitution-hygiene")
        print("selftest substitution-hygiene: FAIL", flush=True)
    else:
        print("selftest substitution-hygiene: qemu-img untouched, no token remains", flush=True)
    try:
        substitute_qemu("exec /bin/qemu-system-x86_64\nexec /bin/qemu-system-x86_64\n", "/w")
        failures.append("substitution-multi-refuses")
        print("selftest substitution-multi-refuses: FAIL — accepted 2 tokens", flush=True)
    except AuditError:
        print("selftest substitution-multi-refuses: correctly refused", flush=True)
    try:
        substitute_qemu("exec qemu-system-x86_64\n", "/w")
        failures.append("substitution-relative-refuses")
        print("selftest substitution-relative-refuses: FAIL — accepted relative path", flush=True)
    except AuditError:
        print("selftest substitution-relative-refuses: correctly refused", flush=True)
    if failures:
        print(f"selftest: FAIL — {len(failures)} fixture(s) wrong: {failures}", flush=True)
        return 1
    print("selftest: OK (actual validator, no guest, no QEMU launch)", flush=True)
    return 0


def _audit_exec(real_qemu: str, argv: list[str], lab_text: str) -> int:
    """Pre-exec audit used by the wrapper: validate, log, then exec.

    The lab arrives as an explicit baked literal (no TMPDIR guessing and
    no name-pattern heuristics: both failed in prelim against driver-set
    TMPDIR values outside our control).
    """
    try:
        lab_path = Path(lab_text).resolve(strict=True)
    except Exception:
        sys.stderr.write("vm-audit: FAIL — lab not resolvable (fail closed)\n")
        return AUDIT_FAIL_EXIT
    if not lab_path.is_dir():
        sys.stderr.write("vm-audit: FAIL — lab not a directory (fail closed)\n")
        return AUDIT_FAIL_EXIT
    yolo_root = os.environ.get("YOLO_VM_STATE_DIR", "")
    if yolo_root:
        try:
            yolo_resolved = Path(yolo_root).resolve(strict=True)
        except Exception:
            sys.stderr.write("vm-audit: FAIL — YOLO root unresolvable (fail closed)\n")
            return AUDIT_FAIL_EXIT
        if not lab_path.is_relative_to(yolo_resolved):
            sys.stderr.write("vm-audit: FAIL — lab outside YOLO root (fail closed)\n")
            return AUDIT_FAIL_EXIT
    project = _repo_root()
    try:
        mapping = audit_argv(list(argv), lab=lab_path, project=project)
    except AuditError as exc:
        sys.stderr.write(f"vm-audit: FAIL — {exc}\n")
        return AUDIT_FAIL_EXIT
    try:
        log_path = lab_path / f"audit-{mapping['vm']}.jsonl"
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps({"argv": list(argv), "mapping": mapping}) + "\n")
    except OSError as exc:
        sys.stderr.write(f"vm-audit: FAIL — cannot write audit log: {exc}\n")
        return AUDIT_FAIL_EXIT
    os.execv(real_qemu, [real_qemu, *list(argv)[1:]])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="command", required=True)
    sub.add_parser("selftest", help="run validator fixtures (no guest)")
    ex = sub.add_parser("audit-exec", help="pre-exec audit then exec real QEMU")
    ex.add_argument("--lab", required=True)
    ex.add_argument("real_qemu")
    ex.add_argument("rest", nargs=argparse.REMAINDER)
    args = ap.parse_args(argv)
    if args.command == "selftest":
        return selftest()
    rest = list(args.rest)
    if rest and rest[0] == "--":
        rest = rest[1:]
    return _audit_exec(args.real_qemu, ["qemu"] + rest, args.lab)


if __name__ == "__main__":
    sys.exit(main())
