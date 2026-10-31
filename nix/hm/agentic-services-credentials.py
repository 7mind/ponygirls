#!/usr/bin/env python3
import argparse
import base64
from collections.abc import Callable
import hashlib
import os
from pathlib import Path
import re
import secrets
import stat


def provision(directory: Path, haystack_agent_file: Path | None, manure_agent_file: Path | None) -> None:
    agent_tokens: list[tuple[str, str]] = []
    for service, source in (("haystack", haystack_agent_file), ("manure", manure_agent_file)):
        if source is None:
            continue
        token = source.read_text().removesuffix("\n")
        if re.fullmatch(r"[A-Za-z0-9_-]{43}", token) is None:
            raise RuntimeError("invalid agent token source")
        agent_tokens.append((service, token))
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    metadata = directory.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid():
        raise RuntimeError("credential directory must be a directory owned by this user")
    directory.chmod(0o700)

    def ensure(name: str, pattern: str, generate: Callable[[], str]) -> str:
        path = directory / name
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except FileExistsError:
            metadata = path.lstat()
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
                raise RuntimeError(f"invalid credential file: {name}")
        else:
            with os.fdopen(fd, "w") as output:
                output.write(generate() + "\n")
        value = path.read_text().removesuffix("\n")
        if re.fullmatch(pattern, value) is None:
            raise RuntimeError(f"invalid credential encoding: {name}")
        path.chmod(0o600)
        return value

    for service, agent_token in agent_tokens:
        for identity in ("agent", "operator"):
            name = f"{service}-{identity}"
            token = ensure(name + ".token", r"[A-Za-z0-9_-]{43}",
                           lambda: agent_token if identity == "agent" else
                           base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode())
            if identity == "agent" and token != agent_token:
                raise RuntimeError(f"agent token source mismatch: {service}; refusing rotation")
            digest = hashlib.sha256(token.encode()).hexdigest()
            stored = ensure(name + ".sha256", r"[0-9a-f]{64}", lambda: digest)
            if stored != digest:
                raise RuntimeError(f"credential digest mismatch: {name}")
    for name in ("redis-password", "searx-secret"):
        ensure(name, r"[0-9a-f]{64}", lambda: secrets.token_hex(32))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--haystack-agent-file", type=Path)
    parser.add_argument("--manure-agent-file", type=Path)
    args = parser.parse_args()
    provision(args.directory, args.haystack_agent_file, args.manure_agent_file)
