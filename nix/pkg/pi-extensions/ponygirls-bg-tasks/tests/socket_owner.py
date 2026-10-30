"""Fake extension owner killed while its supervisor is between connections."""
import json
import time
import sys

from reconnect_test import SocketClient

if __name__ == "__main__":
    client = SocketClient(sys.argv[1])
    task = client.spawn("echo started; sleep 300")
    client.detach()
    print(json.dumps({"supervisorPid": client.proc.pid, "task": task}), flush=True)
    while True:
        time.sleep(60)
