import argparse
import json
import os
import re
import subprocess
from collections.abc import Mapping
from dataclasses import asdict, dataclass


CONTEXT_ENVIRONMENT_VARIABLE = "SMIND_TMUX_PANE_CONTEXT"
TMUX_QUERY_TIMEOUT_SECONDS = 1
PANE_TITLE_PREVIEW_LENGTH = 160


@dataclass(frozen=True)
class TmuxPane:
    index: int
    title: str

    def __post_init__(self):
        if type(self.index) is not int or self.index < 0:
            raise ValueError("tmux pane index must be a nonnegative integer")
        if not isinstance(self.title, str):
            raise ValueError("tmux pane title must be a string")
        title = "".join(character if character.isprintable() else " " for character in self.title)
        object.__setattr__(self, "title", " ".join(title.split())[:PANE_TITLE_PREVIEW_LENGTH])


def capture_pane(environment: Mapping[str, str], tmux_command: str) -> TmuxPane | None:
    target = environment.get("TMUX_PANE", "")
    socket = environment.get("TMUX", "").partition(",")[0]
    if not re.fullmatch(r"%[0-9]+", target) or not socket.startswith("/"):
        return None
    try:
        result = subprocess.run(
            [tmux_command, "-N", "-S", socket, "display-message", "-p", "-t", target,
             "#{pane_id}|#{pane_index}|#{pane_title}"],
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
    return TmuxPane(int(parts[1]), parts[2])


def notification_pane(environment: Mapping[str, str], tmux_command: str) -> TmuxPane | None:
    snapshot = environment.get(CONTEXT_ENVIRONMENT_VARIABLE)
    if snapshot is not None:
        try:
            value = json.loads(snapshot)
        except (ValueError, TypeError):
            raise ValueError("Invalid captured tmux pane context") from None
        if value is None:
            return None
        if not isinstance(value, dict) or set(value) != {"index", "title"}:
            raise ValueError("Invalid captured tmux pane context fields")
        return TmuxPane(value["index"], value["title"])
    if environment.get("SMIND_SANDBOXED") == "1":
        return None
    return capture_pane(environment, tmux_command)


def main():
    parser = argparse.ArgumentParser(description="Capture the originating tmux pane labels without exposing its socket")
    parser.add_argument("--tmux", required=True)
    arguments = parser.parse_args()
    pane = capture_pane(os.environ, arguments.tmux)
    print(json.dumps(None if pane is None else asdict(pane)))


if __name__ == "__main__":
    main()
