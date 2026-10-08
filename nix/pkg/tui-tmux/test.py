import os
from pathlib import Path
import signal
import shlex
import subprocess
import sys
import tempfile
import time
import tty


def fixture():
    tty.setraw(sys.stdin.fileno())
    received = bytearray()

    def render():
        size = os.get_terminal_size()
        sys.stdout.write(
            "\x1b[2J\x1b[H\x1b[31mTUI READY\x1b[0m"
            f"\x1b[2;1HSIZE {size.columns}x{size.lines}"
            f"\x1b[3;1HINPUT {received.hex()}\x1b[5;7H"
        )
        sys.stdout.flush()

    signal.signal(signal.SIGWINCH, lambda *_: render())
    sys.stdout.write("\x1b[?1049h\x1b[?2004h\x1b[>4;2m")
    render()
    while True:
        data = os.read(sys.stdin.fileno(), 4096)
        if data == b"q":
            sys.stdout.write("\x1b[?1049l\x1b[?2004l\x1b[>4;0m")
            sys.stdout.flush()
            return
        received.extend(data)
        render()


def test(binary):
    with tempfile.TemporaryDirectory(prefix="tui-tmux test-") as directory:
        root = Path(directory)
        environment = dict(os.environ)
        environment.update(
            HOME=str(root), XDG_CONFIG_HOME=str(root / "config"),
            TMUX=str(root / "unreachable-host.sock") + ",123,0", TMUX_PANE="%999",
        )
        # A user config must never be loaded, nor may a PATH shim intercept tmux.
        (root / ".tmux.conf").write_text("set -g default-terminal user-config-loaded\n")
        shim = root / "tmux"
        shim.write_text("#!/bin/sh\nexit 99\n")
        shim.chmod(0o755)
        environment["PATH"] = str(root) + os.pathsep + environment["PATH"]

        for arguments in [[], ["new-session", "-d"], ["-S", "relative", "new-session", "-d"]]:
            result = subprocess.run([binary, *arguments], env=environment, capture_output=True)
            assert result.returncode == 64, result
            assert b"absolute" in result.stderr, result.stderr

        socket = str(root / "server.sock")

        def tmux(*arguments):
            return subprocess.check_output(
                [binary, "-S", socket, *arguments], env=environment, text=True,
                stderr=subprocess.STDOUT, timeout=10,
            )

        def screen():
            return tmux("capture-pane", "-p", "-t", "%0")

        def wait_screen(text):
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                current = screen()
                if text in current:
                    return current
                time.sleep(0.05)
            raise AssertionError(f"Missing {text!r} on screen:\n{screen()}")

        tmux("new-session", "-d", "-s", "tui", "-x", "120", "-y", "40", "sleep", "86400")
        try:
            assert tmux("show-options", "-gv", "default-terminal").strip() != "user-config-loaded"
            tmux("set-option", "-g", "status", "off")
            tmux("set-option", "-g", "default-terminal", "tmux-256color")
            tmux("set-option", "-g", "extended-keys", "on")
            tmux("set-option", "-g", "extended-keys-format", "csi-u")
            tmux("set-option", "-g", "remain-on-exit", "on")
            tmux("resize-window", "-t", "tui:0", "-x", "120", "-y", "40")
            log = root / "output.ansi"
            tmux("pipe-pane", "-O", "-t", "%0", f"cat > {shlex.quote(str(log))}")
            tmux("respawn-pane", "-k", "-t", "%0", sys.executable, __file__, "--fixture")
            wait_screen("TUI READY")
            wait_screen("SIZE 120x40")
            styled = tmux("capture-pane", "-p", "-e", "-t", "%0")
            assert "\x1b[" in styled, repr(styled)
            assert tmux("display-message", "-p", "-t", "%0", "#{cursor_x},#{cursor_y}").strip() == "6,4"

            tmux("send-keys", "-t", "%0", "-l", "--", "Enter")
            received = b"Enter"
            wait_screen("INPUT " + received.hex())
            tmux("send-keys", "-t", "%0", "Enter", "Down")
            received += b"\r\x1b[B"
            wait_screen("INPUT " + received.hex())
            tmux("send-keys", "-t", "%0", "S-Enter")
            received += b"\x1b[13;2u"
            wait_screen("INPUT " + received.hex())

            text = root / "paste.txt"
            text.write_text("first\nsecond")
            tmux("load-buffer", "-b", "input", str(text))
            tmux("paste-buffer", "-p", "-r", "-d", "-b", "input", "-t", "%0")
            received += b"\x1b[200~first\nsecond\x1b[201~"
            wait_screen("INPUT " + received.hex())

            tmux("send-keys", "-t", "%0", "-H", "1b", "5b", "49")
            received += b"\x1b[I"
            wait_screen("INPUT " + received.hex())
            tmux("resize-window", "-t", "tui:0", "-x", "80", "-y", "24")
            wait_screen("SIZE 80x24")
            assert tmux("display-message", "-p", "-t", "%0", "#{pane_width}x#{pane_height}").strip() == "80x24"

            tmux("send-keys", "-t", "%0", "-l", "q")
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if tmux("display-message", "-p", "-t", "%0", "#{pane_dead}").strip() == "1":
                    break
                time.sleep(0.05)
            else:
                raise AssertionError("TUI did not exit")
            status = tmux("display-message", "-p", "-t", "%0", "#{pane_dead_status}").strip()
            assert status == "0", f"Expected clean exit status, got {status!r}"
            assert "\x1b[?1049h" in log.read_text(), "Raw startup log missing"
            print("PASS: private PTY, shim/config isolation, rendered screen/cursor, literal/extended keys, bracketed paste, raw input/log, resize, exit")
        finally:
            tmux("kill-server")


if __name__ == "__main__":
    if sys.argv[1] == "--fixture":
        fixture()
    else:
        test(sys.argv[1])
