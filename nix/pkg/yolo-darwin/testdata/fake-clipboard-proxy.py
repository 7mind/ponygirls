import os
import socket
import sys
from pathlib import Path

mode, *args = sys.argv[1:]
if mode == "client":
    assert args == ["probe"]
    with socket.socket(socket.AF_UNIX) as client:
        client.connect(os.environ["YOLO_CLIPBOARD_SOCK"])
        assert client.recv(2) == b"ok"
else:
    assert mode == "broker" and args[0] == "--listen"
    assert ("--tmux-pane" in args) == ("--tmux-server-pid" in args)
    Path(os.environ["FAKE_BROKER_ARGS"]).write_text("\n".join(args) + "\n")
    with socket.socket(socket.AF_UNIX) as listener:
        listener.bind(args[1])
        listener.listen()
        while True:
            conn, _ = listener.accept()
            with conn:
                conn.sendall(b"ok")
