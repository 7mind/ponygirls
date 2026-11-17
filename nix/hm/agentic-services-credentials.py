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
import tempfile


PBKDF2_ITERATIONS = 600000
PBKDF2_MAX_ITERATIONS = 2000000
PBKDF2_SALT_BYTES = 16
PBKDF2_KEY_BYTES = 32
MAX_CREDENTIAL_FILE_BYTES = 128
PBKDF2_PATTERN = r"pbkdf2-sha256\$[0-9]{6,7}\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}="
ACCOUNTS_KEY_BYTES = 32
# Canonical unpadded base64url of exactly 32 bytes (the last symbol carries 4 bits).
ACCOUNTS_KEY_PATTERN = r"[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]"


def password_hash_parts(encoded: str) -> tuple[int, bytes, bytes]:
    if re.fullmatch(PBKDF2_PATTERN, encoded) is None:
        raise ValueError("invalid password hash")
    _, rounds_text, salt_text, key_text = encoded.split("$")
    rounds = int(rounds_text)
    salt, key = (base64.b64decode(value, validate=True) for value in (salt_text, key_text))
    if (not PBKDF2_ITERATIONS <= rounds <= PBKDF2_MAX_ITERATIONS
            or str(rounds) != rounds_text
            or len(salt) != PBKDF2_SALT_BYTES or len(key) != PBKDF2_KEY_BYTES
            or base64.b64encode(salt).decode() != salt_text
            or base64.b64encode(key).decode() != key_text):
        raise ValueError("invalid password hash")
    return rounds, salt, key


def password_hash(password: str) -> str:
    salt = secrets.token_bytes(PBKDF2_SALT_BYTES)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS, dklen=PBKDF2_KEY_BYTES)
    return "$".join(("pbkdf2-sha256", str(PBKDF2_ITERATIONS),
                     base64.b64encode(salt).decode(), base64.b64encode(key).decode()))


def read_operator_password_hash(path: Path) -> None:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise ValueError("not a regular file")
            encoded = source.read(MAX_CREDENTIAL_FILE_BYTES + 1).removesuffix(b"\n").decode("ascii")
        password_hash_parts(encoded)
    except (OSError, ValueError):
        raise RuntimeError("invalid operator password hash source") from None


def random_urlsafe(size: int) -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(size)).rstrip(b"=").decode()


def publish(directory: Path, name: str, value: str) -> None:
    # Complete the private file first, then link it into place: readers never see
    # a partial credential, and an existing (concurrently published) one is kept.
    fd, temporary = tempfile.mkstemp(prefix=f".{name}.", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w") as output:
            output.write(value + "\n")
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, directory / name)
        except FileExistsError:
            pass
    finally:
        os.unlink(temporary)


def ensure(directory: Path, name: str, pattern: str, generate: Callable[[], str]) -> str:
    path = directory / name
    if not os.path.lexists(path):
        publish(directory, name, generate())
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid():
        raise RuntimeError(f"invalid credential file: {name}")
    try:
        with path.open("rb") as source:
            raw = source.read(MAX_CREDENTIAL_FILE_BYTES + 1).decode("ascii")
            value = raw.replace("\r\n", "\n").replace("\r", "\n").removesuffix("\n")
    except UnicodeDecodeError:
        raise RuntimeError(f"invalid credential encoding: {name}") from None
    if re.fullmatch(pattern, value) is None:
        raise RuntimeError(f"invalid credential encoding: {name}")
    path.chmod(0o600)
    return value


def provision_accounts_key(directory: Path, service: str) -> None:
    ensure(directory, f"{service}-accounts.key", ACCOUNTS_KEY_PATTERN, lambda: random_urlsafe(ACCOUNTS_KEY_BYTES))


def provision(directory: Path, haystack_agent_file: Path | None, manure_agent_file: Path | None,
              haystack_operator_hash_file: Path | None, manure_operator_hash_file: Path | None) -> None:
    agent_tokens: list[tuple[str, str, bool]] = []
    for service, source, operator_hash in (("haystack", haystack_agent_file, haystack_operator_hash_file),
                                           ("manure", manure_agent_file, manure_operator_hash_file)):
        if source is None:
            continue
        token = source.read_text().removesuffix("\n")
        if re.fullmatch(r"[A-Za-z0-9_-]{43}", token) is None:
            raise RuntimeError("invalid agent token source")
        if operator_hash is not None:
            read_operator_password_hash(operator_hash)
        agent_tokens.append((service, token, operator_hash is None))
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    metadata = directory.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid():
        raise RuntimeError("credential directory must be a directory owned by this user")
    directory.chmod(0o700)

    for service, agent_token, derive_operator_password in agent_tokens:
        for identity in ("agent", "operator"):
            name = f"{service}-{identity}"
            token = ensure(directory, name + ".token", r"[A-Za-z0-9_-]{43}",
                           lambda: agent_token if identity == "agent" else random_urlsafe(32))
            if identity == "agent" and token != agent_token:
                raise RuntimeError(f"agent token source mismatch: {service}; refusing rotation")
            digest = hashlib.sha256(token.encode()).hexdigest()
            stored = ensure(directory, name + ".sha256", r"[0-9a-f]{64}", lambda: digest)
            if stored != digest:
                raise RuntimeError(f"credential digest mismatch: {name}")
            if identity == "operator" and derive_operator_password:
                encoded = ensure(directory, name + ".pbkdf2", PBKDF2_PATTERN, lambda: password_hash(token))
                try:
                    rounds, salt, key = password_hash_parts(encoded)
                except ValueError:
                    raise RuntimeError(f"invalid credential encoding: {name}.pbkdf2") from None
                derived = hashlib.pbkdf2_hmac("sha256", token.encode(), salt, rounds, dklen=PBKDF2_KEY_BYTES)
                if not secrets.compare_digest(derived, key):
                    raise RuntimeError(f"operator password hash mismatch: {service}; refusing rotation")
    for name in ("redis-password", "searx-secret"):
        ensure(directory, name, r"[0-9a-f]{64}", lambda: secrets.token_hex(32))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    parser.add_argument("--haystack-agent-file", type=Path)
    parser.add_argument("--manure-agent-file", type=Path)
    parser.add_argument("--haystack-operator-password-hash-file", type=Path)
    parser.add_argument("--manure-operator-password-hash-file", type=Path)
    parser.add_argument("--haystack-accounts-key", action="store_true")
    parser.add_argument("--manure-accounts-key", action="store_true")
    args = parser.parse_args()
    provision(args.directory, args.haystack_agent_file, args.manure_agent_file,
              args.haystack_operator_password_hash_file, args.manure_operator_password_hash_file)
    for service, requested in (("haystack", args.haystack_accounts_key), ("manure", args.manure_accounts_key)):
        if requested:
            provision_accounts_key(args.directory, service)
