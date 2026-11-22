import argparse
from contextlib import ExitStack, contextmanager
import errno
import json
import os
from pathlib import Path
import pwd
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time


HERE = Path(__file__).resolve().parent
TIMEOUT = 45
SEED = b"fixture: host to sandbox\n"
COPY = b"fixture: sandbox to host\n\x00\xff\n"
PROBE = r'''
import errno
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def permission_denied(operation, description):
    try:
        operation()
    except OSError as exc:
        if exc.errno not in (errno.EACCES, errno.EPERM):
            raise RuntimeError(f"{description}: expected permission denial, got {exc}") from exc
    else:
        raise RuntimeError(f"{description}: unexpectedly allowed")


def connect(family, addr, denied=False):
    with socket.socket(family, socket.SOCK_STREAM) as peer:
        peer.settimeout(3)
        if denied:
            permission_denied(lambda: peer.connect(addr), f"connect {addr}")
        else:
            peer.connect(addr)


def check_chmod_denied(protected, neighbor, is_expected_type):
    protected_mode = protected.lstat().st_mode
    neighbor_mode = neighbor.lstat().st_mode
    require(is_expected_type(protected_mode) and is_expected_type(neighbor_mode),
            f"unexpected fixture path type: {protected} or {neighbor}")
    neighbor.chmod(stat.S_IMODE(neighbor_mode))
    permission_denied(lambda: protected.chmod(stat.S_IMODE(protected_mode)), f"chmod {protected}")


mode, tcp_port, real_tmux, pane, fmt, seed, copy = sys.argv[1:]
root = Path.cwd().parent
rw = root / "rw"
tmux_socket = root / "tm" / "s.sock"
for path in [Path.cwd() / "a.sock", rw / "b.sock", rw / "alias.sock"]:
    require(stat.S_ISSOCK(path.stat().st_mode), f"socket is not visible: {path}")
    connect(socket.AF_UNIX, str(path), denied=True)
if mode != "no-tmux":
    require(stat.S_ISSOCK(tmux_socket.stat().st_mode), "covered tmux socket is not visible")
connect(socket.AF_UNIX, str(tmux_socket), denied=True)

protected = root / "ro" / "ordinary.txt"
require(protected.read_bytes() == b"seed\n", "protected regular file is not readable")
permission_denied(lambda: protected.write_bytes(b"changed\n"), "write protected regular file")
permission_denied(lambda: protected.rename(protected.with_suffix(".renamed")), "rename protected regular file")
writable = rw / "ordinary.txt"
writable.write_text(mode, encoding="ascii")
writable.rename(rw / "wrote")
configured = rw / "pod.sock"
check_chmod_denied(configured, rw / "b.sock", stat.S_ISSOCK)
uri = "unix://" + str(configured)
for name in ["DOCKER_HOST", "CONTAINER_HOST"]:
    require(os.environ.get(name) == uri, f"{name} did not use the canonical Podman endpoint")
connect(socket.AF_UNIX, os.environ["DOCKER_HOST"][len("unix://"):])
connect(socket.AF_INET, ("127.0.0.1", int(tcp_port)))

if mode != "tmux":
    for name in ["TMUX", "TMUX_PANE", "YOLO_CLIPBOARD_SOCK", "SMIND_TMUX_COMMAND"]:
        require(not os.environ.get(name), f"unexpected {name} without inherited tmux")
    print("no-tmux-ok")
    sys.exit(0)

temp = root / "t"
broker = Path(os.environ["YOLO_CLIPBOARD_SOCK"])
require(broker.is_absolute() and broker.parent.parent == temp and broker.resolve(strict=True) == broker,
        "broker is not at a canonical path under the fixture runtime directory")
require(broker.is_socket(), "broker socket is missing")
check_chmod_denied(broker.parent, temp / "neighbor", stat.S_ISDIR)
coord = os.environ["TMUX"]
address, _, _ = coord.rsplit(",", 2)
require(address == str(broker), "TMUX does not point to the broker")
require(os.environ["TMUX_PANE"] == pane, "TMUX_PANE does not identify the fixture pane")
shim = shutil.which("tmux")
require(shim and not os.path.samefile(shim, real_tmux), "PATH tmux is not the shim")
route = os.environ["SMIND_TMUX_COMMAND"]
require(os.path.samefile(shim, route), "SMIND_TMUX_COMMAND does not point to the shim")


def shim_call(args, data=None, status=0):
    result = subprocess.run([shim, *args], input=data, capture_output=True, timeout=20)
    require(result.returncode == status, f"shim {args}: {result}")
    if status != 0:
        require(not result.stdout and b"tmux shim:" in result.stderr, "expected a shim rejection")
    return result.stdout


query = ["-N", "-S", address, "display-message", "-p", "-t", pane]
before = shim_call([*query, fmt])
shim_call([*query, "#{pane_id}"], status=1)
require(shim_call(["save-buffer", "-"]) == bytes.fromhex(seed), "clipboard read differs")
require(shim_call(["show-buffer"]) == bytes.fromhex(seed), "clipboard show differs")
shim_call(["load-buffer", "-"], bytes.fromhex(copy))
require(shim_call(["save-buffer", "-"]) == bytes.fromhex(copy), "clipboard round trip differs")
Path("ready.tmp").write_text(json.dumps({"broker": str(broker), "before": before.hex()}), encoding="ascii")
Path("ready.tmp").replace("ready")
require(sys.stdin.buffer.readline() == b"renamed\n", "rename was not acknowledged")
print(shim_call([*query, fmt]).hex())
'''


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


@contextmanager
def process(argv, cwd, env, **kwargs):
    child = subprocess.Popen(argv, cwd=cwd, env=env, start_new_session=True, **kwargs)
    try:
        yield child
    except BaseException:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
        raise
    finally:
        for stream in (child.stdin, child.stdout, child.stderr):
            if stream:
                stream.close()


def run(argv, cwd, env, data=None):
    with process(argv, cwd, env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                 stderr=subprocess.PIPE) as child:
        out, err = child.communicate(data, timeout=TIMEOUT)
        require(child.returncode == 0, f"{argv[0]} exited {child.returncode}: {err!r}\n{out!r}")
        return out


def listener(stack, family, address):
    peer = stack.enter_context(socket.socket(family, socket.SOCK_STREAM))
    peer.settimeout(3)
    peer.bind(address)
    peer.listen()
    return peer


def accept(peer):
    conn, _ = peer.accept()
    conn.close()


def connect_only(family, address):
    with socket.socket(family, socket.SOCK_STREAM) as client:
        client.settimeout(3)
        client.connect(address)


def positive_control(peer, address):
    connect_only(peer.family, address)
    accept(peer)


def no_connection(peer):
    peer.setblocking(False)
    try:
        conn, _ = peer.accept()
    except BlockingIOError as exc:
        require(exc.errno in (errno.EAGAIN, errno.EWOULDBLOCK), str(exc))
    else:
        conn.close()
        raise RuntimeError(f"denied listener received a connection: {peer.getsockname()}")
    finally:
        peer.settimeout(3)


def ready_or_exit(child, file, log):
    until = time.monotonic() + TIMEOUT
    while not file.is_file():
        require(child.poll() is None, f"sandbox exited before query: {log.read_bytes()!r}")
        require(time.monotonic() < until, f"sandbox query timed out: {log.read_bytes()!r}")
        time.sleep(0.05)
    return json.loads(file.read_text(encoding="ascii"))


def run_fixture(args, root, launch, env, fmt):
    project = root / "p"
    rw = root / "rw"
    temp = root / "t"
    tmux_dir = root / "tm"
    tmux_socket = tmux_dir / "s.sock"
    a_path = project / "a.sock"
    b_path = rw / "b.sock"
    alias = rw / "alias.sock"
    pod_path = rw / "pod.sock"
    pod_alias = root / "stable.sock"
    runtime_neighbor = temp / "neighbor"
    protected = root / "ro" / "ordinary.txt"
    for path in (tmux_socket, a_path, b_path, alias, pod_path, pod_alias):
        require(len(os.fsencode(path)) <= 103, f"Darwin Unix socket path is too long: {path}")
    require(len(os.fsencode(temp)) <= 60, f"leave room for the broker socket below {temp}")
    for path in (project, rw, temp, tmux_dir, protected.parent, root / "home", runtime_neighbor):
        path.mkdir(mode=0o700)
    seed_file = protected.with_suffix(".tmp")
    seed_file.write_bytes(b"seed\n")
    seed_file.rename(protected)
    env.update(HOME=str(root / "home"), TMPDIR=str(temp), TMUX_TMPDIR=str(temp),
               XDG_CONFIG_HOME=str(root / "config"), XDG_CACHE_HOME=str(root / "cache"),
               XDG_DATA_HOME=str(root / "data"), XDG_STATE_HOME=str(root / "state"), XDG_RUNTIME_DIR=str(temp),
               YOLO_PODMAN_SOCKET_PATH=str(pod_alias), YOLO_PODMAN_SOCKET_URI=f"unix://{pod_alias}")
    probe = project / "probe.py"
    probe.write_text(PROBE, encoding="ascii")
    socket_argv = [args.tmux, "-S", str(tmux_socket)]
    with ExitStack() as stack:
        a = listener(stack, socket.AF_UNIX, str(a_path))
        b = listener(stack, socket.AF_UNIX, str(b_path))
        alias.symlink_to(b_path.name)
        pod = listener(stack, socket.AF_UNIX, str(pod_path))
        pod_alias.symlink_to(pod_path.relative_to(root))
        tcp = listener(stack, socket.AF_INET, ("127.0.0.1", 0))
        tcp_addr = tcp.getsockname()

        def preflight():
            for peer, addr in ((a, str(a_path)), (b, str(b_path)), (b, str(alias)),
                               (pod, str(pod_path)), (pod, str(pod_alias)), (tcp, tcp_addr)):
                positive_control(peer, addr)
            connect_only(socket.AF_UNIX, str(tmux_socket))

        def check_controls(mode):
            no_connection(a)
            no_connection(b)
            accept(pod)
            accept(tcp)
            require((rw / "wrote").read_text(encoding="ascii") == mode, "--rw write or rename missing")
            (rw / "wrote").unlink()
            require(protected.read_bytes() == b"seed\n" and not protected.with_suffix(".renamed").exists(),
                    "protected regular file was modified")

        try:
            run([*socket_argv, "-f", "/dev/null", "new-session", "-d", "-s", "fixture", "-n", "before",
                 "-c", str(project), "/bin/sleep", "180"], project, env)
            ids = run([args.tmux, "-N", "-S", str(tmux_socket),
                       "display-message", "-p", "-t", "fixture:before",
                       "#{pid} #{session_id} #{pane_id}"], project, env)
            pid, session, pane = ids.decode("ascii").split()
            require(pid.isdecimal() and int(pid) > 0 and session.startswith("$") and session[1:].isdecimal()
                    and pane.startswith("%") and pane[1:].isdecimal(), f"invalid fixture ids: {ids!r}")
            native_query = [args.tmux, "-N", "-S", str(tmux_socket),
                            "display-message", "-p", "-t", pane, fmt]
            before = run(native_query, project, env)
            require(before.strip(), "empty native tmux window metadata")
            run([*socket_argv, "load-buffer", "-"], project, env, SEED)
            inherited = dict(env, TMUX=f"{tmux_socket},{pid},{session[1:]}", TMUX_PANE=pane)

            def sandbox(mode):
                grants = ["--rw", str(rw), "--ro", str(protected.parent),
                          "--ro", sys.executable, "--ro", sys.base_prefix]
                if mode != "no-tmux":
                    grants += ["--rw", str(tmux_dir)]
                if mode == "tmux":
                    grants += ["--rw", str(temp)]
                return [*launch, *grants, "cmd", sys.executable, "-IB", str(probe),
                        mode, str(tcp_addr[1]), args.tmux, pane, fmt, SEED.hex(), COPY.hex()]

            preflight()
            log = project / "stderr"
            with log.open("wb") as err, process(sandbox("tmux"), project, inherited,
                                                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                                stderr=err) as child:
                ready = ready_or_exit(child, project / "ready", log)
                broker = Path(ready["broker"])
                require(broker.is_relative_to(temp) and broker.parent != temp and broker.is_socket()
                        and broker.resolve(strict=True).is_relative_to(temp),
                        f"broker is not a live socket in its scoped runtime directory: {broker}")
                require(bytes.fromhex(ready["before"]) == before, "initial shim metadata differs from native tmux")
                run([*socket_argv, "rename-window", "-t", "fixture:before", "renamed"], project, env)
                after = run(native_query, project, env)
                require(before != after, "native metadata did not change after rename")
                out, _ = child.communicate(b"renamed\n", timeout=TIMEOUT)
                require(child.returncode == 0, f"sandbox failed: {out!r}\n{log.read_bytes()!r}")
                require(out.strip() == after.hex().encode("ascii"), "live shim metadata differs after rename")
            require(not broker.exists() and not broker.parent.exists() and set(temp.iterdir()) == {runtime_neighbor},
                    "broker or launcher temporary files remained after exit")
            require(run([*socket_argv, "save-buffer", "-"], project, env) == COPY,
                    "native tmux did not receive sandbox clipboard bytes")
            check_controls("tmux")
            print("PASS: live tmux queries, invalid format, clipboard, cleanup, Unix denial, Podman and TCP controls")

            for mode in ("no-tmux", "no-tmux-rw"):
                preflight()
                require(run(sandbox(mode), project, env) == b"no-tmux-ok\n", f"{mode} launch failed")
                check_controls(mode)
                require(set(temp.iterdir()) == {runtime_neighbor}, f"temporary files remained after {mode} launch")
            print("PASS: no-TMUX denies direct connects to fixture-owned sockets even with covering --rw; "
                  "protected regular files and allowed controls verified")
        finally:
            if tmux_socket.is_socket():
                run([*socket_argv, "kill-server"], project, env)


def executable(path):
    if not path:
        raise ValueError("missing executable path")
    exe = Path(path)
    if not exe.is_absolute() or not exe.is_file() or not os.access(exe, os.X_OK):
        raise ValueError(f"not an absolute executable path: {path}")
    return str(exe)


def main():
    parser = argparse.ArgumentParser(description="Run the native Darwin yolo tmux confinement acceptance fixture")
    parser.add_argument("--root", type=Path, required=True, help="short, owned directory for all test writes")
    parser.add_argument("--tmux", type=executable, required=True, help="real tmux with support for -N")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--source", action="store_true", help="run the production wrapper from this checkout")
    mode.add_argument("--yolo", type=executable, help="fixture-safe packaged yolo")
    parser.add_argument("--bash", default=os.environ.get("BASH"), help="source mode: absolute Bash >= 4.2 (defaults to BASH)")
    parser.add_argument("--sandbox-exec", help="source mode: absolute native claude-sandbox executable")
    parser.add_argument("--jq", help="source mode: absolute jq executable")
    parser.add_argument("--proxy", help="source mode: absolute yolo-clipboard-proxy executable")
    parser.add_argument("--shim-dir", type=Path, help="source mode: absolute directory with a tmux symlink to --proxy")
    args = parser.parse_args()
    require(sys.platform == "darwin", "native macOS is required; do not run in a Nix build sandbox")
    root = args.root.resolve(strict=True)
    st = root.stat()
    require(root.is_dir() and st.st_uid == os.geteuid() and not st.st_mode & 0o022,
            "--root must be owned by the current user and not group/world-writable")
    require("," not in str(root) and "\n" not in str(root), "--root must not contain comma or newline")
    fmt = (HERE.parent / "agent-notify" / "tmux-window-format.txt").read_text(encoding="utf-8").rstrip("\n")
    require(fmt and "\n" not in fmt and "#(" not in fmt, "expected a read-only single-line tmux window format")
    user = pwd.getpwuid(os.geteuid()).pw_name
    env = {"PATH": f"{Path(args.tmux).parent}:/usr/bin:/bin:/usr/sbin:/sbin",
           "SHELL": "/bin/sh", "TERM": "xterm-256color", "USER": user, "LOGNAME": user,
           "LC_ALL": "C", "YOLO_ALLOW_TMUX_WINDOW_QUERY": "1"}
    if args.source:
        bash = executable(args.bash)
        sandbox = executable(args.sandbox_exec)
        jq = executable(args.jq)
        proxy = executable(args.proxy)
        shim_dir = args.shim_dir
        require(shim_dir and shim_dir.is_absolute() and os.path.samefile(shim_dir / "tmux", proxy),
                "--shim-dir must contain a tmux entry pointing to --proxy")
        env.update(YOLO_SANDBOX_EXEC=sandbox, YOLO_JQ=jq, YOLO_CLIPBOARD_PROXY=proxy,
                   YOLO_CLIPBOARD_SHIM_DIR=str(shim_dir), YOLO_TMUX=args.tmux,
                   YOLO_CUSTOM_PROMPT=str(HERE / "custom-prompt.sh"),
                   YOLO_SANDBOX_ENTRYPOINT=str(HERE.parent / "yolo" / "sandbox-entrypoint.sh"))
        launch = [bash, str(HERE / "yolo-darwin.sh"), "--ro", str(shim_dir), "--ro", proxy]
    else:
        launch = [args.yolo]
    with tempfile.TemporaryDirectory(prefix="yt.", dir=root) as directory:
        if args.source:
            run([bash, "-c", "(( BASH_VERSINFO[0] > 4 || BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 2 )) || "
                 "{ echo 'Bash >= 4.2 is required' >&2; exit 1; }"], directory,
                dict(env, HOME=directory, TMPDIR=directory))
        run_fixture(args, Path(directory), launch, env, fmt)


if __name__ == "__main__":
    def interrupt(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGHUP, interrupt)
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as exc:
        sys.exit(f"FAIL: {exc}")
    except KeyboardInterrupt:
        sys.exit("FAIL: interrupted")
