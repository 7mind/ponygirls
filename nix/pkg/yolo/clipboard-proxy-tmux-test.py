import os
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path


def check(ok, message):
    if not ok:
        raise AssertionError(message)


def main(proxy, tmux, fixture_parent=None):
    proxy, tmux = str(Path(proxy).absolute()), str(Path(tmux).absolute())
    if fixture_parent is None:
        fixture_parent = "/tmp"
    else:
        fixture_parent = Path(fixture_parent)
        check(fixture_parent.is_absolute(), "fixture root must be an absolute path")
        fixture_parent = fixture_parent.resolve(strict=True)
        details = fixture_parent.stat()
        check(fixture_parent.is_dir() and details.st_uid == os.geteuid() and details.st_mode & 0o077 == 0,
              "fixture root must be a private directory owned by the current user")
    sleep = shutil.which("sleep")
    check(sleep is not None, "sleep not found on fixture PATH")
    wire_format = (Path(__file__).parent / "../agent-notify/tmux-window-format.txt").read_text().removesuffix("\n")
    with tempfile.TemporaryDirectory(prefix="yolo-tmux-", dir=fixture_parent) as root:
        host = str(Path(root) / "host")
        launch_dir = Path(root) / "launch"
        broker = str(launch_dir / "broker")
        check(len(os.fsencode(broker)) < 104 and "," not in root,
              "fixture root must be short enough for Darwin Unix sockets and contain no commas")
        shim = Path(root) / "tmux"
        shim.symlink_to(proxy)
        env = dict(os.environ, HOME=root, XDG_CONFIG_HOME=root, SHELL="/bin/sh", TMUX_TMPDIR=root, TMPDIR=root)
        for name in ("TMUX", "TMUX_PANE", "YOLO_CLIPBOARD_SOCK", "YOLO_CLIPBOARD_SYNC_STAGE", "YOLO_CLIPBOARD_SYNC_GATE"):
            env.pop(name, None)

        def run(argv, *, environment=env, checked=True):
            return subprocess.run(argv, env=environment, capture_output=True, check=checked, timeout=5)

        def host_tmux(*args, checked=True):
            return run([tmux, "-N", "-S", host, *args], checked=checked)

        broker_argv = [proxy, "broker", "--listen", broker, "--tmux-socket", host, "--tmux", tmux]

        @contextmanager
        def broker_server(*options, watch_parent=False):
            argv = [*broker_argv, *options]
            if watch_parent:
                argv = [sys.executable, "-c", "import subprocess, sys; sys.exit(subprocess.call(sys.argv[1:]))", *argv]
            with subprocess.Popen(argv, env=env, start_new_session=watch_parent) as proc:
                try:
                    deadline = time.monotonic() + 5
                    while True:
                        probe = run([proxy, "client", "probe"], checked=False,
                                    environment=dict(env, YOLO_CLIPBOARD_SOCK=broker))
                        if probe.returncode == 0:
                            break
                        check(proc.poll() is None and time.monotonic() < deadline, "broker did not become ready")
                        time.sleep(0.01)
                    yield proc
                finally:
                    try:
                        if watch_parent:
                            if proc.poll() is None or launch_dir.exists():
                                try:
                                    os.killpg(proc.pid, signal.SIGKILL)
                                except (PermissionError, ProcessLookupError):
                                    if proc.poll() is None or launch_dir.exists():
                                        raise
                        else:
                            proc.terminate()
                    finally:
                        try:
                            proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:
                            proc.kill()
                            proc.wait(timeout=5)
                            raise

        server = [tmux, "-f", "/dev/null", "-S", host]

        def start_server(label):
            data = run(server + ["new-session", "-d", "-P", "-F", "#{pane_id}|#{pid}", "-s", "fixture",
                                 "-n", label, sleep, "300"]).stdout.decode().strip()
            return data.split("|")

        try:
            pane, server_pid = start_server("origin")
            other = host_tmux("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "fixture", "-n", "other",
                              sleep, "300").stdout.decode().strip()
            query = ["display-message", "-p", "-t", pane, wire_format]
            shim_argv = [str(shim), "-N", "-S", broker, *query]
            sandbox = dict(env, TMUX=f"{broker},0,0", TMUX_PANE=pane, YOLO_CLIPBOARD_SOCK=broker)

            def reject(description, argv=shim_argv, *, environment=sandbox):
                result = run(argv, environment=environment, checked=False)
                check(result.returncode != 0 and result.stdout == b"",
                      f"{description}: exit={result.returncode} stdout={result.stdout!r} stderr={result.stderr!r}")

            def compare_native(label):
                native = host_tmux(*query).stdout
                check(native == f"{pane}|0|{label}\n".encode(), f"unexpected private tmux output: {native!r}")
                result = run(shim_argv, environment=sandbox, checked=False)
                check(result.returncode == 0 and result.stdout == native,
                      f"shim label query failed: exit={result.returncode} stdout={result.stdout!r} stderr={result.stderr!r}")
                return native

            def exchange(payload, *, tag_only=False):
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                    connection.settimeout(5)
                    connection.connect(broker)
                    connection.sendall(payload)
                    if tag_only:
                        return connection.recv(1)
                    with connection.makefile("rb") as response:
                        return response.read()

            with broker_server():
                reject("metadata requires broker opt-in")
            for options in (["--tmux-pane", pane], ["--tmux-server-pid", server_pid],
                            ["--tmux-pane", pane, "--tmux-server-pid", "0"]):
                result = run([*broker_argv, *options], checked=False)
                check(result.returncode != 0 and not Path(broker).exists(), f"invalid launch authority accepted: {options}")
            with broker_server("--tmux-pane", pane, "--tmux-server-pid", str(int(server_pid) + 1)):
                reject("same live endpoint with nonmatching launch PID")
            with broker_server("--tmux-pane", pane, "--tmux-server-pid", server_pid):
                compare_native("origin")
                host_tmux("rename-window", "-t", pane, "renamed")
                compare_native("renamed")
                host_tmux("select-pane", "-t", pane, "-T", "live|title")
                host_tmux("set-option", "-w", "-t", pane, "@smind_window_label_format", "#{window_name}:#{pane_title}")
                native = compare_native("renamed:live|title")
                check(exchange(b"\x03") == b"\x02" + struct.pack("<I", len(native)) + native,
                      "parameterless wire query did not return the pinned pane")
                check(exchange(b"\x03X", tag_only=True) == b"\x01", "wire query accepted trailing data")

                reject("wrong format", [*shim_argv[:-1], "#{window_name}"])
                reject("extra argument", [*shim_argv, "extra"])
                reject("missing -N", [shim_argv[0], *shim_argv[2:]])
                reject("wrong socket", [*shim_argv[:3], host, *query])
                reject("different TMUX socket", environment=dict(sandbox, TMUX=f"{host},0,0"))
                reject("different broker env socket", environment=dict(sandbox, YOLO_CLIPBOARD_SOCK=host))
                other_argv = [*shim_argv[:-2], other, wire_format]
                reject("wrong pane", other_argv)
                reject("spoofed pane env cannot redirect pinned broker", other_argv,
                       environment=dict(sandbox, TMUX_PANE=other))

                full_label = "X" * (4096 - len(f"{pane}|0|\n"))
                host_tmux("set-option", "-w", "-t", pane, "@smind_window_label_format", full_label)
                compare_native(full_label)
                host_tmux("set-option", "-w", "-t", pane, "@smind_window_label_format", full_label + "X")
                check(len(host_tmux(*query).stdout) == 4097, "native fixture did not exceed the label bound by one")
                reject("metadata output exceeds the label bound")
                host_tmux("kill-pane", "-t", pane)
                check(host_tmux("display-message", "-p", "-t", other, "#{pane_id}").stdout == f"{other}\n".encode(),
                      "remaining private pane is unavailable")
                reject("missing origin must not fall back to a surviving pane")

                host_tmux("kill-server")
                deadline = time.monotonic() + 5
                while True:
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
                        connection.settimeout(5)
                        try:
                            connection.connect(host)
                        except (ConnectionRefusedError, FileNotFoundError):
                            break
                    check(time.monotonic() < deadline, "old private tmux endpoint did not stop")
                    time.sleep(0.01)
                replacement, replacement_pid = start_server("replacement")
                check(replacement == pane and replacement_pid != server_pid,
                      "new private server did not reuse the pane ID with a different server PID")
                check(host_tmux(*query).stdout == f"{pane}|0|replacement\n".encode(),
                      "native replacement pane is unavailable at the original endpoint")
                reject("launch broker must not return a replacement server's window label")
                check(exchange(b"\x03", tag_only=True) == b"\x01", "broker wire exposed replacement metadata")
                host_tmux("set-buffer", "replacement-clipboard")
                clipboard = run([proxy, "client", "get"], environment=sandbox).stdout
                check(clipboard == b"replacement-clipboard", "launch-server metadata binding affected clipboard GET")

            with broker_server(watch_parent=True) as launcher, socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
                conn.settimeout(5)
                conn.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 4096)
                send_bytes = conn.getsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF) + 65536
                check(send_bytes < 1_048_576, "fixture send buffer exceeds clipboard bound")
                conn.connect(broker)
                conn.sendall(b"\x01" + struct.pack("<I", 1_048_576) + b"x" * send_bytes)
                launcher.kill()
                launcher.wait(timeout=5)
                try:
                    reply = conn.recv(1)
                except ConnectionResetError:
                    reply = b""
                check(reply == b"" and not launch_dir.exists(),
                      "parent death did not close the incomplete request and remove the launch directory")
        finally:
            host_tmux("kill-server", checked=False)
    print("Private tmux window label transport passed")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(f"usage: {sys.argv[0]} PROXY REAL_TMUX [PRIVATE_FIXTURE_ROOT]")
    main(*sys.argv[1:])
