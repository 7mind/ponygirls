"""manure CLI (contract v0.2 §9, client-owned). Stdlib only."""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import TextIO, cast

from manure import cli_output
from manure import client as _client_mod
from manure.client import (
    AmbiguousCredentials,
    ManureError,
    parse_expires_in,
    read_token_file,
    resolve_secret_pair,
    strip_secret_value,
)


def _eprint(msg: str, presentation: cli_output.Presentation) -> None:
    print(presentation.error(msg), file=sys.stderr)


@dataclass(frozen=True)
class _OutputOptions:
    color: cli_output.ColorMode
    as_json: bool


def _output_options(argv: list[str]) -> _OutputOptions:
    # Help/errors can exit during parsing. Inspect exact output switches first,
    # but never interpret anything after the end-of-options delimiter as a flag.
    mode: cli_output.ColorMode = 'auto'
    as_json = False
    for index, value in enumerate(argv):
        if value == '--':
            break
        if value == '--json':
            as_json = True
        if value == '--color' and index + 1 < len(argv):
            candidate = argv[index + 1]
        elif value.startswith('--color='):
            candidate = value.partition('=')[2]
        else:
            continue
        if candidate in ('auto', 'always', 'never'):
            mode = cast(cli_output.ColorMode, candidate)
    return _OutputOptions(mode, as_json)


class _ArgumentParser(argparse.ArgumentParser):
    def __init__(self, *args, stdout_presentation: cli_output.Presentation,
                 stderr_presentation: cli_output.Presentation, **kwargs):
        super().__init__(*args, **kwargs)
        # Python 3.14 argparse has its own environment/TTY color policy.
        self.color = False
        self.allow_abbrev = False
        self.stdout_presentation = stdout_presentation
        self.stderr_presentation = stderr_presentation

    def _presentation(self, file: TextIO) -> cli_output.Presentation:
        return self.stderr_presentation if file is sys.stderr else self.stdout_presentation

    def print_help(self, file: TextIO | None = None) -> None:
        stream = sys.stdout if file is None else file
        self._print_message(self._presentation(stream).help(self.format_help()), stream)

    def print_usage(self, file: TextIO | None = None) -> None:
        stream = sys.stdout if file is None else file
        self._print_message(self._presentation(stream).help(self.format_usage()), stream)

    def _safe_error(self, message: str) -> str:
        names: dict[str, argparse.Action] = {}
        for action in self._actions:
            name = '/'.join(action.option_strings) if action.option_strings else action.dest
            names[name] = action
        required = 'the following arguments are required: '
        if message.startswith(required):
            missing = message[len(required):].split(', ')
            if all(name in names for name in missing):
                return message
        if message.startswith('argument '):
            name, separator, detail = message[len('argument '):].partition(': ')
            if separator and name in names:
                if detail.startswith('invalid int value:'):
                    return f'argument {name}: expected an integer'
                if detail.startswith('invalid choice:'):
                    choices = names[name].choices
                    accepted = ', '.join(choices) if choices is not None else 'see --help'
                    code = 'invalid-visibility: ' if name == '--access' else ''
                    return f'{code}argument {name}: choose from {accepted}'
                if detail in ('expected one argument', 'expected at least one argument'):
                    return f'argument {name}: {detail}'
                return f'argument {name}: invalid value'
        if message.startswith('unrecognized arguments:'):
            return 'unrecognized arguments (values omitted)'
        return 'invalid arguments'

    def error(self, message: str) -> None:
        self.print_usage(sys.stderr)
        safe = self._safe_error(message)
        _eprint(f'{self.prog}: error: {safe}. Run {self.prog} --help for usage.',
                self.stderr_presentation)
        raise SystemExit(2)


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


def _password_sources_cli(flag_pw: str | None, flag_file: str | None) -> list[tuple[str, str | None, bool]]:
    """Collect sources without validating values or reading any file."""
    cands: list[tuple[str, str | None, bool]] = []
    for label, value, is_file in (
        ("flag", flag_pw, False), ("flag-file", flag_file, True),
        ("env", os.environ.get("MANURE_EXTERNAL_PASSWORD"), False),
        ("env-file", os.environ.get("MANURE_EXTERNAL_PASSWORD_FILE"), True),
    ):
        if is_file:
            reference = strip_secret_value(value)
            if reference is not None:
                cands.append((label, reference, True))
        elif value is not None and value != "":
            cands.append((label, value, False))
    if len(cands) > 1:
        raise AmbiguousCredentials("multiple password sources set")
    return cands


def _resolve_password_cli(flag_pw: str | None, flag_file: str | None) -> str | None:
    cands = _password_sources_cli(flag_pw, flag_file)
    if not cands:
        return None
    _label, value, is_file = cands[0]
    return read_token_file(value or "") if is_file else _client_mod._exact_credential(value)


def _resolve_cache_dir(flag: str | None) -> Path:
    if flag is not None and strip_secret_value(flag) is not None:
        return Path(strip_secret_value(flag) or "")
    env = os.environ.get("MANURE_CACHE_DIR")
    env_s = strip_secret_value(env) if env is not None else None
    if env_s is not None:
        return Path(env_s)
    return Path.home() / ".cache" / "manure"


def _print_result[T](obj: T, as_json: bool, human: Callable[[T], str],
                     presentation: cli_output.Presentation) -> None:
    print(json.dumps(obj, sort_keys=True, indent=2) if as_json else presentation.human(human(obj)))


def _exit_for_error(e: ManureError) -> int:
    if e.code == "bad-query":
        return 2
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


def _add_global_options(parser: argparse.ArgumentParser, command_level: bool) -> None:
    parser.add_argument('--json', action='store_true',
        default=argparse.SUPPRESS if command_level else False,
        help='print the result as JSON instead of human-readable text; never emit color')
    parser.add_argument('--color', choices=['auto', 'always', 'never'],
        default=argparse.SUPPRESS if command_level else 'auto',
        help='human output color (default: auto, terminal only; NO_COLOR/TERM=dumb disable auto)')
    parser.add_argument('--cache-dir', default=argparse.SUPPRESS if command_level else None,
        help='upload-session cache directory (overrides MANURE_CACHE_DIR)')
    parser.add_argument('--allow-insecure-http', action='store_true',
        default=argparse.SUPPRESS if command_level else False,
        help='allow plaintext HTTP over an operator-secured private network')


def build_parser(stdout_presentation: cli_output.Presentation,
                 stderr_presentation: cli_output.Presentation) -> argparse.ArgumentParser:
    parser = partial(_ArgumentParser, stdout_presentation=stdout_presentation,
                     stderr_presentation=stderr_presentation)
    ap = parser(prog='manure', description='Upload, share and fetch artifacts.',
        epilog='Output is human-readable by default, including when piped. Use --json for automation. '
               'Global options work before or after the command.')
    _add_global_options(ap, False)
    output_options = argparse.ArgumentParser(add_help=False)
    # An absent command-level flag must not overwrite an explicit global value.
    _add_global_options(output_options, True)
    sub = ap.add_subparsers(dest='cmd', required=True, parser_class=parser)
    p_list = sub.add_parser("list", parents=[output_options], help="list artifacts")
    p_list.add_argument("--limit", type=int, default=None)
    p_list.add_argument("--cursor", default=None, help="opaque continuation cursor; repeat the same list options")
    p_list.add_argument("--include-expired", action="store_true", help="include expired artifacts")
    p_list.add_argument("--visibility", default=None, help="filter by internal, external or public access")
    p_list.add_argument("--state", default=None, help="filter by uploading, publishing or ready state")
    p_search = sub.add_parser("search", parents=[output_options],
        help="search artifact metadata and manifest paths",
        description="Search metadata, not file contents, using the dashboard/MCP query syntax.",
        epilog='Default: catalogue. Use mode:lexical, mode:semantic or mode:hybrid for ranked retrieval; '
               'semantic/hybrid require server configuration. Fields: text, access, state, expired, '
               'kind, owner, sort, direction, tag, hostname, project. Quote values with JSON strings. '
               'Catalogue mode supports --cursor; ranked retrieval does not. '
               'Examples: manure search \'release tag:report\'; manure search \'mode:lexical "quarterly report"\'.')
    p_search.add_argument("query", help="shared search expression (quote it as one shell argument)")
    p_search.add_argument("--limit", type=int, default=None, help="maximum returned artifacts/hits (server cap applies)")
    p_search.add_argument("--cursor", default=None, help="opaque catalogue continuation cursor; repeat the same expression")
    p_info = sub.add_parser("info", parents=[output_options], help="show artifact details")
    p_info.add_argument("id")
    p_up = sub.add_parser("upload", parents=[output_options], help="upload a file or directory",
        description='Upload and publish a file or directory; --access is required.',
        epilog='External uploads print a password on stdout; do not log it. '
               'Repeat the same source/options to resume; --resume selects a cached session, '
               'while --fresh starts a new artifact.')
    p_up.add_argument("path", help="local file or directory (symlinks are rejected)")
    p_up.add_argument("--name", default=None, help="artifact display name (default: source name)")
    p_up.add_argument("--tag", action="append", default=None, help="exact tag (repeatable, max 32)")
    p_up.add_argument("--hostname", default=None, help="explicit source hostname (never inferred)")
    p_up.add_argument("--project-path", default=None, help="explicit project path (never inferred)")
    p_up.add_argument("--access", required=True, choices=['internal', 'external', 'public'],
        metavar='{internal,external,public}',
        help="required access mode: authenticated readers, password link, or anonymous readers")
    p_up.add_argument("--expires-in", default=None,
        help="TTL: seconds or 30m/2h/7d; range 60..31536000 seconds (default: no expiry)")
    p_up.add_argument("--resume", default=None, metavar='ID', help="resume this cached upload session")
    p_up.add_argument("--fresh", action="store_true", help="start a new artifact instead of auto-resuming")
    p_fetch = sub.add_parser("fetch", parents=[output_options], help="download and verify an artifact",
        description='Download into a destination directory and verify file hashes.',
        epilog='Public content URL fetch needs no token. External content URL fetch needs a password; '
               'prefer --password-file to keep it out of process arguments and shell history. '
               'Password flags do not override environment sources; set exactly one.')
    p_fetch.add_argument("id_or_url", help="artifact ID (authenticated API) or returned content URL")
    p_fetch.add_argument("dest", help="destination directory (never follows or overwrites symlinks)")
    p_fetch.add_argument("--password", default=None, help="external password (visible in process arguments)")
    p_fetch.add_argument("--password-file", default=None, help="read the external password from a file")
    p_del = sub.add_parser("delete", parents=[output_options], help="delete an artifact")
    p_del.add_argument("id")
    p_rot = sub.add_parser("rotate-password", parents=[output_options], help="replace an external password")
    p_rot.add_argument("id")
    sub.add_parser("whoami", parents=[output_options], help="show the authenticated identity")
    return ap


def main(argv: list[str] | None = None) -> int:
    arguments = sys.argv[1:] if argv is None else argv
    output = _output_options(arguments)
    stdout_presentation = cli_output.Presentation.for_stream(output.color, output.as_json,
        sys.stdout.isatty(), os.environ.get('NO_COLOR'), os.environ.get('TERM'))
    stderr_presentation = cli_output.Presentation.for_stream(output.color, output.as_json,
        sys.stderr.isatty(), os.environ.get('NO_COLOR'), os.environ.get('TERM'))
    ap = build_parser(stdout_presentation, stderr_presentation)
    try:
        args = ap.parse_args(arguments)
    except SystemExit as e:
        return int(e.code or 0)
    cache_dir = _resolve_cache_dir(getattr(args, "cache_dir", None))
    # Resolve credentials before network; ambiguity -> exit 2 no-network
    try:
        # Preflight ALL relevant source pairs before any credential-file read.
        # Do not let URL-file resolution hide a known token/password ambiguity.
        _client_mod.check_secret_pair_ambiguity(os.environ.get("MANURE_URL"), os.environ.get("MANURE_URL_FILE"), kind="url")
        _client_mod.check_secret_pair_ambiguity(os.environ.get("MANURE_TOKEN"), os.environ.get("MANURE_TOKEN_FILE"), kind="token")
        password_sources = _password_sources_cli(getattr(args, "password", None), getattr(args, "password_file", None)) if args.cmd == "fetch" else []
        allow_insecure_http = _client_mod.insecure_http_from_env(os.environ.get("MANURE_ALLOW_INSECURE_HTTP")) or args.allow_insecure_http
        _client_mod._exact_credential(os.environ.get("MANURE_TOKEN"))
        if password_sources and not password_sources[0][2]:
            _client_mod._exact_credential(password_sources[0][1])
        api_base = _resolve_api_base()
        if api_base is not None:
            _client_mod.validate_url_before_network(api_base, allow_insecure_http)
        elif args.cmd != "fetch":
            raise _client_mod.MissingCredentials("MANURE_URL is required")
        token = _resolve_token()
    except AmbiguousCredentials as e:
        _eprint(f"ambiguous-credentials: {e.message}", stderr_presentation)
        return 2
    except ManureError as e:
        _eprint(f"{e.code}: {e.message}", stderr_presentation)
        return 2
    except OSError:
        _eprint("unavailable: local error", stderr_presentation)
        return 1
    except Exception:
        _eprint("unavailable: unexpected error", stderr_presentation)
        return 1
    cmd = args.cmd
    as_json = args.json
    try:
        if cmd == "fetch":
            # password sources (flag/file/env) with ambiguity check before network
            try:
                password = _resolve_password_cli(getattr(args, "password", None),
                                                 getattr(args, "password_file", None))
            except AmbiguousCredentials as e:
                _eprint(f"ambiguous-credentials: {e.message}", stderr_presentation)
                return 2
            except ManureError as e:
                _eprint(f"{e.code}: {e.message}", stderr_presentation)
                return 2
            id_or_url: str = args.id_or_url
            is_url = "://" in id_or_url
            if not is_url and api_base is None:
                _eprint("missing-credentials: MANURE_URL is required", stderr_presentation)
                return 2
            # content-URL fetch needs no api_base/token; id fetch needs api_base
            effective_base = api_base if api_base is not None else "http://127.0.0.1:9"
            try:
                client = _client_mod.ManureClient(effective_base, token=token, cache_dir=cache_dir, allow_insecure_http=allow_insecure_http)
            except AmbiguousCredentials as e:
                _eprint(f"ambiguous-credentials: {e.message}", stderr_presentation)
                return 2
            except ManureError as e:
                _eprint(f"{e.code}: {e.message}", stderr_presentation)
                return _exit_for_error(e)
            try:
                res = client.fetch_to_dest(id_or_url, args.dest, password=password)
            except ManureError as e:
                _eprint(f"{e.code}: {e.message}", stderr_presentation)
                return _exit_for_error(e)
            _print_result(res, as_json, cli_output.fetched, stdout_presentation)
            return 0
        # all other commands require api_base + token
        if api_base is None or token is None:
            _eprint("missing-credentials: MANURE_URL and MANURE_TOKEN are required", stderr_presentation)
            return 2
        try:
            client = _client_mod.ManureClient(api_base, token=token, cache_dir=cache_dir, allow_insecure_http=allow_insecure_http)
        except ManureError as e:
            _eprint(f"{e.code}: {e.message}", stderr_presentation)
            return _exit_for_error(e)
        if cmd == "whoami":
            res = client.whoami()
            _print_result(res, as_json, cli_output.identity, stdout_presentation)
            return 0
        if cmd == "list":
            res = client.list_artifacts(limit=args.limit, cursor=args.cursor,
                                        include_expired=bool(args.include_expired),
                                        visibility=args.visibility, state=args.state)
            _print_result(res, as_json, cli_output.catalogue, stdout_presentation)
            return 0
        if cmd == "search":
            res = client.search_expression(args.query, limit=args.limit, cursor=args.cursor)
            _print_result(res, as_json, cli_output.search, stdout_presentation)
            return 0
        if cmd == "info":
            res = client.get_artifact(args.id)
            _print_result(res, as_json, cli_output.artifact, stdout_presentation)
            return 0
        if cmd == "delete":
            res = client.delete(args.id)
            _print_result(res, as_json, lambda _: cli_output.deleted(args.id), stdout_presentation)
            return 0
        if cmd == "rotate-password":
            res = client.rotate_password(args.id)
            _print_result(res, as_json, lambda result: cli_output.password_rotated(args.id, result), stdout_presentation)
            return 0
        if cmd == "upload":
            try:
                exp = parse_expires_in(args.expires_in) if args.expires_in is not None else None
            except ManureError as e:
                _eprint(f"{e.code}: {e.message}", stderr_presentation)
                return 2
            res = client.upload_path(args.path, access=args.access, name=args.name,
                                     expires_in_s=exp, resume_id=args.resume,
                                     fresh=bool(args.fresh), tags=args.tag,
                                     hostname=args.hostname, project_path=args.project_path)
            _print_result(res, as_json, cli_output.uploaded, stdout_presentation)
            return 0
    except ManureError as e:
        # Sanitized: codes/messages never carry secret material (B7).
        _eprint(f"{e.code}: {e.message}", stderr_presentation)
        return _exit_for_error(e)
    except OSError:
        _eprint("unavailable: local error", stderr_presentation)
        return 1
    except Exception:
        _eprint("unavailable: unexpected error", stderr_presentation)
        return 1
    _eprint("unknown command", stderr_presentation)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
