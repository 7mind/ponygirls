"""Drive an interactive program in a PTY from a JSON step script.

usage: pty_drive.py <script.json> <transcript> -- <argv...>
Steps: {"send": str} | {"wait": regex, "timeout": seconds} | {"sleep": seconds} | {"exit": seconds}
Output bytes are recorded verbatim to <transcript>. Exit status 0 when all steps succeed.
"""
import fcntl
import json
import os
import re
import select
import signal
import struct
import sys
import termios
import time

ROWS, COLS = 40, 120


def main() -> int:
    script_path, transcript_path = sys.argv[1], sys.argv[2]
    argv = sys.argv[sys.argv.index("--") + 1:]
    with open(script_path) as f:
        steps = json.load(f)
    pid, master = os.forkpty()
    if pid == 0:
        os.execvp(argv[0], argv)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    out = bytearray()
    transcript = open(transcript_path, "wb")

    def pump(timeout: float) -> bool:
        ready, _, _ = select.select([master], [], [], timeout)
        if not ready:
            return True
        try:
            data = os.read(master, 65536)
        except OSError:
            return False
        if not data:
            return False
        out.extend(data)
        transcript.write(data)
        transcript.flush()
        return True

    status = 0
    reaped = False
    for step in steps:
        if "send" in step:
            os.write(master, step["send"].encode())
        elif "sleep" in step:
            end = time.monotonic() + step["sleep"]
            while time.monotonic() < end and pump(max(0.0, end - time.monotonic())):
                pass
        elif "wait" in step:
            pattern = re.compile(step["wait"].encode())
            start = len(out) if step.get("fresh") else 0
            end = time.monotonic() + step.get("timeout", 20)
            while not pattern.search(bytes(out[start:])):
                if time.monotonic() > end or not pump(min(0.2, max(0.0, end - time.monotonic()))):
                    print(f"step failed: wait {step['wait']!r}", file=sys.stderr)
                    status = 1
                    break
            if status:
                break
        elif "exit" in step:
            end = time.monotonic() + step["exit"]
            while time.monotonic() < end:
                done, _ = os.waitpid(pid, os.WNOHANG)
                if done:
                    reaped = True
                    while pump(0.05):
                        if not select.select([master], [], [], 0)[0]:
                            break
                    break
                pump(0.1)
            else:
                print("step failed: process did not exit", file=sys.stderr)
                status = 1
                os.kill(pid, signal.SIGKILL)
            break
    if not reaped and os.waitpid(pid, os.WNOHANG)[0] == 0:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    transcript.close()
    return status


if __name__ == "__main__":
    sys.exit(main())
