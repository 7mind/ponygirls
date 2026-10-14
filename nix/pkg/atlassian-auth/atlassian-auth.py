#!/usr/bin/env python3
import base64
from pathlib import Path
import sys


def authorization(email: str, token_file: Path) -> str:
    if not email or any(ord(char) <= 32 or ord(char) >= 127 or char == ":" for char in email):
        raise ValueError("email must be nonempty ASCII without whitespace or colons")
    token = token_file.read_bytes()
    if token.endswith(b"\n"):
        token = token[:-1]
    if not token or any(byte <= 32 or byte >= 127 for byte in token):
        raise ValueError("token must be nonempty printable ASCII with at most one final LF")
    encoded = base64.b64encode(email.encode("ascii") + b":" + token).decode("ascii")
    return "Basic " + encoded


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: atlassian-auth EMAIL TOKEN_FILE", file=sys.stderr)
        return 64
    try:
        header = authorization(sys.argv[1], Path(sys.argv[2]))
    except OSError:
        print("atlassian-auth: token file could not be read", file=sys.stderr)
        return 3
    except ValueError as error:
        print(f"atlassian-auth: {error}", file=sys.stderr)
        return 3
    print(header)
    return 0


if __name__ == "__main__":
    sys.exit(main())
