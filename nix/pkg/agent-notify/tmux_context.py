import os
import re
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


TMUX_QUERY_TIMEOUT_SECONDS = 1
WINDOW_NAME_PREVIEW_LENGTH = 160
WINDOW_QUERY_FORMAT = Path(__file__).with_name("tmux-window-format.txt").read_text(encoding="utf-8").removesuffix("\n")


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


def notification_window(environment: Mapping[str, str], tmux_command: str) -> TmuxWindow | None:
    if environment.get("SMIND_SANDBOXED") == "1":
        tmux_command = environment.get("SMIND_TMUX_COMMAND", "")
        if not os.path.isabs(tmux_command):
            return None
    target = environment.get("TMUX_PANE", "")
    socket = environment.get("TMUX", "").partition(",")[0]
    if not re.fullmatch(r"%[0-9]+", target) or not socket.startswith("/"):
        return None
    try:
        result = subprocess.run(
            [tmux_command, "-N", "-S", socket, "display-message", "-p", "-t", target,
             WINDOW_QUERY_FORMAT],
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
    try:
        index = int(parts[1])
    except ValueError:
        return None
    return TmuxWindow(index, parts[2])
