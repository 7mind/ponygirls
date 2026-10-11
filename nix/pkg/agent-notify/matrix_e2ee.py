import asyncio
import getpass
import json
import os
import socket
from pathlib import Path


def device_id():
    host = socket.gethostname().lower()
    clean = "".join(c if c.isalnum() or c == "-" else "-" for c in host)[:32]
    return f"agent-notify-{clean}"


def state_dir():
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "agent-notify-matrix"


class NioMatrixSender:
    def __init__(self, homeserver, room, sender=None, password_file=None):
        self.homeserver = homeserver.rstrip("/")
        self.room = room
        self.sender = sender
        self.password_file = Path(password_file) if password_file else None

    def setup(self, password=None):
        from nio import AsyncClient, LoginResponse
        store = state_dir()
        store.mkdir(mode=0o700, parents=True, exist_ok=True)
        sender = self.sender or input("Matrix user ID: ")
        if not password:
            if self.password_file is not None:
                try:
                    password = self.password_file.read_text().strip()
                except OSError as error:
                    raise ValueError(f"cannot read password file: {error}")
            if not password:
                try:
                    password = getpass.getpass("Matrix password: ")
                except EOFError:
                    raise ValueError("no password provided")
        if not password:
            raise ValueError("no password provided")
        dev = device_id()

        async def run():
            client = AsyncClient(self.homeserver, sender, device_id=dev, store_path=str(store))
            resp = await client.login(password, device_name=dev)
            if not isinstance(resp, LoginResponse):
                raise ValueError(f"login failed: {resp}")
            session = store / "session.json"
            session.write_text(json.dumps({
                "user_id": resp.user_id,
                "device_id": resp.device_id,
                "access_token": resp.access_token,
            }))
            os.chmod(session, 0o600)
            await client.sync(timeout=15000)
            if client.should_upload_keys:
                await client.keys_upload()
            await client.close()
            print(f"provisioned {resp.user_id} device {resp.device_id}")
            print(f"key store: {store}")
            print("verify this device in Element, then send a test ping")
            return resp

        return asyncio.run(run())

    def send(self, body):
        try:
            state = json.loads((state_dir() / "session.json").read_text())
            user_id, dev, token = state["user_id"], state["device_id"], state["access_token"]
        except (OSError, ValueError, KeyError) as error:
            raise ValueError(f"not provisioned, run agent-notify-matrix --setup: {error}")
        from nio import AsyncClient

        async def run():
            store = str(state_dir())
            client = AsyncClient(self.homeserver, store_path=store)
            client.restore_login(user_id, dev, token)
            await client.sync(timeout=15000)
            if client.should_upload_keys:
                await client.keys_upload()
            await client.room_send(
                self.room,
                "m.room.message",
                {"msgtype": "m.text", "body": body},
                ignore_unverified_devices=True,
            )
            await client.close()

        asyncio.run(run())
