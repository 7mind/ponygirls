"""A stand-in owner process: starts the supervisor in its own session with private
pipes (as the extension does), launches one task, reports it, then waits to be killed."""
import json
import os
import subprocess
import sys
import time

sidecar, session_id, shell, command = sys.argv[1:5]
supervisor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "supervisor.py")
proc = subprocess.Popen([sys.executable, supervisor, "--sidecar", sidecar, "--session-id", session_id,
                         "--activation", "fake-pi", "--shell", shell, "--handoff-wait-ms", "0"],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, start_new_session=True)
ready = json.loads(proc.stdout.readline())
assert ready["type"] == "ready", ready
proc.stdin.write((json.dumps({"v": 1, "id": 1, "op": "spawn", "args": {"label": "victim", "command": command, "cwd": "/", "notify": True}}) + "\n").encode())
proc.stdin.flush()
while True:
    msg = json.loads(proc.stdout.readline())
    if msg.get("type") == "reply":
        break
print(json.dumps({"supervisorPid": ready["pid"], "task": msg["result"]["task"]}), flush=True)
while True:
    time.sleep(60)
