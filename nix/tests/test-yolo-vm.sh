#!/usr/bin/env bash
# Host acceptance test for the yolo KVM capability. Run after Home Manager has
# activated a configuration with smind.hm.dev.llm.yolo.vm.enable = true.
set -uo pipefail

failures=0
tests_run=0

pass() {
  tests_run=$((tests_run + 1))
  printf 'PASS: %s\n' "$1"
}

fail() {
  tests_run=$((tests_run + 1))
  failures=$((failures + 1))
  printf 'FAIL: %s\n' "$1" >&2
}

if ! command -v yolo >/dev/null 2>&1; then
  printf 'FATAL: yolo is not installed\n' >&2
  exit 1
fi

probe="$({
  yolo cmd bash -euo pipefail -c '
    printf "state=%s\n" "${YOLO_VM_STATE_DIR:-}"
    [[ -n "${YOLO_VM_STATE_DIR:-}" ]]
    [[ -d "$YOLO_VM_STATE_DIR" && -w "$YOLO_VM_STATE_DIR" ]]
    [[ -c /dev/kvm && -r /dev/kvm && -w /dev/kvm ]]
    [[ ! -e /dev/net/tun ]]
    printf "host-tun=absent\n"

    if find /dev -xdev -type b -print -quit | grep -q .; then
      printf "block-device=present\n"
      exit 20
    fi
    printf "block-device=absent\n"

    probe_dir="$(mktemp -d /tmp/yolo-vm-device-probe.XXXXXX)"
    if mknod "$probe_dir/block" b 1 0 2>/dev/null; then
      printf "mknod=allowed\n"
      exit 21
    fi
    printf "mknod=denied\n"

    for socket in \
      /run/incus/unix.socket \
      /var/lib/incus/unix.socket \
      /run/libvirt/libvirt-sock \
      /var/run/libvirt/libvirt-sock \
      "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/libvirt/libvirt-sock"; do
      [[ ! -S "$socket" ]] || { printf "management-socket=%s\n" "$socket"; exit 22; }
    done
    printf "management-sockets=absent\n"

    command -v qemu-system-x86_64
    command -v qemu-img
    command -v cloud-localds
    command -v systemd-vmspawn

    image="$(mktemp "$YOLO_VM_STATE_DIR/.acceptance.XXXXXX.raw")"
    trap '\''rm -f -- "$image"'\'' EXIT
    qemu-img create -q -f raw "$image" 1M
    [[ -s "$image" ]]
    printf "persistent-image=created\n"

    set +e
    timeout 2 qemu-system-x86_64 \
      -machine q35,accel=kvm \
      -display none \
      -nodefaults \
      -no-reboot \
      -serial none \
      -monitor none \
      -S
    qemu_status=$?
    set -e
    [[ $qemu_status -eq 124 ]]
    printf "kvm-smoke=passed\n"
  '
} 2>&1)"
probe_status=$?
printf '%s\n' "$probe"

if [[ $probe_status -eq 0 ]]; then
  pass "sandboxed KVM VM capability"
else
  fail "sandboxed KVM VM capability (yolo status $probe_status)"
fi

for expected in \
  'block-device=absent' \
  'host-tun=absent' \
  'mknod=denied' \
  'management-sockets=absent' \
  'persistent-image=created' \
  'kvm-smoke=passed'; do
  if grep -qxF "$expected" <<< "$probe"; then
    pass "$expected"
  else
    fail "$expected"
  fi
done

if [[ $failures -ne 0 ]]; then
  printf '%d of %d tests failed\n' "$failures" "$tests_run" >&2
  exit 1
fi

printf 'All %d tests passed\n' "$tests_run"
