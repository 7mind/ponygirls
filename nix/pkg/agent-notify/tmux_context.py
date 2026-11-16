import argparse
import json
import os
import re
import subprocess
from collections.abc import Mapping
from dataclasses import asdict, dataclass


CONTEXT_ENVIRONMENT_VARIABLE = "SMIND_TMUX_WINDOW_CONTEXT"
TMUX_QUERY_TIMEOUT_SECONDS = 1
WINDOW_NAME_PREVIEW_LENGTH = 160


@dataclass(frozen=True)
class TmuxWindow:
    index: int
    name: str

    def __post_init__(self):
        if type(self.index) is not int or self.index < 0:
            raise ValueError("tmux window index must be a nonnegative integer")
        if not isinstance(self.name, str):
            raise ValueError("tmux window name must be a string")
        name = "".join(character if character.isprintable() else " " for character in self.name)
        object.__setattr__(self, "name", " ".join(name.split())[:WINDOW_NAME_PREVIEW_LENGTH])


def capture_window(environment: Mapping[str, str], tmux_command: str) -> TmuxWindow | None:
    target = environment.get("TMUX_PANE", "")
    socket = environment.get("TMUX", "").partition(",")[0]
    if not re.fullmatch(r"%[0-9]+", target) or not socket.startswith("/"):
        return None
    try:
        result = subprocess.run(
            [tmux_command, "-N", "-S", socket, "display-message", "-p", "-t", target,
             "#{pane_id}|#{window_index}|#{window_name}"],
            env=dict(environment), capture_output=True, encoding="utf-8",
            timeout=TMUX_QUERY_TIMEOUT_SECONDS, check=False,
        )
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        return None
    if result.returncode != 0:
        return None
    parts = result.stdout.rstrip("\n").split("|", 2)
    if len(parts) != 3 or parts[0] != target or not re.fullmatch(r"[0-9]+", parts[1]):
        return None
    return TmuxWindow(int(parts[1]), parts[2])


def notification_window(environment: Mapping[str, str], tmux_command: str) -> TmuxWindow | None:
    snapshot = environment.get(CONTEXT_ENVIRONMENT_VARIABLE)
    if snapshot is not None:
        try:
            value = json.loads(snapshot)
        except (ValueError, TypeError):
            raise ValueError("Invalid captured tmux window context") from None
        if value is None:
            return None
        if not isinstance(value, dict) or set(value) != {"index", "name"}:
            raise ValueError("Invalid captured tmux window context fields")
        return TmuxWindow(value["index"], value["name"])
    if environment.get("SMIND_SANDBOXED") == "1":
        return None
    return capture_window(environment, tmux_command)


def main():
    parser = argparse.ArgumentParser(description="Capture the originating tmux window labels without exposing its socket")
    parser.add_argument("--tmux", required=True)
    arguments = parser.parse_args()
    window = capture_window(os.environ, arguments.tmux)
    print(json.dumps(None if window is None else asdict(window)))


if __name__ == "__main__":
    main()
