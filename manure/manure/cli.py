"""manure CLI (contract v0.2 §9, client-owned). Stdlib only."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from manure import client as _client_mod
from manure.client import (
    AmbiguousCredentials,
    ManureError,
    parse_expires_in,
    read_token_file,
    resolve_secret_pair,
    strip_secret_value,
)


def _eprint(msg: str) -> None:
    print(msg, file=sys.stderr)


def _resolve_api_base() -> str | None:
    direct = os.environ.get("MANURE_URL")
    fpath = os.environ.get("MANURE_URL_FILE")
    fpath_s = strip_secret_value(fpath) if fpath is not None else None
    # normalize empty file path as unset
    if fpath is not None and fpath_s is None:
        fpath = None
    else:
        fpath = fpath_s
    try:
        return resolve_secret_pair(direct, fpath, kind="url")
    except AmbiguousCredentials:
        raise


def _resolve_token() -> str | None:
    direct = os.environ.get("MANURE_TOKEN")
    fpath = os.environ.get("MANURE_TOKEN_FILE")
    fpath_s = strip_secret_value(fpath) if fpath is not None else None
    if fpath is not None and fpath_s is None:
        fpath = None
    else:
        fpath = fpath_s
    return resolve_secret_pair(direct, fpath, kind="token")


def _resolve_password_cli(flag_pw: str | None, flag_file: str | None) -> str | None:
    from manure.client import _exact_credential
    cands: list[tuple[str, str | None, bool]] = []
    # Direct password values are exact (canonical, no stripping); file paths
    # use strip-emptiness only for presence detection (governor A1).
    if flag_pw is not None and flag_pw != "":
        _exact_credential(flag_pw)
        cands.append(("flag", flag_pw, False))
    if flag_file is not None and strip_secret_value(flag_file) is not None:
        cands.append(("flag-file", strip_secret_value(flag_file), True))
    env_direct = os.environ.get("MANURE_EXTERNAL_PASSWORD")
    env_file = os.environ.get("MANURE_EXTERNAL_PASSWORD_FILE")
    env_file_s = strip_secret_value(env_file) if env_file is not None else None
    if env_file is not None and env_file_s is None:
        env_file = None
    else:
        env_file = env_file_s
    if env_direct is not None and env_direct != "":
        _exact_credential(env_direct)
        cands.append(("env", env_direct, False))
    if env_file is not None:
        cands.append(("env-file", env_file, True))
    if len(cands) > 1:
        raise AmbiguousCredentials("multiple password sources set")
    if not cands:
        return None
    label, val, is_file = cands[0]
    if is_file:
        # password files share the token exact-byte codec (43-char base64url)
        return read_token_file(val or "")
    return val


def _resolve_cache_dir(flag: str | None) -> Path:
    if flag is not None and strip_secret_value(flag) is not None:
        return Path(strip_secret_value(flag) or "")
    env = os.environ.get("MANURE_CACHE_DIR")
    env_s = strip_secret_value(env) if env is not None else None
    if env_s is not None:
        return Path(env_s)
    return Path.home() / ".cache" / "manure"


def _print_result(obj: Any, as_json: bool) -> None:
    if as_json:
        print(json.dumps(obj, sort_keys=True, indent=2))
    else:
        if isinstance(obj, dict):
            for k in sorted(obj.keys()):
                print(f"{k}: {obj[k]}")
        else:
            print(str(obj))


def _exit_for_error(e: ManureError) -> int:
    if e.code in ("ambiguous-credentials", "missing-credentials", "source-changed",
                  "invalid-ttl", "invalid-visibility", "invalid-manifest",
                  "invalid-path", "invalid-url", "bad-envelope"):
        # bad-envelope from client-side validation is usage; server bad-envelope also 2?
        # Keep 2 for validation class; server faults like not-found/unauthorized -> 1.
        if e.code in ("ambiguous-credentials", "missing-credentials", "source-changed",
                      "invalid-ttl", "invalid-visibility", "invalid-manifest",
                      "invalid-path", "invalid-url"):
            return 2
    if e.code in ("ambiguous-credentials", "missing-credentials", "source-changed",
                  "invalid-ttl", "invalid-visibility", "invalid-manifest",
                  "invalid-path", "invalid-url", "bad-envelope"):
        # bad-envelope from user input (bad id) is usage
        if e.code == "bad-envelope":
            return 2
    return 1


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="manure")
    ap.add_argument("--cache-dir", default=None, help="upload-session cache dir")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_list = sub.add_parser("list")
    p_list.add_argument("--limit", type=int, default=None)
    p_list.add_argument("--cursor", default=None)
    p_list.add_argument("--include-expired", action="store_true")
    p_list.add_argument("--visibility", default=None)
    p_list.add_argument("--state", default=None)
    p_list.add_argument("--json", action="store_true")
    p_info = sub.add_parser("info")
    p_info.add_argument("id")
    p_info.add_argument("--json", action="store_true")
    p_up = sub.add_parser("upload")
    p_up.add_argument("path")
    p_up.add_argument("--name", default=None)
    p_up.add_argument("--access", default=None)
    p_up.add_argument("--expires-in", default=None)
    p_up.add_argument("--resume", default=None)
    p_up.add_argument("--fresh", action="store_true")
    p_up.add_argument("--json", action="store_true")
    p_fetch = sub.add_parser("fetch")
    p_fetch.add_argument("id_or_url")
    p_fetch.add_argument("dest")
    p_fetch.add_argument("--password", default=None)
    p_fetch.add_argument("--password-file", default=None)
    p_fetch.add_argument("--json", action="store_true")
    p_del = sub.add_parser("delete")
    p_del.add_argument("id")
    p_rot = sub.add_parser("rotate-password")
    p_rot.add_argument("id")
    p_rot.add_argument("--json", action="store_true")
    p_who = sub.add_parser("whoami")
    p_who.add_argument("--json", action="store_true")
    return ap


def main(argv: list[str] | None = None) -> int:
    ap = build_parser()
    try:
        args = ap.parse_args(argv)
    except SystemExit as e:
        return int(e.code or 0)
    cache_dir = _resolve_cache_dir(getattr(args, "cache_dir", None))
    # Resolve credentials before network; ambiguity -> exit 2 no-network
    try:
        api_base = _resolve_api_base()
        token = _resolve_token()
    except AmbiguousCredentials as e:
        _eprint(f"ambiguous-credentials: {e.message}")
        return 2
    except ManureError as e:
        _eprint(f"{e.code}: {e.message}")
        return 2
    except OSError:
        _eprint("unavailable: local error")
        return 1
    except Exception:
        _eprint("unavailable: unexpected error")
        return 1
    cmd = args.cmd
    as_json = bool(getattr(args, "json", False))
    try:
        if cmd == "fetch":
            # password sources (flag/file/env) with ambiguity check before network
            try:
                password = _resolve_password_cli(getattr(args, "password", None),
                                                 getattr(args, "password_file", None))
            except AmbiguousCredentials as e:
                _eprint(f"ambiguous-credentials: {e.message}")
                return 2
            except ManureError as e:
                _eprint(f"{e.code}: {e.message}")
                return 2
            id_or_url: str = args.id_or_url
            is_url = "://" in id_or_url
            if not is_url and api_base is None:
                _eprint("missing-credentials: MANURE_URL is required")
                return 2
            # content-URL fetch needs no api_base/token; id fetch needs api_base
            effective_base = api_base if api_base is not None else "http://127.0.0.1:9"
            try:
                client = _client_mod.ManureClient(effective_base, token=token, cache_dir=cache_dir)
            except AmbiguousCredentials as e:
                _eprint(f"ambiguous-credentials: {e.message}")
                return 2
            except ManureError as e:
                _eprint(f"{e.code}: {e.message}")
                return _exit_for_error(e)
            try:
                res = client.fetch_to_dest(id_or_url, args.dest, password=password)
            except ManureError as e:
                _eprint(f"{e.code}: {e.message}")
                return _exit_for_error(e)
            _print_result(res, as_json)
            return 0
        # all other commands require api_base + token
        if api_base is None or token is None:
            _eprint("missing-credentials: MANURE_URL and MANURE_TOKEN are required")
            return 2
        try:
            client = _client_mod.ManureClient(api_base, token=token, cache_dir=cache_dir)
        except ManureError as e:
            _eprint(f"{e.code}: {e.message}")
            return _exit_for_error(e)
        if cmd == "whoami":
            res = client.whoami()
            _print_result(res, as_json)
            return 0
        if cmd == "list":
            res = client.list_artifacts(limit=args.limit, cursor=args.cursor,
                                        include_expired=bool(args.include_expired),
                                        visibility=args.visibility, state=args.state)
            _print_result(res, as_json)
            return 0
        if cmd == "info":
            res = client.get_artifact(args.id)
            _print_result(res, as_json)
            return 0
        if cmd == "delete":
            res = client.delete(args.id)
            _print_result(res, True if as_json else False)
            return 0
        if cmd == "rotate-password":
            res = client.rotate_password(args.id)
            _print_result(res, as_json)
            return 0
        if cmd == "upload":
            if not args.access:
                _eprint("missing --access (internal|external|public)")
                return 2
            if args.access not in ("internal", "external", "public"):
                _eprint("invalid-visibility: --access must be internal|external|public")
                return 2
            try:
                exp = parse_expires_in(args.expires_in) if args.expires_in is not None else None
            except ManureError as e:
                _eprint(f"{e.code}: {e.message}")
                return 2
            res = client.upload_path(args.path, access=args.access, name=args.name,
                                     expires_in_s=exp, resume_id=args.resume,
                                     fresh=bool(args.fresh))
            _print_result(res, as_json)
            return 0
    except ManureError as e:
        # Sanitized: codes/messages never carry secret material (B7).
        _eprint(f"{e.code}: {e.message}")
        return _exit_for_error(e)
    except OSError:
        _eprint("unavailable: local error")
        return 1
    except Exception:
        _eprint("unavailable: unexpected error")
        return 1
    _eprint("unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
