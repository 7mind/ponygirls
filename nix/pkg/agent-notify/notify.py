import argparse
import hashlib
import json
import os
import socket
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol


REQUEST_TIMEOUT_SECONDS = 10
UUID_TEXT_LENGTH = 36
UUID_PREVIEW_LENGTH = 8
SESSION_PREVIEW_LENGTH = 64


@dataclass(frozen=True)
class Turn:
    harness: str
    session: str
    turn: str
    message: str = ""
    workdir: str = ""

    def key(self) -> str:
        identity = json.dumps([self.harness, self.session, self.turn])
        return hashlib.sha256(identity.encode()).hexdigest()


class TurnStore(Protocol):
    def begin(self, key: str, started: float) -> None: ...
    def finish(self, key: str) -> float | None: ...


class Sender(Protocol):
    def send(self, body: str) -> None: ...


class FileTurnStore:
    def __init__(self, directory: Path):
        self.directory = directory
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)

    def begin(self, key: str, started: float) -> None:
        descriptor, name = tempfile.mkstemp(dir=self.directory)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(str(started))
        os.replace(name, self.directory / key)

    def finish(self, key: str) -> float | None:
        descriptor, name = tempfile.mkstemp(dir=self.directory)
        os.close(descriptor)
        claimed = Path(name)
        try:
            try:
                os.replace(self.directory / key, claimed)
            except FileNotFoundError:
                return None
            return float(claimed.read_text())
        finally:
            claimed.unlink()


class MatrixSender:
    def __init__(self, homeserver: str, room: str, token_file: Path):
        self.homeserver = homeserver.rstrip("/")
        self.room = urllib.parse.quote(room, safe="")
        self.token_file = token_file

    def send(self, body: str) -> None:
        token = self.token_file.read_text().strip()
        if not token:
            raise ValueError("Matrix token file is empty")
        transaction = f"{time.time_ns()}-{os.getpid()}"
        url = f"{self.homeserver}/_matrix/client/v3/rooms/{self.room}/send/m.room.message/{transaction}"
        payload = json.dumps({"msgtype": "m.text", "body": body}).encode()
        request = urllib.request.Request(url, data=payload, method="PUT", headers={
            "Authorization": f"Bearer {token}", "Content-Type": "application/json",
        })
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            response.read()


class Notifier:
    def __init__(self, store: TurnStore, sender: Sender, now: Callable[[], float],
                 minimum_seconds: int, show_message: bool = False,
                 show_workdir: bool = False, show_hostname: bool = False):
        self.store = store
        self.sender = sender
        self.now = now
        self.minimum_seconds = minimum_seconds
        self.show_message = show_message
        self.show_workdir = show_workdir
        self.show_hostname = show_hostname

    def handle(self, action: str, turn: Turn) -> bool:
        if action == "start":
            self.store.begin(turn.key(), self.now())
            return False
        if action == "complete":
            started = self.store.finish(turn.key())
            if started is None:
                print("agent-notify-matrix: missing turn start; completion suppressed", file=sys.stderr)
                return False
            elapsed = self.now() - started
            if elapsed < 0:
                raise ValueError("turn start is from a different clock epoch")
            if elapsed < self.minimum_seconds:
                return False
        elif action != "attention":
            raise ValueError(f"unsupported notification action: {action}")
        label = "turn complete" if action == "complete" else "input needed"
        session = turn.session[:UUID_PREVIEW_LENGTH] if len(turn.session) == UUID_TEXT_LENGTH else turn.session[:SESSION_PREVIEW_LENGTH]
        body = f"agent: {label} [{turn.harness}] {session}"
        if self.show_workdir and turn.workdir:
            body = f"{body} @ {turn.workdir}"
        if self.show_hostname:
            body = f"{body} on {socket.gethostname()}"
        if self.show_message and turn.message:
            body = f"{body}: {turn.message[:200]}"
        self.sender.send(body)
        return True


def text_field(payload: dict[str, object], names: tuple[str, ...]) -> str:
    for name in names:
        value = payload.get(name)
        if value is not None:
            if not isinstance(value, str):
                raise ValueError(f"{name} must be a string")
            return value
    return ""


def parse_turn(harness: str, payload: str) -> Turn:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        raise ValueError(f"notification payload must be a JSON object with a session identifier, got: {payload[:80]!r}")
    if not isinstance(data, dict):
        raise ValueError("notification payload must be a JSON object")
    session = text_field(data, ("session_id", "sessionId", "thread_id", "thread-id"))
    if not session:
        raise ValueError("notification payload has no session identifier")
    return Turn(
        harness,
        session,
        text_field(data, ("turn_id", "turn-id")),
        text_field(data, ("message", "title", "last-assistant-message")),
        text_field(data, ("cwd",)),
    )


def make_sender(configuration: dict[str, object]):
    if configuration.get("transport", "plaintext") == "e2ee":
        from matrix_e2ee import NioMatrixSender
        return NioMatrixSender(
            str(configuration["homeserver"]),
            str(configuration["roomId"]),
            configuration.get("sender"),
            configuration.get("passwordFile"),
        )
    token_file = configuration.get("tokenFile")
    if not isinstance(token_file, str):
        raise ValueError("plaintext transport needs tokenFile set")
    return MatrixSender(configuration["homeserver"], configuration["roomId"], Path(token_file))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Send coding-agent turn notifications to Matrix.",
        epilog="Provision once per host: agent-notify-matrix CONFIG --setup. "
               "Manual test ping: agent-notify-matrix CONFIG "
               "pi --attention PAYLOAD, where PAYLOAD is hook JSON with a session_id.",
    )
    parser.add_argument("config", type=Path, help="JSON file with homeserver, roomId, and transport settings")
    parser.add_argument("harness", nargs="?", choices=("claude", "codex", "pi"),
                        help="Agent harness name. Required except with --setup.")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--start", action="store_true", help="Record a turn start for completion throttling")
    actions.add_argument("--attention", action="store_true", help="Notify immediately that input is needed")
    actions.add_argument("--setup", action="store_true", help="Provision this host for e2ee transport")
    parser.add_argument("payload", nargs="?", help="Hook JSON payload, or read from stdin when absent")
    arguments = parser.parse_args()
    if arguments.harness is None and not arguments.setup:
        parser.error("harness is required without --setup")
    configuration = json.loads(arguments.config.read_text())
    if arguments.setup:
        if configuration.get("transport", "plaintext") != "e2ee":
            raise ValueError("--setup requires e2ee transport")
        make_sender(configuration).setup()
        return
    cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path(os.environ["HOME"]) / ".cache")))
    store = FileTurnStore(cache / "ponygirls-notify" / "turns")
    sender = make_sender(configuration)
    notifier = Notifier(
        store, sender, time.monotonic, configuration["minTurnSeconds"],
        show_message=configuration.get("includeMessageBody", False),
        show_workdir=configuration.get("includeWorkdir", False),
        show_hostname=configuration.get("includeHostname", False),
    )
    if arguments.payload is None and sys.stdin.isatty():
        raise ValueError("no payload given and stdin is a terminal; pass hook JSON as the payload argument")
    payload = arguments.payload if arguments.payload is not None else sys.stdin.read()
    turn = parse_turn(arguments.harness, payload)
    action = "start" if arguments.start else "attention" if arguments.attention else "complete"
    notifier.handle(action, turn)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(f"agent-notify-matrix: {error}", file=sys.stderr)
        sys.exit(1)
