"""manure client: shared REST + upload/fetch logic (contract v0.2, client-owned).

Stdlib only, Python >=3.12. Explicit constructor dependencies,
no module-level mutable state.
"""
from __future__ import annotations

import hashlib
import http.client
import json
import os
import posixpath
import re
import stat
import time
import urllib.parse
from pathlib import Path
from typing import Any, Protocol

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
ARTIFACT_ID_RE = re.compile(r"^[0-9a-f]{32}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

MAX_TTL_S = 31536000
MIN_TTL_S = 60
MAX_FILE_BYTES = 536870912
MAX_ARTIFACT_BYTES = 2147483648
MAX_FILES = 10000
MAX_REDIRECTS = 3
FETCH_RANGE_BYTES = 1048576
MIN_CHUNK_BYTES = 262144
MAX_CHUNK_BYTES = 4194304
# Transport-level safety cap: largest legitimate single response is a 4 MiB
# chunk or 4 MiB JSON body; 8 MiB + slack aborts hostile oversized replies
# before any write.
MAX_TRANSPORT_BYTES = 8 * 1024 * 1024 + 1024

RESERVED_TOP = ("__manure", "api")

# Sentinel distinguishing omitted TTL from explicit null (clear) in PATCH.
PATCH_OMIT: Any = object()


# ---------------------------------------------------------------- errors

class ManureError(Exception):
    def __init__(self, code: str, message: str, http_status: int | None = None,
                 retry_after: str | None = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.http_status = http_status
        self.retry_after = retry_after


class AmbiguousCredentials(ManureError):
    def __init__(self, message: str = "both direct and file credentials set"):
        super().__init__("ambiguous-credentials", message)


class MissingCredentials(ManureError):
    def __init__(self, message: str = "missing credentials"):
        super().__init__("missing-credentials", message)


class SourceChanged(ManureError):
    def __init__(self, message: str = "source changed"):
        super().__init__("source-changed", message)


class InvalidManifest(ManureError):
    def __init__(self, message: str = "invalid manifest"):
        super().__init__("invalid-manifest", message)


class InvalidPath(ManureError):
    def __init__(self, message: str = "invalid path"):
        super().__init__("invalid-path", message)


class InvalidTTL(ManureError):
    def __init__(self, message: str = "invalid ttl"):
        super().__init__("invalid-ttl", message)


class InvalidUrl(ManureError):
    def __init__(self, message: str = "invalid url"):
        super().__init__("invalid-url", message)


# ------------------------------------------------------- secret handling

def strip_secret_value(value: str | None) -> str | None:
    """Contract §9: strip one trailing LF then surrounding whitespace; empty=unset."""
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    if value.endswith("\n"):
        value = value[:-1]
    value = value.strip()
    return value if value != "" else None


def _validate_name(value: str) -> None:
    if not isinstance(value, str) or not (1 <= len(value) <= 256):
        raise ManureError("bad-envelope", "bad name")


def _is_canonical_token(value: str) -> bool:
    """True iff value is the canonical 43-char unpadded base64url of 32 bytes.

    Authoritative contract meaning (governor disposition A1): exact ASCII 43
    chars over the URL alphabet that decode to 32 bytes and re-encode to the
    identical string (low padding bits zero). Stricter than regex-only
    acceptance; canonically generated tokens are fully compatible.
    """
    if not isinstance(value, str) or len(value) != 43:
        return False
    try:
        value.encode("ascii")
    except (UnicodeEncodeError, AttributeError):
        return False
    if not TOKEN_RE.match(value):
        return False
    try:
        import base64 as _b64
        raw = _b64.urlsafe_b64decode(value + "=")
    except Exception:
        return False
    if len(raw) != 32:
        return False
    return _b64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii") == value


def _validate_token_format(value: str) -> None:
    """Validate a direct bearer/password value against the canonical codec.

    Raises bad-envelope without echoing the value (secret-canary safe).
    Direct values are exact: no whitespace stripping (governor A1).
    """
    if not _is_canonical_token(value):
        raise ManureError("bad-envelope", "malformed credential")


def read_token_file(path: str | os.PathLike) -> str:
    """Haystack exact-byte rule: 43 chars + at most one final LF.

    Rejects: empty, NUL, CR, non-ASCII printable, multiline, noncanonical.
    IO failures are normalized to missing-credentials (sanitized).
    """
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        raise MissingCredentials("unreadable credential file")
    if len(raw) == 0:
        raise ManureError("unauthorized", "empty credential file")
    if b"\x00" in raw:
        raise ManureError("unauthorized", "NUL in credential file")
    if b"\r" in raw:
        raise ManureError("unauthorized", "CR in credential file")
    for b in raw:
        if b == 10:
            continue
        if b < 32 or b > 126:
            raise ManureError("unauthorized", "non-ASCII in credential file")
    try:
        text = raw.decode("ascii")
    except Exception:
        raise ManureError("unauthorized", "non-ASCII in credential file")
    if text.endswith("\n"):
        text = text[:-1]
    if "\n" in text:
        raise ManureError("unauthorized", "multiline credential file")
    if not _is_canonical_token(text):
        raise ManureError("unauthorized", "malformed credential file")
    return text


def read_url_file(path: str | os.PathLike) -> str | None:
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError:
        raise MissingCredentials("unreadable url file")
    try:
        text = raw.decode("utf-8")
    except Exception:
        raise InvalidUrl("url file is not utf-8")
    if "\x00" in text:
        raise InvalidUrl("NUL in url file")
    return strip_secret_value(text)


def _exact_credential(direct: str | None) -> str | None:
    """Exact direct credential: None/"" is unset; anything else must be the
    canonical 43-char value verbatim — no whitespace stripping (governor A1).
    """
    if direct is None or direct == "":
        return None
    if not isinstance(direct, str):
        raise ManureError("bad-envelope", "malformed credential")
    _validate_token_format(direct)
    return direct


def resolve_secret_pair(direct: str | None, file_path: str | None, *, kind: str = "token") -> str | None:
    """Resolve one MANURE_* direct/file pair.

    Token/password direct values are exact (canonical, no stripping per
    governor A1); token/password files use the exact-byte file rule (43 chars
    plus at most one final LF); url values/files use the §9 strip rule.
    Both present -> AmbiguousCredentials (no network by construction).
    """
    if kind in ("token", "password"):
        d = _exact_credential(direct)
    else:
        d = strip_secret_value(direct)
    f_raw: str | None = None
    if file_path is not None and str(file_path).strip() != "":
        fp = str(file_path)
        if kind in ("token", "password"):
            f_raw = read_token_file(fp)
        else:
            f_raw = read_url_file(fp)
        if f_raw is not None and f_raw == "":
            f_raw = None
    if d is not None and f_raw is not None:
        raise AmbiguousCredentials(f"both {kind} direct and file credentials set")
    return d if d is not None else f_raw


def is_loopback_host(host: str) -> bool:
    h = host.lower().rstrip(".")
    if h in ("127.0.0.1", "::1", "localhost"):
        return True
    if h.endswith(".localhost"):
        return True
    return False


def _parsed_port(parsed: urllib.parse.ParseResult) -> int | None:
    """Return validated port or None; raises InvalidUrl on bad port (no secret)."""
    try:
        port = parsed.port
    except ValueError:
        raise InvalidUrl("invalid port")
    if port is not None and not (1 <= port <= 65535):
        raise InvalidUrl("invalid port")
    return port


def _bracket_host(host: str) -> str:
    if ":" in host and not host.startswith("["):
        return f"[{host}]"
    return host


def validate_url_before_network(url: str) -> urllib.parse.ParseResult:
    if not isinstance(url, str) or not url:
        raise InvalidUrl("malformed url")
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        raise InvalidUrl("malformed url")
    if parsed.scheme not in ("http", "https"):
        raise InvalidUrl("unsupported scheme")
    host = parsed.hostname
    if not host:
        raise InvalidUrl("missing host")
    _parsed_port(parsed)
    if parsed.scheme == "http" and not is_loopback_host(host):
        raise InvalidUrl("http only allowed for loopback hosts")
    return parsed


def origin_of(url: str) -> str:
    p = urllib.parse.urlparse(url)
    host = p.hostname or ""
    try:
        port = p.port
    except ValueError:
        raise InvalidUrl("invalid port")
    port_s = f":{port}" if port else ""
    return f"{p.scheme}://{_bracket_host(host)}{port_s}"


def _origin_from_parsed(parsed: urllib.parse.ParseResult) -> str:
    host = parsed.hostname or ""
    port = _parsed_port(parsed)
    port_s = f":{port}" if port else ""
    return f"{parsed.scheme}://{_bracket_host(host)}{port_s}"


def _validate_chunk_bytes(n: Any) -> int:
    if isinstance(n, bool) or not isinstance(n, int):
        raise ManureError("bad-envelope", "bad chunk_bytes")
    if not (MIN_CHUNK_BYTES <= n <= MAX_CHUNK_BYTES):
        raise ManureError("bad-envelope", "bad chunk_bytes")
    return n


def parse_expires_in(value: str | int | None) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise InvalidTTL("invalid ttl")
    if isinstance(value, int):
        n = value
    elif isinstance(value, str):
        s = value.strip()
        if s == "":
            raise InvalidTTL("invalid ttl")
        if re.fullmatch(r"\d+", s):
            n = int(s)
        else:
            m = re.fullmatch(r"(\d+)([smhd])", s)
            if not m:
                raise InvalidTTL(f"invalid ttl: {value}")
            num = int(m.group(1))
            mult = {"s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]
            n = num * mult
    else:
        raise InvalidTTL("invalid ttl")
    if not (MIN_TTL_S <= n <= MAX_TTL_S):
        raise InvalidTTL(f"ttl out of range 60..{MAX_TTL_S}: {n}")
    return n


# ------------------------------------------------------- manifest rules

def validate_manifest_path(p: str) -> None:
    if not isinstance(p, str) or p == "":
        raise InvalidPath("empty path")
    if len(p) > 1024:
        raise InvalidPath("path too long")
    if "\x00" in p:
        raise InvalidPath("NUL in path")
    if "\\" in p:
        raise InvalidPath("backslash in path")
    if p.startswith("/"):
        raise InvalidPath("absolute path")
    if p in (".", ".."):
        raise InvalidPath("dot path")
    if len(p) >= 2 and p[1] == ":":
        raise InvalidPath("drive path")
    if posixpath.normpath(p) != p:
        raise InvalidPath(f"non-normalized path: {p}")
    segs = p.split("/")
    if "" in segs:
        raise InvalidPath(f"empty segment in path: {p}")
    if "." in segs or ".." in segs:
        raise InvalidPath(f"dot segment in path: {p}")
    if len(segs) > 64:
        raise InvalidPath("path too deep")
    if segs[0] in RESERVED_TOP:
        raise InvalidPath(f"reserved prefix: {p}")


def validate_manifest(entries: list[dict[str, Any]], kind: str) -> None:
    if kind not in ("file", "dir"):
        raise InvalidManifest(f"bad kind: {kind}")
    seen: set[str] = set()
    for e in entries:
        if not isinstance(e, dict) or "path" not in e or "kind" not in e:
            raise InvalidManifest("bad entry shape")
        p = e["path"]
        k = e["kind"]
        try:
            validate_manifest_path(p)
        except InvalidPath as ex:
            raise InvalidManifest(str(ex))
        if k not in ("file", "dir"):
            raise InvalidManifest(f"bad entry kind: {k}")
        if p in seen:
            raise InvalidManifest(f"duplicate path: {p}")
        seen.add(p)
        if k == "file":
            if "size" not in e or "sha256" not in e:
                raise InvalidManifest(f"file entry missing size/sha: {p}")
            sz = e["size"]
            if isinstance(sz, bool) or not isinstance(sz, int) or sz < 0:
                raise InvalidManifest(f"bad size for {p}")
            if sz > MAX_FILE_BYTES:
                raise InvalidManifest(f"file too large: {p}")
            sha = e["sha256"]
            if not isinstance(sha, str) or not SHA256_RE.match(sha):
                raise InvalidManifest(f"bad sha for {p}")
            if set(e.keys()) - {"path", "kind", "size", "sha256"}:
                raise InvalidManifest(f"extra keys in file entry: {p}")
        else:
            if "size" in e or "sha256" in e:
                raise InvalidManifest(f"dir entry must carry only path+kind: {p}")
            if set(e.keys()) - {"path", "kind"}:
                raise InvalidManifest(f"extra keys in dir entry: {p}")
    files = [e for e in entries if e["kind"] == "file"]
    dirs = [e for e in entries if e["kind"] == "dir"]
    if kind == "file":
        if len(files) != 1 or len(dirs) != 0:
            raise InvalidManifest("file artifact must hold exactly 1 file, 0 dirs")
    if len(entries) > MAX_FILES:
        raise InvalidManifest("too many entries")
    for f in files:
        prefix = f["path"] + "/"
        for o in entries:
            if o is f:
                continue
            if o["path"].startswith(prefix):
                raise InvalidManifest(f"file/descendant conflict: {f['path']} vs {o['path']}")
    total = sum(int(f["size"]) for f in files)
    if total > MAX_ARTIFACT_BYTES:
        raise InvalidManifest("artifact too large")


def validate_fetch_manifest(files: list[dict[str, Any]]) -> None:
    """Hostile-manifest guard for fetch: same path/topology rules, no kind constraint."""
    seen: set[str] = set()
    for e in files:
        if not isinstance(e, dict) or "path" not in e or "kind" not in e:
            raise InvalidManifest("bad entry shape")
        p = e["path"]
        k = e["kind"]
        try:
            validate_manifest_path(p)
        except InvalidPath as ex:
            raise InvalidManifest(str(ex))
        if k not in ("file", "dir"):
            raise InvalidManifest("bad kind")
        if p in seen:
            raise InvalidManifest(f"duplicate: {p}")
        seen.add(p)
        if k == "file":
            if "size" not in e or "sha256" not in e:
                raise InvalidManifest("file missing size/sha")
            sz = e["size"]
            if isinstance(sz, bool) or not isinstance(sz, int) or sz < 0:
                raise InvalidManifest("bad size")
            if sz > MAX_FILE_BYTES:
                raise InvalidManifest("file too large")
            if not isinstance(e["sha256"], str) or not SHA256_RE.match(e["sha256"]):
                raise InvalidManifest("bad sha")
        if len(seen) > MAX_FILES:
            raise InvalidManifest("too many entries")
    file_paths = [e["path"] for e in files if e["kind"] == "file"]
    for fp in file_paths:
        prefix = fp + "/"
        for o in files:
            if o["path"] != fp and o["path"].startswith(prefix):
                raise InvalidManifest(f"file/descendant conflict: {fp}")
    total = sum(int(e["size"]) for e in files if e.get("kind") == "file")
    if total > MAX_ARTIFACT_BYTES:
        raise InvalidManifest("artifact too large")


def _hash_file(path: Path) -> tuple[int, str]:
    # B4: no-follow, verified-regular hashing (leaf + fstat, no symlink follow).
    return _hash_file_nofollow(path)


def build_manifest(local_path: str | os.PathLike) -> tuple[str, list[dict[str, Any]]]:
    p = Path(local_path)
    # B4: every classification below goes through retained traversal
    # descriptors: the parent dir is pinned with O_NOFOLLOW from `/`, the leaf
    # is typed with dir-fd lstat, and file bytes are hashed through a leaf fd
    # opened relative to the pinned parent. Raced symlink ancestors cannot
    # redirect classification or reads.
    try:
        _pdir = _traverse_open(str(p.parent), directory=True)
    except InvalidPath:
        raise InvalidPath(f"symlink not allowed: {local_path}")
    try:
        try:
            _lst = os.stat(p.name, dir_fd=_pdir, follow_symlinks=False)
        except OSError:
            raise InvalidPath(f"not found: {local_path}")
        if stat.S_ISLNK(_lst.st_mode):
            raise InvalidPath(f"symlink not allowed: {local_path}")
        _is_dir = stat.S_ISDIR(_lst.st_mode)
        _is_reg = stat.S_ISREG(_lst.st_mode)
    finally:
        try:
            os.close(_pdir)
        except OSError:
            pass
    if _is_reg:
        # Re-pin and hash through the retained parent fd (B4).
        try:
            _pdir2 = _traverse_open(str(p.parent), directory=True)
        except InvalidPath:
            raise InvalidPath(f"symlink not allowed: {local_path}")
        try:
            try:
                _sfd = os.open(p.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=_pdir2)
            except OSError:
                raise InvalidPath(f"symlink not allowed: {local_path}")
            try:
                _sst = os.fstat(_sfd)
                if not stat.S_ISREG(_sst.st_mode):
                    raise InvalidPath(f"not a regular file: {local_path}")
                _h = hashlib.sha256()
                _size = 0
                while True:
                    _blk = os.read(_sfd, 1048576)
                    if not _blk:
                        break
                    _h.update(_blk)
                    _size += len(_blk)
                size, sha = _size, _h.hexdigest()
            finally:
                try:
                    os.close(_sfd)
                except OSError:
                    pass
        finally:
            try:
                os.close(_pdir2)
            except OSError:
                pass
        name = p.name
        validate_manifest_path(name)
        entries = [{"path": name, "kind": "file", "size": size, "sha256": sha}]
        validate_manifest(entries, "file")
        return ("file", entries)
    if not _is_dir:
        raise InvalidPath(f"not a file or directory: {local_path}")
    if p.is_dir():
        files: list[dict[str, Any]] = []
        empty_dirs: list[dict[str, Any]] = []
        # B4: descriptor-rooted walk; symlinked entries rejected, never followed.
        # First pass: topology + empty dirs (lstat via dir_fd inside walker).
        seen_dirs: set[str] = set()
        all_filenames: list[str] = []
        for rel_dir, dirnames, filenames in _walk_nofollow(p):
            # Reject any symlink leaf: walker reports symlinks as filenames;
            # verify each with lstat no-follow (dir_fd chain would be ideal,
            # but names were listed no-follow so islink check is exact here).
            for nm in list(dirnames) + list(filenames):
                full = (p / rel_dir / nm) if rel_dir else (p / nm)
                # lstat without following (B4 leaf protection).
                try:
                    lst = os.lstat(str(full))
                except FileNotFoundError:
                    raise InvalidPath(f"vanished: {full}")
                if stat.S_ISLNK(lst.st_mode):
                    raise InvalidPath(f"symlink not allowed: {full}")
            seen_dirs.add(rel_dir)
            all_filenames.extend([f"{rel_dir}/{fn}" if rel_dir else fn for fn in filenames])
            if not dirnames and not filenames:
                if rel_dir != "":
                    validate_manifest_path(rel_dir)
                    empty_dirs.append({"path": rel_dir, "kind": "dir"})
        # Second pass: hash files via descriptor-rooted no-follow opens.
        for dir_rel, _dns, fns in _walk_nofollow(p):
            for fn in fns:
                rel = f"{dir_rel}/{fn}" if dir_rel else fn
                # Skip entries already recorded as empty dirs (disjoint sets).
                validate_manifest_path(rel)
                fd = _open_source_nofollow(p, rel)
                try:
                    h = hashlib.sha256()
                    size = 0
                    while True:
                        chunk = os.read(fd, 1048576)
                        if not chunk:
                            break
                        h.update(chunk)
                        size += len(chunk)
                finally:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
                files.append({"path": rel, "kind": "file", "size": size, "sha256": h.hexdigest()})
        entries = sorted(files + empty_dirs, key=lambda e: e["path"])
        validate_manifest(entries, "dir")
        return ("dir", entries)
    raise InvalidPath(f"not a file or directory: {local_path}")


def _manifest_sha256(entries: list[dict[str, Any]]) -> str:
    canonical = json.dumps(entries, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def manifest_sha256_for_path(local_path: str | os.PathLike) -> str:
    _, entries = build_manifest(local_path)
    return _manifest_sha256(entries)


def _validate_ancestors_no_symlink(path: Path) -> None:
    """Reject symlink ancestors before any creation (B4, incl. empty fetches).

    Walks every existing component; missing tails are checked after mkdir by
    re-lstat. Raises InvalidPath without touching the filesystem.
    """
    cur: Path = path if path.exists() or path.is_symlink() else path.parent
    # Walk the path itself (if it exists/symlink) plus all parents to root.
    chain: list[Path] = []
    node: Path = path
    while True:
        chain.append(node)
        parent = node.parent
        if parent == node:
            break
        node = parent
    for comp in chain:
        try:
            if comp.is_symlink():
                raise InvalidPath(f"symlink in path: {comp}")
        except OSError:
            raise InvalidPath(f"unreadable path: {comp}")


def _open_regular_nofollow(path: Path) -> int:
    """Open a regular file with O_NOFOLLOW and verify via fstat (B4)."""
    try:
        fd = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        raise
    except OSError:
        raise InvalidPath(f"symlink or unreadable file: {path}")
    try:
        st = os.fstat(fd)
    except OSError:
        try:
            os.close(fd)
        except OSError:
            pass
        raise InvalidPath(f"unreadable file: {path}")
    if not stat.S_ISREG(st.st_mode):
        try:
            os.close(fd)
        except OSError:
            pass
        raise InvalidPath(f"not a regular file: {path}")
    return fd


def _hash_file_nofollow(path: Path) -> tuple[int, str]:
    h = hashlib.sha256()
    size = 0
    fd = _open_regular_nofollow(path)
    try:
        while True:
            chunk = os.read(fd, 1048576)
            if not chunk:
                break
            h.update(chunk)
            size += len(chunk)
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
    return (size, h.hexdigest())


def _verify_parent_pinned(parent_fd: int, parent_path: Path) -> None:
    """Fail closed when parent_fd no longer matches parent_path (B4)."""
    try:
        fresh_fd = _traverse_open(str(parent_path), directory=True)
    except InvalidPath:
        raise InvalidPath(f"staging changed: {parent_path}")
    try:
        try:
            orig_st = os.fstat(parent_fd)
            fresh_st = os.fstat(fresh_fd)
        except OSError:
            raise InvalidPath(f"staging changed: {parent_path}")
        if (orig_st.st_dev, orig_st.st_ino) != (fresh_st.st_dev, fresh_st.st_ino):
            raise InvalidPath(f"staging changed: {parent_path}")
    finally:
        try:
            os.close(fresh_fd)
        except OSError:
            pass


def _existing_final_matches(final: Path, size: int, sha: str) -> bool:
    """Descriptor-rooted existing-destination check (B4).

    Classifies the leaf and hashes bytes through a parent fd acquired by
    no-follow traversal and retained for the whole check: ancestors are
    never followed after pinning, so a swapped ancestor cannot redirect
    classification or reads (ZERO outside reads). Any symlink leaf,
    directory, non-regular, or identity mismatch fails closed with
    InvalidPath; a missing leaf returns False. A matching regular file
    returns True only after re-verifying the retained parent still matches
    its path (swap AFTER acquisition also fails closed)."""
    try:
        parent_fd = _traverse_open(str(final.parent), directory=True)
    except InvalidPath:
        # Missing parent ⇒ no existing file (proceed to download). A
        # symlink ancestor that resolves must still fail closed: distinguish
        # by a following existence probe (metadata only, never content).
        try:
            os.stat(str(final.parent))
        except FileNotFoundError:
            return False
        except OSError:
            raise InvalidPath(f"symlink in dest path: {final.parent}")
        raise InvalidPath(f"symlink in dest path: {final.parent}")
    try:
        leaf = final.name
        if "/" in leaf or leaf in ("", ".", ".."):
            raise InvalidPath(f"bad path: {final}")
        try:
            lst = os.stat(leaf, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            return False
        except OSError:
            raise InvalidPath(f"unreadable path: {final}")
        if stat.S_ISLNK(lst.st_mode):
            raise InvalidPath(f"refusing to overwrite symlink: {final}")
        if stat.S_ISDIR(lst.st_mode):
            raise InvalidPath(f"path is a directory: {final}")
        if not stat.S_ISREG(lst.st_mode):
            raise InvalidPath(f"not a regular file: {final}")
        if lst.st_size != size:
            _verify_parent_pinned(parent_fd, final.parent)
            return False
        try:
            fd = os.open(leaf, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        except OSError:
            raise InvalidPath(f"symlink or unreadable file: {final}")
        try:
            try:
                fst = os.fstat(fd)
            except OSError:
                raise InvalidPath(f"unreadable file: {final}")
            if not stat.S_ISREG(fst.st_mode):
                raise InvalidPath(f"not a regular file: {final}")
            if (fst.st_dev, fst.st_ino) != (lst.st_dev, lst.st_ino):
                raise InvalidPath(f"destination changed: {final}")
            h = hashlib.sha256()
            sz = 0
            while True:
                try:
                    blk = os.read(fd, 1048576)
                except OSError:
                    raise InvalidPath(f"unreadable file: {final}")
                if not blk:
                    break
                h.update(blk)
                sz += len(blk)
            if sz != size or h.hexdigest() != sha:
                _verify_parent_pinned(parent_fd, final.parent)
                return False
            _verify_parent_pinned(parent_fd, final.parent)
            return True
        finally:
            try:
                os.close(fd)
            except OSError:
                pass
    finally:
        try:
            os.close(parent_fd)
        except OSError:
            pass


def _open_at(parent_fd: int, comp: str, *, directory: bool = False) -> int:
    flags = os.O_RDONLY | os.O_NOFOLLOW
    if directory:
        flags |= os.O_DIRECTORY
    try:
        return os.open(comp, flags, dir_fd=parent_fd)
    except OSError:
        raise InvalidPath(f"symlink in path: {comp}")


def _open_source_at(root_fd: int, rel: str) -> int:
    """Open root_fd/rel without following any component (B4, fully fd-rooted)."""
    parent_fd = root_fd
    owned: list[int] = []
    try:
        parts = rel.split("/") if rel else []
        for comp in parts[:-1]:
            nxt = _open_at(parent_fd, comp, directory=True)
            if parent_fd is not root_fd:
                owned.append(parent_fd)
            parent_fd = nxt
        leaf = parts[-1] if parts else ""
        try:
            fd = os.open(leaf if leaf else ".", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
        except OSError:
            raise SourceChanged(f"source became symlink: {rel}")
        try:
            st = os.fstat(fd)
        except OSError:
            try:
                os.close(fd)
            except OSError:
                pass
            raise SourceChanged(f"source unreadable: {rel}")
        if not stat.S_ISREG(st.st_mode):
            try:
                os.close(fd)
            except OSError:
                pass
            raise SourceChanged(f"source not regular: {rel}")
        return fd
    finally:
        for owned_fd in owned:
            try:
                os.close(owned_fd)
            except OSError:
                pass
        if parent_fd is not root_fd:
            try:
                os.close(parent_fd)
            except OSError:
                pass


def _stat_at(parent_fd: int, comp: str) -> os.stat_result:
    try:
        return os.stat(comp, dir_fd=parent_fd, follow_symlinks=False)
    except OSError:
        raise InvalidPath(f"unreadable path: {comp}")


def _hash_fd(fd: int) -> tuple[int, str]:
    try:
        os.lseek(fd, 0, os.SEEK_SET)
    except OSError:
        raise InvalidPath("unreadable file")
    h = hashlib.sha256()
    size = 0
    while True:
        try:
            chunk = os.read(fd, 1048576)
        except OSError:
            raise InvalidPath("unreadable file")
        if not chunk:
            break
        h.update(chunk)
        size += len(chunk)
    return (size, h.hexdigest())


def _traverse_open(path: str | os.PathLike, *, directory: bool) -> int:
    """Open an absolute path through no-follow descriptor traversal (B4).

    Walks every component from `/` with `O_NOFOLLOW` (directories also get
    `O_DIRECTORY`); each step is relative to the previously verified parent
    fd, which is retained until the child is opened. Symlinks, mount-swap
    races on followed ancestors, and non-directory prefixes all fail closed
    with InvalidPath. Returns a retained fd the caller must close.
    """
    ap = os.path.abspath(str(path))
    parts = Path(ap).parts
    try:
        cur = os.open(parts[0], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        raise InvalidPath("unreadable path")
    try:
        for i, comp in enumerate(parts[1:]):
            last = i == len(parts) - 2
            flags = os.O_RDONLY | os.O_NOFOLLOW
            if not last or directory:
                flags |= os.O_DIRECTORY
            try:
                nxt = os.open(comp, flags, dir_fd=cur)
            except OSError:
                raise InvalidPath(f"symlink or unreadable component: {comp}")
            try:
                os.close(cur)
            except OSError:
                pass
            cur = nxt
        return cur
    except Exception:
        try:
            os.close(cur)
        except OSError:
            pass
        raise


def _open_dir_nofollow(path: Path) -> int:
    try:
        return _traverse_open(str(path), directory=True)
    except InvalidPath:
        raise InvalidPath(f"symlink or unreadable directory: {path}")


def _mkdir_p_nofollow(target: Path) -> None:
    """Descriptor-rooted mkdir -p that never follows symlinked ancestors (B4).

    Validates every existing component with lstat (no follow); creates missing
    components via mkdirat on verified parent fds.
    """
    import errno as _errno
    abs_target = Path(os.path.abspath(str(target)))
    parts = abs_target.parts
    # Walk from root, tracking the deepest verified dir fd.
    cur = Path(parts[0])
    try:
        st0 = os.lstat(str(cur))
    except OSError:
        raise InvalidPath(f"unreadable path: {cur}")
    # Root must be a dir, never a symlink (lstat).
    if not stat.S_ISDIR(st0.st_mode):
        raise InvalidPath(f"not a directory: {cur}")
    # Open root fd.
    try:
        root_fd = os.open(str(cur), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError:
        raise InvalidPath(f"symlink in path: {cur}")
    try:
        parent_fd = root_fd
        built_path = Path(parts[0])
        for comp in parts[1:]:
            built_path = built_path / comp
            try:
                st = os.stat(comp, dir_fd=parent_fd, follow_symlinks=False)
                if stat.S_ISLNK(st.st_mode):
                    raise InvalidPath(f"symlink in path: {built_path}")
                if not stat.S_ISDIR(st.st_mode):
                    # Existing non-dir where a dir is needed.
                    raise InvalidPath(f"file blocks directory: {built_path}")
                nxt = os.open(comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
            except FileNotFoundError:
                try:
                    os.mkdir(comp, 0o755, dir_fd=parent_fd)
                except OSError:
                    raise InvalidPath(f"cannot create directory: {built_path}")
                try:
                    nxt = os.open(comp, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd)
                except OSError:
                    raise InvalidPath(f"symlink in path: {built_path}")
            except OSError as e:
                if isinstance(e, InvalidPath):
                    raise
                raise InvalidPath(f"unreadable path: {built_path}")
            if parent_fd != root_fd:
                try:
                    os.close(parent_fd)
                except OSError:
                    pass
            parent_fd = nxt
        if parent_fd != root_fd:
            try:
                os.close(parent_fd)
            except OSError:
                pass
    finally:
        try:
            os.close(root_fd)
        except OSError:
            pass


def _walk_nofollow(root: Path):
    """Yield (rel_dir, dirnames, filenames) without following symlinks (B4).

    All directory opens use dir_fd + O_NOFOLLOW; symlinked dirs/files are
    reported so callers can reject (never descended/followed).
    """
    # Root itself is acquired through no-follow traversal (B4): only the
    # filesystem root is trusted; every component below it is verified.
    try:
        root_fd = _traverse_open(str(root), directory=True)
    except InvalidPath:
        raise InvalidPath(f"symlink or unreadable source root: {root}")
    stack: list[tuple[str, int]] = [("", root_fd)]
    try:
        while stack:
            rel, dfd = stack.pop()
            try:
                names = os.listdir(dfd)
            except OSError:
                raise InvalidPath(f"unreadable directory: {rel or '.'}")
            dirnames: list[str] = []
            filenames: list[str] = []
            for nm in names:
                try:
                    st = os.stat(nm, dir_fd=dfd, follow_symlinks=False)
                except OSError:
                    raise InvalidPath(f"vanished: {nm}")
                if stat.S_ISDIR(st.st_mode):
                    # Symlinks never have S_ISDIR with follow_symlinks=False
                    # (they are S_ISLNK), so this is a real dir.
                    dirnames.append(nm)
                elif stat.S_ISLNK(st.st_mode):
                    # Report symlink leaves under filenames so callers reject;
                    # symlink dirs are NOT descended.
                    # Distinguish by attempting dir open? Keep in dirnames as
                    # symlink marker? Simplest: put in dirnames with flag?
                    # We'll put symlink dirs in dirnames and let caller lstat.
                    # To keep os.walk-like shape, check: if symlink points to
                    # dir, os.walk would list in dirnames. Emulate: list symlinks
                    # that were dirs? We cannot know without following (forbidden).
                    # Report all symlinks as filenames for rejection.
                    filenames.append(nm)
                else:
                    filenames.append(nm)
            # Caller needs to know which dirnames are symlinks: re-lstat each.
            # Actually with follow_symlinks=False, S_ISDIR excludes symlinks,
            # so dirnames here are real dirs only. Symlink-to-dir appears in
            # filenames and will be rejected as symlink. Good.
            yield (rel, sorted(dirnames), sorted(filenames))
            # Push children (LIFO for DFS); open child fds now.
            for dn in reversed(sorted(dirnames)):
                try:
                    cfd = os.open(dn, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=dfd)
                except OSError:
                    raise InvalidPath(f"symlink in source path: {dn}")
                child_rel = f"{rel}/{dn}" if rel else dn
                stack.append((child_rel, cfd))
            # Do not close dfd here if it is still needed by caller for opens?
            # Caller copies needed names synchronously; we close non-root fds
            # after children are pushed? Children hold their own fds, so close.
            if rel != "":
                try:
                    os.close(dfd)
                except OSError:
                    pass
    finally:
        # Close any remaining fds (root always).
        for _, fd in stack:
            try:
                os.close(fd)
            except OSError:
                pass
        try:
            os.close(root_fd)
        except OSError:
            pass


def _open_source_nofollow(root: Path, rel: str) -> int:
    """Open root/rel with the root acquired by no-follow traversal (B4)."""
    try:
        root_fd = _traverse_open(str(root), directory=True)
    except InvalidPath:
        raise InvalidPath(f"symlink or unreadable source root: {root}")
    try:
        return _open_source_at(root_fd, rel)
    finally:
        try:
            os.close(root_fd)
        except OSError:
            pass


# ------------------------------------------------------------- transport

class HttpTransport(Protocol):
    def request(self, method: str, url: str, headers: dict[str, str],
                body: bytes | None) -> tuple[int, dict[str, str], bytes]:
        ...


class StdlibTransport:
    """Single-request stdlib transport (no redirect/auth logic; client handles it)."""

    def __init__(self, timeout: float = 30.0):
        self.timeout = timeout

    def request(self, method: str, url: str, headers: dict[str, str],
                body: bytes | None) -> tuple[int, dict[str, str], bytes]:
        # Validate URL shape/loopback/port before any socket use (sanitized).
        validate_url_before_network(url)
        parsed = urllib.parse.urlparse(url)
        host = parsed.hostname or ""
        try:
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
        except ValueError:
            raise InvalidUrl("invalid port")
        path = parsed.path or "/"
        if parsed.query:
            path += "?" + parsed.query
        conn_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        try:
            conn = conn_cls(host, port, timeout=self.timeout)
        except Exception:
            raise ManureError("unavailable", "connection failed")
        try:
            send_headers = dict(headers or {})
            data = body if body is not None else None
            try:
                conn.request(method.upper(), path, body=data, headers=send_headers)
                resp = conn.getresponse()
            except Exception:
                raise ManureError("unavailable", "network error")
            status = resp.status
            hdrs: dict[str, str] = {}
            raw = resp.getheaders()
            set_cookies: list[str] = []
            for k, v in raw:
                if k.lower() == "set-cookie":
                    set_cookies.append(v)
                if k not in hdrs:
                    hdrs[k] = v
            if set_cookies:
                hdrs["Set-Cookie"] = "; ".join(set_cookies) if len(set_cookies) == 1 else "\n".join(set_cookies)
            # Bounded read: enforce Content-Length pre-check then chunked cap
            # before any caller writes to disk.
            try:
                clen = resp.getheader("Content-Length")
            except Exception:
                clen = None
            if clen is not None:
                try:
                    if int(clen) > MAX_TRANSPORT_BYTES:
                        raise ManureError("too-large", "response too large")
                except ValueError:
                    pass
            chunks: list[bytes] = []
            remaining = MAX_TRANSPORT_BYTES + 1
            try:
                while True:
                    part = resp.read(min(65536, remaining))
                    if not part:
                        break
                    chunks.append(part)
                    remaining -= len(part)
                    if remaining <= 0:
                        raise ManureError("too-large", "response too large")
            except ManureError:
                raise
            except Exception:
                raise ManureError("unavailable", "response read failed")
            payload = b"".join(chunks)
            return (status, hdrs, payload)
        finally:
            try:
                conn.close()
            except Exception:
                pass


def _lower_headers(hdrs: dict[str, str]) -> dict[str, str]:
    return {k.lower(): v for k, v in (hdrs or {}).items()}


def _error_from_body(status: int, hdrs: dict[str, str], body: bytes) -> ManureError:
    code = "unknown"
    msg = f"http {status}"
    try:
        obj = json.loads(body.decode("utf-8") or "{}")
        err = obj.get("error", obj)
        if isinstance(err, dict):
            code = str(err.get("code", code))
            msg = str(err.get("message", msg))
    except Exception:
        try:
            msg = body[:200].decode("utf-8", "replace")
        except Exception:
            pass
    retry = _lower_headers(hdrs).get("retry-after")
    return ManureError(code, msg, http_status=status, retry_after=retry)


# ----------------------------------------------------------------- client


class ManureClient:
    def __init__(self, api_base: str, token: str | None = None,
                 token_file: str | None = None,
                 cache_dir: str | os.PathLike | None = None,
                 transport: HttpTransport | None = None):
        if not isinstance(api_base, str) or strip_secret_value(api_base) is None:
            raise MissingCredentials("missing api base url")
        base = strip_secret_value(api_base) or ""
        base = base.rstrip("/")
        # Defer loopback/https enforcement to request time so construction
        # never performs network and tests can assert zero-request failures.
        # Only validate URL shape here (scheme/host present).
        try:
            shaped = urllib.parse.urlparse(base)
        except Exception:
            raise InvalidUrl(f"malformed url: {base}")
        if shaped.scheme not in ("http", "https") or not shaped.hostname:
            raise InvalidUrl(f"bad api base: {base}")
        self.api_base: str = base
        self.api_origin: str = origin_of(base)
        # ambiguity without network; direct values exact (governor A1).
        if token is None or token == "":
            tok_direct = None
        elif not isinstance(token, str):
            raise ManureError("bad-envelope", "malformed credential")
        else:
            _validate_token_format(token)
            tok_direct = token
        tfile = str(token_file) if token_file is not None and str(token_file).strip() != "" else None
        if tok_direct is not None and tfile is not None:
            raise AmbiguousCredentials("token and token_file both set")
        if tfile is not None:
            resolved = read_token_file(tfile)
        else:
            resolved = tok_direct
        self._token: str | None = resolved
        if cache_dir is None:
            self.cache_dir = Path.home() / ".cache" / "manure"
        else:
            self.cache_dir = Path(cache_dir)
        self._transport: HttpTransport = transport if transport is not None else StdlibTransport()
        self._grants: dict[str, str] = {}

    # ------------------------------------------------- grants jar
    def _store_grant(self, host: str, cookie_header: str) -> None:
        h = host.lower()
        # cookie_header may be "name=value" or full "name=value; Path=/..."
        # Take first pair before ';' (unless header contains multiple cookies joined by \n)
        first_line = cookie_header.split("\n")[0]
        pair = first_line.split(";")[0].strip()
        if pair:
            self._grants[h] = pair

    def _grant_for(self, host: str) -> str | None:
        return self._grants.get(host.lower())

    # ------------------------------------------------- core request
    def _request(self, method: str, url: str,
                 headers: dict[str, str] | None = None,
                 body: bytes | None = None,
                 *, send_auth: bool = True, send_grant: bool = True,
                 origin: str | None = None) -> tuple[int, dict[str, str], bytes]:
        current_url = url
        current_method = method.upper()
        current_body = body
        current_headers = dict(headers or {})
        # origin for first request only; redirects re-derive? Keep explicit origin only for first.
        current_origin = origin
        for _ in range(MAX_REDIRECTS + 1):
            validate_url_before_network(current_url)
            parsed = urllib.parse.urlparse(current_url)
            req_headers = dict(current_headers)
            # auth: bearer ONLY to configured API origin
            if send_auth and self._token is not None:
                if origin_of(current_url) == self.api_origin:
                    req_headers["Authorization"] = f"Bearer {self._token}"
                # else: never send bearer cross-origin (drop)
            else:
                req_headers.pop("Authorization", None)
                # also drop case variants
                for k in list(req_headers):
                    if k.lower() == "authorization":
                        req_headers.pop(k, None)
            # grant: ONLY exact host
            host = (parsed.hostname or "").lower()
            if send_grant:
                g = self._grant_for(host)
                if g is not None:
                    req_headers["Cookie"] = g
                else:
                    req_headers.pop("Cookie", None)
                    for k in list(req_headers):
                        if k.lower() == "cookie":
                            req_headers.pop(k, None)
            else:
                for k in list(req_headers):
                    if k.lower() == "cookie":
                        req_headers.pop(k, None)
            if current_origin is not None:
                req_headers["Origin"] = current_origin
            else:
                for k in list(req_headers):
                    if k.lower() == "origin":
                        req_headers.pop(k, None)
            try:
                status, resp_hdrs, resp_body = self._transport.request(
                    current_method, current_url, req_headers, current_body)
            except ManureError:
                raise
            except Exception:
                # Never leak header/body material in transport faults.
                raise ManureError("unavailable", "network error")
            if status in (301, 302, 303, 307, 308):
                loc = _lower_headers(resp_hdrs).get("location")
                if not loc:
                    return (status, resp_hdrs, resp_body)
                nxt = urllib.parse.urljoin(current_url, loc)
                validate_url_before_network(nxt)
                # cross-origin? compare scheme+host+port (port access sanitized)
                old_p = urllib.parse.urlparse(current_url)
                new_p = urllib.parse.urlparse(nxt)
                try:
                    old_triple = (old_p.scheme, (old_p.hostname or "").lower(), old_p.port)
                    new_triple = (new_p.scheme, (new_p.hostname or "").lower(), new_p.port)
                except ValueError:
                    raise InvalidUrl("invalid port")
                cross = old_triple != new_triple
                if cross and current_body:
                    # B1: never replay credential-bearing bodies (unlock
                    # password, chunk bytes) to a cross-origin destination,
                    # even when headers would be dropped (307/308 preserve).
                    raise ManureError("forbidden", "refusing cross-origin redirect with body")
                if cross:
                    # ALWAYS drop credentials on cross-origin redirect
                    send_auth = False
                    send_grant = False
                    # remove auth/grant headers for next hop (handled at loop top via flags)
                # method rewrite
                if status == 303 or (status in (301, 302) and current_method == "POST"):
                    current_method = "GET"
                    current_body = None
                    # drop content headers
                    for k in list(current_headers):
                        if k.lower() in ("content-type", "content-length", "x-chunk-sha256"):
                            current_headers.pop(k, None)
                current_url = nxt
                current_origin = None  # never forward Origin across redirect
                # drop per-request Origin unless caller re-adds? Contract: credentials dropped;
                # Origin is a credentialed hint for POSTs; do not forward.
                continue
            return (status, resp_hdrs, resp_body)
        return (status, resp_hdrs, resp_body)

    def _api_request(self, method: str, path: str,
                     query: dict[str, str] | None = None,
                     body_json: Any | None = None,
                     body_bytes: bytes | None = None,
                     content_type: str | None = None,
                     extra_headers: dict[str, str] | None = None) -> Any:
        url = self.api_base + path
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers: dict[str, str] = {"Accept": "application/json"}
        body: bytes | None = None
        if body_json is not None:
            body = json.dumps(body_json).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif body_bytes is not None:
            body = body_bytes
            if content_type:
                headers["Content-Type"] = content_type
        if extra_headers:
            headers.update(extra_headers)
        status, resp_hdrs, resp_body = self._request(method, url, headers, body, send_auth=True)
        if 200 <= status < 300:
            if not resp_body:
                return {}
            try:
                return json.loads(resp_body.decode("utf-8"))
            except Exception:
                raise ManureError("bad-envelope", "non-JSON success body", http_status=status)
        raise _error_from_body(status, resp_hdrs, resp_body)

    # ------------------------------------------------- low-level API
    def _require_token(self) -> str:
        if self._token is None:
            raise MissingCredentials("missing api token")
        return self._token

    def whoami(self) -> dict[str, Any]:
        self._require_token()
        return self._api_request("GET", "/api/v1/whoami")

    def list_artifacts(self, limit: int | None = None, cursor: str | None = None,
                       include_expired: bool = False,
                       visibility: str | None = None, state: str | None = None) -> dict[str, Any]:
        self._require_token()
        q: dict[str, str] = {}
        if limit is not None:
            q["limit"] = str(limit)
        if cursor:
            q["cursor"] = cursor
        if include_expired:
            q["include_expired"] = "true"
        if visibility:
            q["visibility"] = visibility
        if state:
            q["state"] = state
        return self._api_request("GET", "/api/v1/artifacts", query=q or None)

    def get_artifact(self, artifact_id: str) -> dict[str, Any]:
        self._require_token()
        self._check_id(artifact_id)
        return self._api_request("GET", f"/api/v1/artifacts/{artifact_id}")

    def get_manifest(self, artifact_id: str) -> dict[str, Any]:
        self._check_id(artifact_id)
        # public anon allowed: send bearer only if we have one
        if self._token is None:
            # anon request: no auth header
            url = self.api_base + f"/api/v1/artifacts/{artifact_id}/files"
            status, hdrs, body = self._request("GET", url, {"Accept": "application/json"}, None,
                                               send_auth=False)
            if 200 <= status < 300:
                return json.loads(body.decode("utf-8"))
            raise _error_from_body(status, hdrs, body)
        return self._api_request("GET", f"/api/v1/artifacts/{artifact_id}/files")

    def get_upload_status(self, artifact_id: str) -> dict[str, Any]:
        self._require_token()
        self._check_id(artifact_id)
        return self._api_request("GET", f"/api/v1/artifacts/{artifact_id}/upload-status")

    def init_upload(self, name: str, kind: str, visibility: str,
                    entries: list[dict[str, Any]], expires_in_s: int | None = None) -> dict[str, Any]:
        self._require_token()
        if kind not in ("file", "dir"):
            raise InvalidManifest("bad kind")
        if visibility not in ("internal", "external", "public"):
            raise ManureError("invalid-visibility", "bad visibility")
        _validate_name(name)
        validate_manifest(entries, kind)
        body: dict[str, Any] = {"name": name, "kind": kind, "visibility": visibility, "files": entries}
        if expires_in_s is not None:
            body["expires_in_s"] = expires_in_s
        return self._api_request("POST", "/api/v1/artifacts:init", body_json=body)

    def put_chunk(self, artifact_id: str, path: str, offset: int, data: bytes) -> dict[str, Any]:
        self._require_token()
        self._check_id(artifact_id)
        if not isinstance(data, (bytes, bytearray)) or len(data) == 0 or len(data) > MAX_CHUNK_BYTES:
            raise ManureError("bad-envelope", "bad chunk length")
        if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
            raise ManureError("invalid-range", "bad offset")
        sha = hashlib.sha256(bytes(data)).hexdigest()
        q = {"path": path, "offset": str(offset)}
        url = self.api_base + f"/api/v1/artifacts/{artifact_id}/chunks?" + urllib.parse.urlencode(q)
        headers = {"Content-Type": "application/octet-stream", "Accept": "application/json",
                   "X-Chunk-Sha256": sha}
        status, resp_hdrs, resp_body = self._request("PUT", url, headers, data, send_auth=True)
        if 200 <= status < 300:
            try:
                return json.loads(resp_body.decode("utf-8"))
            except Exception:
                raise ManureError("bad-envelope", "non-JSON chunk ack", http_status=status)
        raise _error_from_body(status, resp_hdrs, resp_body)

    def publish(self, artifact_id: str) -> dict[str, Any]:
        self._require_token()
        self._check_id(artifact_id)
        return self._api_request("POST", f"/api/v1/artifacts/{artifact_id}/publish", body_json={})

    def delete(self, artifact_id: str) -> dict[str, Any]:
        self._require_token()
        self._check_id(artifact_id)
        return self._api_request("DELETE", f"/api/v1/artifacts/{artifact_id}")

    def rotate_password(self, artifact_id: str) -> dict[str, Any]:
        self._require_token()
        self._check_id(artifact_id)
        return self._api_request("POST", f"/api/v1/artifacts/{artifact_id}/external-password:rotate",
                                 body_json={})

    def patch_artifact(self, artifact_id: str, name: str | None = None,
                       visibility: str | None = None,
                       expires_in_s: Any = PATCH_OMIT) -> dict[str, Any]:
        """PATCH helper distinguishing omitted TTL from explicit null (clear).

        expires_in_s=PATCH_OMIT omits the key; None sends explicit null to
        clear; int/str is validated before network. name/visibility None omits.
        """
        self._require_token()
        self._check_id(artifact_id)
        body: dict[str, Any] = {}
        if name is not None:
            _validate_name(name)
            body["name"] = name
        if visibility is not None:
            if visibility not in ("internal", "external", "public"):
                raise ManureError("invalid-visibility", "bad visibility")
            body["visibility"] = visibility
        if expires_in_s is not PATCH_OMIT:
            if expires_in_s is None:
                body["expires_in_s"] = None
            else:
                body["expires_in_s"] = parse_expires_in(expires_in_s)
        return self._api_request("PATCH", f"/api/v1/artifacts/{artifact_id}", body_json=body)

    def create_grant(self, artifact_id: str) -> dict[str, Any]:
        self._require_token()
        self._check_id(artifact_id)
        return self._api_request("POST", f"/api/v1/artifacts/{artifact_id}/grants", body_json={})

    @staticmethod
    def _check_id(artifact_id: str) -> None:
        if not isinstance(artifact_id, str) or not ARTIFACT_ID_RE.match(artifact_id):
            raise ManureError("bad-envelope", f"bad artifact id: {artifact_id}")

    # ------------------------------------------------- cache
    def _uploads_dir(self) -> Path:
        d = self.cache_dir / "uploads"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _cache_path(self, artifact_id: str) -> Path:
        return self._uploads_dir() / f"{artifact_id}.json"

    def _write_cache(self, artifact_id: str, local_path: str, manifest_sha: str, access: str) -> None:
        rec = {"artifact_id": artifact_id, "api_base": self.api_base,
               "local_path": local_path, "manifest_sha256": manifest_sha, "access": access}
        tmp = self._cache_path(artifact_id).with_suffix(".tmp")
        tmp.write_text(json.dumps(rec, sort_keys=True, indent=2))
        os.replace(tmp, self._cache_path(artifact_id))

    def _read_cache(self, artifact_id: str) -> dict[str, Any] | None:
        p = self.cache_dir / "uploads" / f"{artifact_id}.json"
        if not p.exists():
            return None
        try:
            return json.loads(p.read_text())
        except Exception:
            return None

    def _find_matching_cache(self, local_path: str, manifest_sha: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        d = self.cache_dir / "uploads"
        if not d.is_dir():
            return out
        for f in sorted(d.glob("*.json")):
            try:
                rec = json.loads(f.read_text())
            except Exception:
                continue
            if (rec.get("api_base") == self.api_base and rec.get("local_path") == local_path
                    and rec.get("manifest_sha256") == manifest_sha):
                out.append(rec)
        return out

    def _delete_cache(self, artifact_id: str) -> None:
        try:
            (self.cache_dir / "uploads" / f"{artifact_id}.json").unlink(missing_ok=True)
        except Exception:
            pass

    # ------------------------------------------------- upload (high-level)
    def _server_manifest_entries(self, artifact_id: str) -> list[dict[str, Any]]:
        man = self.get_manifest(artifact_id)
        files = man.get("files", [])
        # Normalize to sorted entries for comparison (dir: path+kind only).
        norm: list[dict[str, Any]] = []
        for e in files:
            if not isinstance(e, dict):
                raise ManureError("bad-envelope", "bad manifest")
            if e.get("kind") == "dir":
                norm.append({"path": str(e.get("path")), "kind": "dir"})
            else:
                norm.append({"path": str(e.get("path")), "kind": "file",
                             "size": int(e.get("size", -1)), "sha256": str(e.get("sha256", ""))})
        return sorted(norm, key=lambda x: x["path"])

    def _resolve_resume_state(self, artifact_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        """Fetch status+info for a resume candidate (validates chunk_bytes)."""
        status = self.get_upload_status(artifact_id)
        chunk = status.get("chunk_bytes")
        try:
            chunk_bytes = _validate_chunk_bytes(int(chunk))  # type: ignore[arg-type]
        except Exception:
            raise ManureError("bad-envelope", "bad chunk_bytes")
        status["chunk_bytes"] = chunk_bytes
        try:
            info = self.get_artifact(artifact_id)
        except ManureError as e:
            raise e
        return (status, info)

    def _validate_resume_manifest(self, artifact_id: str, local_entries: list[dict[str, Any]],
                                  cached_sha: str | None) -> None:
        """Compare server manifest to cached/current before mutation/success (B5)."""
        server_entries = self._server_manifest_entries(artifact_id)
        server_sha = _manifest_sha256(server_entries)
        local_sha = _manifest_sha256(sorted(local_entries, key=lambda x: x["path"]))
        if cached_sha is not None and server_sha != cached_sha:
            raise SourceChanged("server manifest differs from cached session")
        if server_sha != local_sha:
            raise SourceChanged("server manifest differs from current source")

    def upload_path(self, local_path: str | os.PathLike, access: str,
                    name: str | None = None, expires_in_s: str | int | None = None,
                    resume_id: str | None = None, fresh: bool = False) -> dict[str, Any]:
        if access not in ("internal", "external", "public"):
            raise ManureError("invalid-visibility", "--access must be internal|external|public")
        exp: int | None = None
        if expires_in_s is not None:
            exp = parse_expires_in(expires_in_s)
        src = Path(local_path)
        if src.is_symlink():
            raise InvalidPath(f"symlink not allowed: {local_path}")
        if not src.exists():
            raise InvalidPath(f"not found: {local_path}")
        _validate_ancestors_no_symlink(src)
        kind, entries = build_manifest(src)
        msha = _manifest_sha256(entries)
        norm_local = str(src.resolve())
        if name is None:
            name = src.name or "artifact"
        # B4: pin the source root (or file parent) with O_NOFOLLOW BEFORE any
        # network; every subsequent read/hash goes through this fd, so ancestor
        # swaps after this point cannot redirect bytes.
        # Root acquired through no-follow traversal from `/` (B4) and retained.
        try:
            pin_fd = _traverse_open(str(src.parent if kind == "file" else src),
                                    directory=True)
        except InvalidPath:
            raise SourceChanged(f"source became symlink: {src}")
        try:
            # Pinned pre-mutation verification closes the build-vs-pin window.
            self._verify_pinned_against_manifest(kind, src, entries, pin_fd)
            artifact_id: str
            chunk_bytes: int
            generated_pw: str | None = None
            is_resume = False
            status: dict[str, Any] | None = None
            server_info: dict[str, Any] | None = None
            if fresh:
                init = self.init_upload(name, kind, access, entries, exp)
                artifact_id = str(init["artifact_id"])
                self._check_id(artifact_id)
                chunk_bytes = _validate_chunk_bytes(int(init["chunk_bytes"]))
                generated_pw = init.get("external_password")
                self._write_cache(artifact_id, norm_local, msha, access)
                status = None
            elif resume_id is not None:
                rec = self._read_cache(resume_id)
                if rec is None:
                    raise ManureError("not-found", f"no cache record for {resume_id}")
                if rec.get("api_base") != self.api_base or rec.get("local_path") != norm_local:
                    raise SourceChanged("cached session does not match api_base/local_path")
                if rec.get("manifest_sha256") != msha:
                    raise SourceChanged("source manifest changed since init")
                # B5: cached access must match the requested access before mutation.
                if rec.get("access") != access:
                    raise ManureError("invalid-visibility", "resume access mismatch")
                artifact_id = resume_id
                self._check_id(artifact_id)
                is_resume = True
                status, server_info = self._resolve_resume_state(artifact_id)
                # B5: requested access must match actual server visibility.
                actual_vis = str(server_info.get("visibility", ""))
                if actual_vis and actual_vis != access:
                    raise ManureError("invalid-visibility", "resume visibility mismatch")
                # B5: validate server manifest before any mutation/success.
                self._validate_resume_manifest(artifact_id, entries, str(rec.get("manifest_sha256")))
                # B5: handle terminal states without invalid chunk PUTs.
                state = str(status.get("state", ""))
                if state == "ready":
                    result = self._checked_result(server_info, generated_pw, is_resume)
                    self._delete_cache(artifact_id)
                    return result
                if state == "publishing":
                    outcome = self._wait_for_publish(artifact_id)
                    if outcome is None:
                        # Recovered to uploading: refresh resumable status (never
                        # report success/retire for this contract recovery state).
                        status = self.get_upload_status(artifact_id)
                        if str(status.get("state")) != "uploading":
                            raise ManureError("state-conflict", "publish in progress")
                        chunk_bytes = _validate_chunk_bytes(int(status["chunk_bytes"]))
                    else:
                        result = self._checked_result(outcome, generated_pw, is_resume)
                        self._delete_cache(artifact_id)
                        return result
                else:
                    chunk_bytes = _validate_chunk_bytes(int(status["chunk_bytes"]))
            else:
                matches = self._find_matching_cache(norm_local, msha)
                status = None
                server_info = None
                if len(matches) == 1:
                    # B5: cached access must match requested before any mutation.
                    if str(matches[0].get("access", "")) != access:
                        raise ManureError("invalid-visibility", "resume access mismatch")
                    cand = str(matches[0]["artifact_id"])
                    self._check_id(cand)
                    st, info = self._resolve_resume_state(cand)
                    actual_vis = str(info.get("visibility", ""))
                    if actual_vis and actual_vis != access:
                        raise ManureError("invalid-visibility", "resume visibility mismatch")
                    self._validate_resume_manifest(cand, entries, str(matches[0].get("manifest_sha256")))
                    state = str(st.get("state", ""))
                    if state == "ready":
                        result = self._checked_result(info, None, True)
                        self._delete_cache(cand)
                        return result
                    if state == "publishing":
                        outcome = self._wait_for_publish(cand)
                        if outcome is not None:
                            result = self._checked_result(outcome, None, True)
                            self._delete_cache(cand)
                            return result
                        # Recovered to uploading: refresh and resume (no success/retire).
                        st = self.get_upload_status(cand)
                        if str(st.get("state")) != "uploading":
                            raise ManureError("state-conflict", "publish in progress")
                        artifact_id = cand
                        status = st
                        server_info = info
                        chunk_bytes = _validate_chunk_bytes(int(st["chunk_bytes"]))
                        is_resume = True
                    elif state == "uploading":
                        artifact_id = cand
                        status = st
                        server_info = info
                        chunk_bytes = _validate_chunk_bytes(int(st["chunk_bytes"]))
                        is_resume = True
                    else:
                        raise ManureError("state-conflict", "unexpected upload state")
                if status is None and not is_resume:
                    init = self.init_upload(name, kind, access, entries, exp)
                    artifact_id = str(init["artifact_id"])
                    self._check_id(artifact_id)
                    chunk_bytes = _validate_chunk_bytes(int(init["chunk_bytes"]))
                    generated_pw = init.get("external_password")
                    self._write_cache(artifact_id, norm_local, msha, access)
                    status = None
                    server_info = None
            # build received map
            received: dict[str, list[list[int]]] = {}
            if status is not None:
                for f in status.get("files", []):
                    received[str(f["path"])] = [list(r) for r in f.get("received_ranges", [])]
            # send missing chunks
            for entry in entries:
                if entry["kind"] != "file":
                    continue
                rel = str(entry["path"])
                size = int(entry["size"])
                ranges = received.get(rel, [])
                for offset, length in self._missing_chunks(size, chunk_bytes, ranges):
                    data = self._read_chunk(src, kind, rel, offset, length, entry,
                                            root_fd=pin_fd)
                    self.put_chunk(artifact_id, rel, offset, data)
            # B4: pinned pre-publish verification through the retained root fd.
            self._verify_pinned_against_manifest(kind, src, entries, pin_fd)
            last_err: ManureError | None = None
            for _ in range(5):
                try:
                    self.publish(artifact_id)
                    last_err = None
                    break
                except ManureError as e:
                    if e.code == "state-conflict":
                        time.sleep(0.2)
                        last_err = e
                        try:
                            st = self.get_upload_status(artifact_id)
                            if str(st.get("state")) == "ready":
                                last_err = None
                                break
                        except Exception:
                            pass
                        continue
                    raise
            if last_err is not None:
                raise last_err
            info = self.get_artifact(artifact_id)
            result = self._checked_result(info, generated_pw, is_resume)
            # B5: retire completed records so stale successes never obstruct auto-resume.
            self._delete_cache(artifact_id)
            return result
        finally:
            try:
                os.close(pin_fd)
            except OSError:
                pass


    def _wait_for_publish(self, artifact_id: str) -> dict[str, Any] | None:
        """Wait for a publishing session; ready->info, uploading->None (recover).

        Returns authoritative ready info only for ready. Returns None when the
        session recovered to uploading (caller must continue uploading, never
        report success/retire). Raises while still publishing.
        """
        for _ in range(10):
            try:
                st = self.get_upload_status(artifact_id)
            except ManureError:
                time.sleep(0.2)
                continue
            state = str(st.get("state", ""))
            if state == "ready":
                return self.get_artifact(artifact_id)
            if state == "uploading":
                return None
            time.sleep(0.2)
        st = self.get_upload_status(artifact_id)
        if str(st.get("state")) == "ready":
            return self.get_artifact(artifact_id)
        if str(st.get("state")) == "uploading":
            return None
        raise ManureError("state-conflict", "publish in progress")

    def _checked_result(self, info: dict[str, Any],
                          generated_pw: str | None, is_resume: bool) -> dict[str, Any]:
        # Central terminal ready guard (A3/B5): no success path reports for a
        # contradictory non-ready summary, and the cache is retired by callers
        # only alongside this checked result.
        if not isinstance(info, dict) or str(info.get("state", "")) != "ready":
            raise ManureError("state-conflict", "publish did not complete")
        return self._upload_result(info, generated_pw, is_resume)

    def _upload_result(self, info: dict[str, Any],
                       generated_pw: str | None, is_resume: bool) -> dict[str, Any]:
        # B5: report actual server visibility, never the requested access.
        actual = str(info.get("visibility", ""))
        out: dict[str, Any] = {
            "artifact_id": info.get("artifact_id"),
            "content_url": info.get("content_url"),
            "access": actual,
            "expires_at": info.get("expires_at"),
        }
        if actual == "external":
            if generated_pw is not None:
                out["external_password"] = generated_pw
            else:
                out["external_password"] = None
                out["password_note"] = "rotate-password to re-issue"
        return out

    @staticmethod
    def _missing_chunks(size: int, chunk_bytes: int,
                        received_ranges: list[list[int]]) -> list[tuple[int, int]]:
        _validate_chunk_bytes(chunk_bytes)
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise InvalidManifest("bad size")
        if size == 0:
            return []
        # normalize ranges
        cov: list[tuple[int, int]] = []
        for r in received_ranges or []:
            try:
                cov.append((int(r[0]), int(r[1])))
            except Exception:
                continue

        def covered(s: int, e: int) -> bool:
            for a, b in cov:
                if a <= s and e <= b:
                    return True
            return False

        out: list[tuple[int, int]] = []
        off = 0
        while off < size:
            ln = min(chunk_bytes, size - off)
            if not covered(off, off + ln):
                out.append((off, ln))
            off += ln
        return out

    @staticmethod
    def _fingerprint_sources(src: Path, kind: str, entries: list[dict[str, Any]]) -> dict[str, tuple[int, float]]:
        fp: dict[str, tuple[int, float]] = {}
        if kind == "file":
            st = src.stat()
            fp[entries[0]["path"]] = (st.st_size, st.st_mtime_ns)
        else:
            for e in entries:
                if e["kind"] != "file":
                    continue
                full = src / e["path"]
                if full.is_symlink():
                    raise InvalidPath(f"symlink not allowed: {e['path']}")
                try:
                    st = os.lstat(str(full))
                except FileNotFoundError:
                    raise SourceChanged(f"source vanished: {e['path']}")
                if not stat.S_ISREG(st.st_mode):
                    raise InvalidPath(f"not a regular file: {e['path']}")
                fp[e["path"]] = (st.st_size, st.st_mtime_ns)
        return fp

    def _verify_sources_unchanged(self, src: Path, kind: str, entries: list[dict[str, Any]],
                                  fp: dict[str, tuple[int, float]]) -> None:
        for e in entries:
            if e["kind"] != "file":
                continue
            rel = e["path"]
            full = src if kind == "file" else src / rel
            if full.is_symlink():
                raise SourceChanged(f"source became symlink: {rel}")
            try:
                st = os.lstat(str(full))
            except FileNotFoundError:
                raise SourceChanged(f"source vanished: {rel}")
            if not stat.S_ISREG(st.st_mode):
                raise SourceChanged(f"source not regular: {rel}")
            old = fp.get(rel)
            if old is None or (st.st_size, st.st_mtime_ns) != old:
                # mtime/size changed; re-hash to confirm (mtime granularity safety)
                _, new_sha = _hash_file(full)
                if new_sha != e["sha256"] or st.st_size != int(e["size"]):
                    raise SourceChanged(f"source changed during upload: {rel}")
            else:
                # even if stat matches, re-hash when size small? For safety re-hash all
                # but avoid double IO for large trees when mtime matches? Contract demands
                # integrity on source changes during hash/send: stat match is sufficient
                # unless filesystem granularity hides it; do a full re-hash check.
                _, new_sha = _hash_file(full)
                if new_sha != e["sha256"]:
                    raise SourceChanged(f"source changed during upload: {rel}")

    def _pinned_hash(self, kind: str, src: Path, rel: str, root_fd: int) -> tuple[int, str]:
        if kind == "file":
            try:
                fd = os.open(src.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
            except OSError:
                raise SourceChanged(f"source became symlink: {rel}")
        else:
            fd = _open_source_at(root_fd, rel)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode):
                raise SourceChanged(f"source not regular: {rel}")
            return _hash_fd(fd)
        finally:
            try:
                os.close(fd)
            except OSError:
                pass

    def _verify_pinned_against_manifest(self, kind: str, src: Path,
                                        entries: list[dict[str, Any]], root_fd: int) -> None:
        """Hash pinned sources via retained root fd; abort on any mismatch (B4)."""
        for e in entries:
            if e["kind"] != "file":
                continue
            rel = str(e["path"])
            size, sha = self._pinned_hash(kind, src, rel, root_fd)
            if size != int(e["size"]) or sha != str(e["sha256"]):
                raise SourceChanged(f"source changed during upload: {rel}")

    def _read_chunk(self, src: Path, kind: str, rel: str, offset: int, length: int,
                    entry: dict[str, Any], root_fd: int | None = None) -> bytes:
        # B4: pinned-fd reads when available (no ancestor followed after pin).
        if root_fd is not None:
            if kind == "file":
                try:
                    fd = os.open(src.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_fd)
                except OSError:
                    raise SourceChanged(f"source became symlink: {rel}")
            else:
                fd = _open_source_at(root_fd, rel)
            try:
                st = os.fstat(fd)
                if not stat.S_ISREG(st.st_mode):
                    raise SourceChanged(f"source not regular: {rel}")
                if st.st_size != int(entry["size"]):
                    raise SourceChanged(f"source changed during send: {rel}")
                os.lseek(fd, offset, os.SEEK_SET)
                chunks: list[bytes] = []
                remaining = length
                while remaining > 0:
                    part = os.read(fd, min(65536, remaining))
                    if not part:
                        break
                    chunks.append(part)
                    remaining -= len(part)
                data = b"".join(chunks)
            finally:
                try:
                    os.close(fd)
                except OSError:
                    pass
            if len(data) != length:
                raise SourceChanged(f"source changed during send: {rel}")
            return data
        # B4: open without following symlinked parents/leaf; verify regular.
        if kind == "file":
            if src.is_symlink():
                raise SourceChanged(f"source became symlink: {rel}")
            # Descriptor-rooted parent traversal (B4 single-file parent swap).
            try:
                parent_fd = _traverse_open(str(src.parent), directory=True)
            except InvalidPath:
                raise SourceChanged(f"source became symlink: {rel}")
            try:
                try:
                    fd = os.open(src.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
                except OSError:
                    raise SourceChanged(f"source became symlink: {rel}")
                try:
                    st0 = os.fstat(fd)
                except OSError:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
                    raise SourceChanged(f"source unreadable: {rel}")
                if not stat.S_ISREG(st0.st_mode):
                    try:
                        os.close(fd)
                    except OSError:
                        pass
                    raise SourceChanged(f"source not regular: {rel}")
            finally:
                try:
                    os.close(parent_fd)
                except OSError:
                    pass
            try:
                st = os.fstat(fd)
                if st.st_size != int(entry["size"]):
                    raise SourceChanged(f"source changed during send: {rel}")
                os.lseek(fd, offset, os.SEEK_SET)
                chunks: list[bytes] = []
                remaining = length
                while remaining > 0:
                    part = os.read(fd, min(65536, remaining))
                    if not part:
                        break
                    chunks.append(part)
                    remaining -= len(part)
                data = b"".join(chunks)
            finally:
                try:
                    os.close(fd)
                except OSError:
                    pass
        else:
            fd = _open_source_nofollow(src, rel)
            try:
                st = os.fstat(fd)
                if st.st_size != int(entry["size"]):
                    raise SourceChanged(f"source changed during send: {rel}")
                os.lseek(fd, offset, os.SEEK_SET)
                chunks = []
                remaining = length
                while remaining > 0:
                    part = os.read(fd, min(65536, remaining))
                    if not part:
                        break
                    chunks.append(part)
                    remaining -= len(part)
                data = b"".join(chunks)
            finally:
                try:
                    os.close(fd)
                except OSError:
                    pass
        if len(data) != length:
            raise SourceChanged(f"source changed during send: {rel}")
        # Verify opened file still matches manifest hash prefix? Full re-hash is
        # done pre-publish; here verify chunk hash will be checked server-side.
        return data

    # ------------------------------------------------- fetch (high-level)
    def fetch_to_dest(self, artifact_id_or_url: str, dest: str | os.PathLike,
                      password: str | None = None) -> dict[str, Any]:
        s = str(artifact_id_or_url)
        if "://" in s:
            return self._fetch_via_content(s, Path(dest), password)
        return self._fetch_via_api(s, Path(dest))

    # ----- api fetch
    def _fetch_via_api(self, artifact_id: str, dest: Path) -> dict[str, Any]:
        self._check_id(artifact_id)
        manifest = self.get_manifest(artifact_id)
        files = manifest.get("files", [])
        validate_fetch_manifest(files)
        self._check_fetch_bounds(files)
        # B4: validate ancestors BEFORE any creation, including empty-root.
        _validate_ancestors_no_symlink(dest)
        _mkdir_p_nofollow(dest)
        _validate_ancestors_no_symlink(dest)
        try:
            if dest.is_symlink():
                raise InvalidPath("dest is a symlink")
        except OSError:
            raise InvalidPath("dest unreadable")
        if dest.is_file():
            raise InvalidPath("dest is a file")
        staging_dir = self._choose_staging_dir(dest, artifact_id, files)
        for e in files:
            if e["kind"] == "dir":
                _mkdir_p_nofollow(dest / str(e["path"]))
        total = 0
        count = 0
        try:
            for e in files:
                if e["kind"] != "file":
                    continue
                rel = str(e["path"])
                final = dest / rel
                self._download_api_file(artifact_id, rel, final, int(e["size"]), str(e["sha256"]),
                                        staging_dir)
                total += int(e["size"])
                count += 1
        except Exception:
            # Preserve owned partial staging for resume; do not cleanup here.
            raise
        self._cleanup_staging_dir(staging_dir, artifact_id, files)
        return {"artifact_id": artifact_id, "dest": str(dest), "file_count": count, "total_bytes": total}

    def _download_api_file(self, artifact_id: str, rel: str, final: Path,
                           size: int, sha: str, staging_dir: Path | None = None) -> None:
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise InvalidManifest("bad size")
        if not isinstance(sha, str) or not SHA256_RE.match(sha):
            raise InvalidManifest("bad sha")
        # B4: descriptor-rooted classification+hash (no ancestor followed
        # after pin; swap fails closed, ZERO outside reads).
        if _existing_final_matches(final, size, sha):
            return
        enc = "/".join(urllib.parse.quote(seg, safe="") for seg in rel.split("/"))
        url = self.api_base + f"/api/v1/artifacts/{artifact_id}/files/{enc}/content"
        self._ranged_download(url, final, size, sha, grant_host=None, is_content=False,
                              artifact_id=artifact_id, rel=rel, staging_dir=staging_dir)

    # ----- content fetch
    def _fetch_via_content(self, content_url: str, dest: Path, password: str | None) -> dict[str, Any]:
        parsed = validate_url_before_network(content_url)
        host = (parsed.hostname or "").lower()
        content_origin = _origin_from_parsed(parsed)
        first_label = host.split(".")[0] if "." in host else host
        if password is not None:
            if password == "":
                raise MissingCredentials("empty external password")
            _validate_token_format(password)
            pw = password
            unlock_url = content_origin + "/__manure/unlock"
            body = json.dumps({"password": pw}).encode()
            try:
                status, hdrs, resp = self._request("POST", unlock_url,
                                                   {"Content-Type": "application/json",
                                                    "Accept": "application/json"},
                                                   body, send_auth=False, send_grant=False,
                                                   origin=content_origin)
            except ManureError:
                raise
            except Exception:
                raise ManureError("unavailable", "network error")
            if status != 200:
                raise _error_from_body(status, hdrs, resp)
            sc = _lower_headers(hdrs).get("set-cookie")
            if sc:
                for line in sc.split("\n"):
                    if "mgrant" in line.lower():
                        self._store_grant(host, line)
                        break
                else:
                    self._store_grant(host, sc)
        man_url = content_origin + "/__manure/manifest"
        try:
            status, hdrs, body = self._request("GET", man_url, {"Accept": "application/json"}, None,
                                               send_auth=False, send_grant=True, origin=None)
        except ManureError:
            raise
        except Exception:
            raise ManureError("unavailable", "network error")
        if status != 200:
            raise _error_from_body(status, hdrs, body)
        if len(body) > MAX_TRANSPORT_BYTES:
            raise ManureError("too-large", "manifest too large")
        try:
            manifest = json.loads(body.decode("utf-8"))
        except Exception:
            raise ManureError("bad-envelope", "non-JSON manifest", http_status=status)
        artifact_id = str(manifest.get("artifact_id") or first_label)
        if not ARTIFACT_ID_RE.match(artifact_id):
            raise ManureError("bad-envelope", "bad artifact id in manifest")
        files = manifest.get("files", [])
        validate_fetch_manifest(files)
        self._check_fetch_bounds(files)
        _validate_ancestors_no_symlink(dest)
        _mkdir_p_nofollow(dest)
        _validate_ancestors_no_symlink(dest)
        try:
            if dest.is_symlink():
                raise InvalidPath("dest is a symlink")
        except OSError:
            raise InvalidPath("dest unreadable")
        staging_dir = self._choose_staging_dir(dest, artifact_id, files)
        for e in files:
            if e["kind"] == "dir":
                _mkdir_p_nofollow(dest / str(e["path"]))
        total = 0
        count = 0
        try:
            for e in files:
                if e["kind"] != "file":
                    continue
                rel = str(e["path"])
                final = dest / rel
                enc = "/".join(urllib.parse.quote(seg, safe="") for seg in rel.split("/"))
                url = content_origin + f"/__manure/files/{enc}/content"
                self._ranged_download(url, final, int(e["size"]), str(e["sha256"]),
                                      grant_host=host, is_content=True,
                                      artifact_id=artifact_id, rel=rel, staging_dir=staging_dir)
                total += int(e["size"])
                count += 1
        except Exception:
            raise
        self._cleanup_staging_dir(staging_dir, artifact_id, files)
        return {"artifact_id": artifact_id, "dest": str(dest), "file_count": count, "total_bytes": total}

    @staticmethod
    def _check_fetch_bounds(files: list[dict[str, Any]]) -> None:
        total = 0
        for e in files:
            if e.get("kind") != "file":
                continue
            sz = e.get("size")
            if isinstance(sz, bool) or not isinstance(sz, int) or sz < 0:
                raise InvalidManifest("bad size")
            if sz > MAX_FILE_BYTES:
                raise ManureError("too-large", f"file too large: {e.get('path')}")
            total += sz
            if total > MAX_ARTIFACT_BYTES:
                raise ManureError("too-large", "artifact exceeds max_artifact_bytes")

    @staticmethod
    def _ensure_parent_no_symlink(final: Path) -> None:
        _validate_ancestors_no_symlink(final.parent)
        _mkdir_p_nofollow(final.parent)
        _validate_ancestors_no_symlink(final.parent)
        if final.parent.is_symlink():
            raise InvalidPath("symlink in dest path")

    @staticmethod
    def _refuse_symlink_final(final: Path) -> None:
        try:
            if final.is_symlink():
                raise InvalidPath(f"refusing to overwrite symlink: {final}")
        except OSError:
            raise InvalidPath(f"unreadable path: {final}")

    @staticmethod
    def _safe_mkdir(d: Path) -> None:
        _validate_ancestors_no_symlink(d.parent if str(d) != str(d.parent) else d)
        _mkdir_p_nofollow(d)
        try:
            if d.is_symlink():
                raise InvalidPath(f"symlink in path: {d}")
            if d.is_file():
                raise InvalidPath(f"file blocks directory: {d}")
        except OSError:
            raise InvalidPath(f"unreadable path: {d}")

    def _cleanup_staging_dir(self, staging_dir: Path | None,
                               artifact_id: str | None = None,
                               files: list[dict[str, Any]] | None = None) -> None:
        # B3: top level only (never descend into subdirectories), and only
        # binding-verified entries: a `*.part` goes away solely with a sibling
        # sidecar bound to this artifact; sidecars go away solely on matching
        # binding; `*.tmp` goes away solely with this process's PID suffix
        # (our own claim tmps). Anything else — including corrupt sidecars,
        # foreign bindings, and whole subdirectories — is preserved, as is a
        # non-empty namespace dir itself.
        # B4: parent fd retained for the whole cleanup; namespace opened
        # relative to it; final removal is descriptor-relative with identity
        # checks (never pathname rmdir). Swap AFTER acquisition BEFORE rmdir
        # fails closed with InvalidPath, preserving OUTSIDE (ZERO outside
        # reads: listing/unlinks go through retained fds only).
        if staging_dir is None:
            return
        if "/" in staging_dir.name or staging_dir.name in ("", ".", ".."):
            raise InvalidPath("staging changed")
        # Fail closed: the namespace existed when chosen; absence now means
        # tampering (e.g. an ancestor swap redirecting the open).
        try:
            parent_fd = _traverse_open(str(staging_dir.parent), directory=True)
        except InvalidPath:
            raise InvalidPath("staging changed")
        try:
            try:
                ns_fd = os.open(staging_dir.name,
                                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=parent_fd)
            except OSError:
                raise InvalidPath("staging changed")
            try:
                try:
                    ns_st0 = os.fstat(ns_fd)
                except OSError:
                    raise InvalidPath("staging changed")
                if not stat.S_ISDIR(ns_st0.st_mode):
                    raise InvalidPath("staging changed")
                try:
                    names = os.listdir(ns_fd)
                except OSError:
                    return
                pid_tmp_suffix = f".{os.getpid()}.tmp"
                for nm in names:
                    if nm == ".manure-owner.json":
                        continue
                    try:
                        fst = os.stat(nm, dir_fd=ns_fd, follow_symlinks=False)
                    except OSError:
                        continue
                    if stat.S_ISDIR(fst.st_mode):
                        continue  # never descend unowned subdirectories
                    if not stat.S_ISREG(fst.st_mode):
                        continue
                    if nm.endswith(".tmp"):
                        # PID suffix alone is NOT ownership (B3): unlink solely a
                        # tmp whose persisted content binds it to this transfer.
                        if artifact_id is not None and nm.endswith(pid_tmp_suffix) \
                                and self._sidecar_bound(ns_fd, nm, artifact_id, files):
                            try:
                                os.unlink(nm, dir_fd=ns_fd)
                            except OSError:
                                pass
                        continue
                    if nm.endswith(".part.json"):
                        if self._sidecar_bound(ns_fd, nm, artifact_id, files):
                            try:
                                os.unlink(nm, dir_fd=ns_fd)
                            except OSError:
                                pass
                        continue
                    if nm.endswith(".part"):
                        if self._sidecar_bound(ns_fd, nm + ".json", artifact_id, files):
                            try:
                                os.unlink(nm, dir_fd=ns_fd)
                            except OSError:
                                pass
                        continue
                if artifact_id is not None:
                    try:
                        ofd = os.open(".manure-owner.json", os.O_RDONLY | os.O_NOFOLLOW,
                                      dir_fd=ns_fd)
                    except OSError:
                        ofd = None
                    if ofd is not None:
                        try:
                            raw = b""
                            while True:
                                blk = os.read(ofd, 65536)
                                if not blk:
                                    break
                                raw += blk
                            if json.loads(raw.decode("utf-8")).get("artifact_id") != artifact_id:
                                return
                        except (OSError, ValueError):
                            return
                        finally:
                            try:
                                os.close(ofd)
                            except OSError:
                                pass
                        try:
                            os.unlink(".manure-owner.json", dir_fd=ns_fd)
                        except OSError:
                            pass
                # Identity checks BEFORE descriptor-relative removal.
                try:
                    ns_st = os.fstat(ns_fd)
                    cur_st = os.stat(staging_dir.name, dir_fd=parent_fd,
                                      follow_symlinks=False)
                except OSError:
                    raise InvalidPath("staging changed")
                if (stat.S_ISLNK(cur_st.st_mode)
                        or not stat.S_ISDIR(cur_st.st_mode)
                        or (ns_st.st_dev, ns_st.st_ino) != (cur_st.st_dev, cur_st.st_ino)):
                    raise InvalidPath("staging changed")
                _verify_parent_pinned(parent_fd, staging_dir.parent)
                try:
                    os.rmdir(staging_dir.name, dir_fd=parent_fd)
                except OSError:
                    pass
            finally:
                try:
                    os.close(ns_fd)
                except OSError:
                    pass
        finally:
            try:
                os.close(parent_fd)
            except OSError:
                pass

    @staticmethod
    def _sidecar_bound(ns_fd: int, sidecar_rel: str, artifact_id: str | None,
                       files: list[dict[str, Any]] | None = None) -> bool:
        # Full per-file binding (B3): artifact match AND, when the manifest is
        # supplied, an entry with identical path/size/sha256. Artifact-only or
        # partial metadata never establishes ownership.
        if not artifact_id:
            return False
        try:
            cfd = os.open(sidecar_rel, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=ns_fd)
        except OSError:
            return False
        try:
            raw = b""
            while True:
                blk = os.read(cfd, 65536)
                if not blk:
                    break
                raw += blk
                if len(raw) > 4096:
                    break
            bound = json.loads(raw.decode("utf-8"))
        except (OSError, ValueError):
            return False
        finally:
            try:
                os.close(cfd)
            except OSError:
                pass
        if not isinstance(bound, dict) or bound.get("artifact_id") != artifact_id:
            return False
        if files is None:
            # No manifest context: only the artifact binding is checkable.
            return True
        for e in files:
            if e.get("kind") != "file":
                continue
            if (str(e.get("path")) == str(bound.get("path"))
                    and e.get("size") == bound.get("size")
                    and str(e.get("sha256")) == str(bound.get("sha256"))):
                return True
        return False

    @staticmethod
    def _namespace_blocked(name: str, rels: set[str], dir_comps: set[str]) -> bool:
        if name in rels or name in dir_comps:
            return True
        for r in rels:
            if r == name or r.startswith(name + "/"):
                return True
        return False

    def _choose_staging_dir(self, dest: Path, artifact_id: str,
                              files: list[dict[str, Any]]) -> Path | None:
        """Exclusively-owned staging namespace (B3/B4).

        Returns None when no file payloads exist (empty manifests never create
        or delete anything). Otherwise allocates dest/.manure-stage-<aid12>[.N]
        with every candidate validated against all manifest rels, directory
        components, and prefix collisions. `dest` itself is held open through
        no-follow traversal for the whole allocation, and every candidate
        mkdir/stat/owner open is descriptor-relative to it: ancestor swaps
        after validation cannot redirect the namespace. A pre-existing
        directory is reused only when its `.manure-owner.json` binds it to
        this artifact; anything else is disambiguated, never adopted,
        replaced, or deleted.
        """
        if not any(e.get("kind") == "file" for e in files):
            return None
        rels = {str(e.get("path", "")) for e in files}
        dir_comps: set[str] = set()
        for r in rels:
            parts = r.split("/") if r else []
            for i in range(1, len(parts)):
                dir_comps.add("/".join(parts[:i]))
        base = f".manure-stage-{artifact_id[:12]}"
        try:
            dest_fd = _traverse_open(str(dest), directory=True)
        except InvalidPath:
            raise InvalidPath("symlink in dest path")
        try:
            counter = 0
            cand_name = base
            while True:
                if counter > 100:
                    raise InvalidPath("staging collision")
                if self._namespace_blocked(cand_name, rels, dir_comps):
                    counter += 1
                    cand_name = f"{base}.{counter}"
                    continue
                try:
                    os.mkdir(cand_name, 0o700, dir_fd=dest_fd)
                except FileExistsError:
                    pass
                except OSError:
                    raise InvalidPath("cannot claim staging namespace")
                else:
                    # Fresh directory: claim with an exclusive owner file.
                    claimed = False
                    try:
                        nfd = os.open(cand_name,
                                      os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                      dir_fd=dest_fd)
                    except OSError:
                        pass
                    else:
                        try:
                            owner_fd = os.open(".manure-owner.json",
                                               os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                               0o600, dir_fd=nfd)
                            try:
                                payload = json.dumps({"artifact_id": artifact_id},
                                                     sort_keys=True).encode()
                                off = 0
                                while off < len(payload):
                                    off += os.write(owner_fd, payload[off:])
                                os.fsync(owner_fd)
                            finally:
                                try:
                                    os.close(owner_fd)
                                except OSError:
                                    pass
                            claimed = True
                        except OSError:
                            claimed = False
                        finally:
                            try:
                                os.close(nfd)
                            except OSError:
                                pass
                    # Re-verify the binding we just wrote.
                    if claimed and self._namespace_owned(dest_fd, cand_name, artifact_id):
                        return dest / cand_name
                    # Fresh dir we cannot bind: remove if still empty, move on.
                    try:
                        self._rmdir_at(dest_fd, cand_name)
                    except OSError:
                        pass
                    counter += 1
                    cand_name = f"{base}.{counter}"
                    continue
                # Pre-existing entry: stat without following, relative to dest.
                try:
                    st = os.stat(cand_name, dir_fd=dest_fd, follow_symlinks=False)
                except OSError:
                    raise InvalidPath("cannot claim staging namespace")
                if not stat.S_ISDIR(st.st_mode):
                    counter += 1
                    cand_name = f"{base}.{counter}"
                    continue
                if self._namespace_owned(dest_fd, cand_name, artifact_id):
                    return dest / cand_name
                counter += 1
                cand_name = f"{base}.{counter}"
        finally:
            try:
                os.close(dest_fd)
            except OSError:
                pass

    @staticmethod
    def _namespace_owned(dest_fd: int, cand_name: str, artifact_id: str) -> bool:
        try:
            nfd = os.open(cand_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                          dir_fd=dest_fd)
        except OSError:
            return False
        try:
            try:
                ofd = os.open(".manure-owner.json", os.O_RDONLY | os.O_NOFOLLOW,
                              dir_fd=nfd)
            except OSError:
                return False
            try:
                raw = b""
                while True:
                    blk = os.read(ofd, 65536)
                    if not blk:
                        break
                    raw += blk
                    if len(raw) > 4096:
                        break
                return json.loads(raw.decode("utf-8")).get("artifact_id") == artifact_id
            except (OSError, ValueError):
                return False
            finally:
                try:
                    os.close(ofd)
                except OSError:
                    pass
        finally:
            try:
                os.close(nfd)
            except OSError:
                pass

    @staticmethod
    def _rmdir_at(base_fd: int, name: str) -> None:
        os.rmdir(name, dir_fd=base_fd)

    def _staging_paths(self, staging_dir: Path, rel: str, sha: str) -> tuple[Path, Path]:
        """Bounded per-file staging/sidecar flat in the namespace (B3/B11).

        The filename is derived from the full rel + binding hash
        (`st-<pathhash16>-<sha8>.part`, well under NAME_MAX); the original
        rel is retained in the sidecar for the binding check. The namespace
        dir itself is disjoint from the manifest, so no staging path can
        equal a payload path, and lossy flattening collisions are impossible.
        Flat layout keeps every metadata open a single dir-fd-relative step.
        """
        digest = hashlib.sha256(f"{rel}\0{sha}".encode("utf-8")).hexdigest()[:16]
        base = f"st-{digest}-{sha[:8]}.part"
        staging = staging_dir / base
        sidecar = staging_dir / (base + ".json")
        return (staging, sidecar)

    @staticmethod
    def _parse_content_range(value: str | None, want_start: int, want_size: int) -> tuple[int, int, int]:
        if not value or not isinstance(value, str):
            raise ManureError("bad-envelope", "missing Content-Range")
        m = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", value.strip())
        if not m:
            raise ManureError("bad-envelope", "bad Content-Range")
        s, e_incl, tot = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if tot != want_size or s != want_start or not (0 <= s <= e_incl < tot):
            raise ManureError("bad-envelope", "Content-Range mismatch")
        return (s, e_incl + 1, tot)

    def _ranged_download(self, url: str, final: Path, size: int, sha: str,
                         grant_host: str | None, is_content: bool,
                         artifact_id: str = "", rel: str = "",
                         staging_dir: Path | None = None) -> None:
        if isinstance(size, bool) or not isinstance(size, int) or size < 0:
            raise InvalidManifest("bad size")
        if size > MAX_FILE_BYTES:
            raise ManureError("too-large", "file too large")
        if not isinstance(sha, str) or not SHA256_RE.match(sha):
            raise InvalidManifest("bad sha")
        if not artifact_id:
            artifact_id = "00000000"
        if not rel:
            rel = final.name
        if staging_dir is None:
            # Direct callers (unit tests): build an ephemeral namespace beside
            # the destination parent (still disjoint by construction below).
            staging_dir = final.parent / f".manure-stage-{artifact_id[:12]}"
            try:
                _mkdir_p_nofollow(staging_dir)
            except InvalidPath:
                raise
        # B4: descriptor-rooted classification+hash (no ancestor followed
        # after pin; swap fails closed, ZERO outside reads).
        if _existing_final_matches(final, size, sha):
            return
        staging, sidecar = self._staging_paths(staging_dir, rel, sha)
        # Namespace fd retained for every metadata/staging access below (B4).
        try:
            _ns_probe = _traverse_open(str(staging_dir), directory=True)
        except InvalidPath:
            _ns_probe = None
        if _ns_probe is None:
            raise InvalidPath("staging lost")
        ns_fd = _ns_probe
        ns_names = (staging.name, sidecar.name, sidecar.name + ".tmp")
        # Resume only demonstrably-owned staging (sidecar binding verified
        # through the namespace fd; B3/B4).
        start = 0
        owned = False
        try:
            staging_lstat = os.stat(staging.name, dir_fd=ns_fd, follow_symlinks=False)
            staging_exists = True
            staging_islink = stat.S_ISLNK(staging_lstat.st_mode)
        except OSError:
            staging_exists = False
            staging_islink = False
        if staging_exists and not staging_islink:
            try:
                try:
                    mfd = os.open(sidecar.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=ns_fd)
                except OSError:
                    raise ValueError("no sidecar")
                try:
                    raw = b""
                    while True:
                        blk = os.read(mfd, 65536)
                        if not blk:
                            break
                        raw += blk
                    meta = json.loads(raw.decode("utf-8"))
                finally:
                    try:
                        os.close(mfd)
                    except OSError:
                        pass
                if (isinstance(meta, dict) and meta.get("artifact_id") == artifact_id
                        and meta.get("path") == rel and meta.get("size") == size
                        and meta.get("sha256") == sha):
                    owned = True
                    cur = staging_lstat.st_size
                    if cur > size:
                        os.unlink(staging.name, dir_fd=ns_fd)
                        try:
                            os.unlink(sidecar.name, dir_fd=ns_fd)
                        except OSError:
                            pass
                        owned = False
                    elif cur == size:
                        try:
                            self._install_staging(staging, sidecar, final, size, sha,
                                                  artifact_id, rel)
                            try:
                                os.close(ns_fd)
                            except OSError:
                                pass
                            return
                        except ManureError as e:
                            if e.code != "hash-mismatch":
                                raise
                            try:
                                os.unlink(staging.name, dir_fd=ns_fd)
                            except OSError:
                                pass
                            try:
                                os.unlink(sidecar.name, dir_fd=ns_fd)
                            except OSError:
                                pass
                            owned = False
                    else:
                        start = cur
            except (OSError, ValueError, InvalidPath, ManureError):
                owned = False
                start = 0
        elif staging_islink:
            raise InvalidPath("staging obstructed")
        self._ensure_parent_no_symlink(final)
        # Reuse the retained namespace fd (opened via traversal above): every
        # metadata open below is a single dir-fd-relative step (B4). Staging
        # names are flat (no slashes) by construction.
        if "/" in staging.name or "/" in sidecar.name:
            raise InvalidPath("staging lost")
        try:
            ns_st = os.fstat(ns_fd)
            if not stat.S_ISDIR(ns_st.st_mode):
                raise InvalidPath("staging lost")
        except OSError:
            raise InvalidPath("staging lost")
        staging_rel = staging.name
        sidecar_rel = sidecar.name
        # PID-unique tmp: stale tmps from crashed claims can never collide.
        tmp_rel = sidecar_rel + f".{os.getpid()}.tmp"
        if not owned:
            # Exclusively claim sidecar via tmp+rename inside namespace (B3).
            sidecar_payload = json.dumps({"artifact_id": artifact_id, "path": rel,
                                          "size": size, "sha256": sha}, sort_keys=True).encode()
            try:
                fd_tmp = os.open(tmp_rel,
                                 os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=ns_fd)
            except OSError:
                raise InvalidPath("cannot claim staging")
            try:
                view = memoryview(sidecar_payload)
                off0 = 0
                while off0 < len(view):
                    off0 += os.write(fd_tmp, view[off0:])
                os.fsync(fd_tmp)
            finally:
                try:
                    os.close(fd_tmp)
                except OSError:
                    pass
            # Atomic no-replace claim: link(2) fails EEXIST when the
            # destination exists (B3); rename would silently replace a
            # concurrently created entry, so it must not be used here.
            try:
                os.link(tmp_rel, sidecar_rel, src_dir_fd=ns_fd, dst_dir_fd=ns_fd)
            except FileExistsError:
                pass
            except OSError:
                raise InvalidPath("cannot claim staging")
            try:
                os.unlink(tmp_rel, dir_fd=ns_fd)
            except OSError:
                pass
            # Adopt the existing entry only after validating its binding.
            claimed = False
            try:
                ex = os.stat(sidecar_rel, dir_fd=ns_fd, follow_symlinks=False)
                if stat.S_ISLNK(ex.st_mode):
                    raise InvalidPath("staging obstructed")
                try:
                    efd = os.open(sidecar_rel, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=ns_fd)
                except OSError:
                    raise InvalidPath("staging obstructed")
                try:
                    raw = b""
                    while True:
                        blk = os.read(efd, 65536)
                        if not blk:
                            break
                        raw += blk
                    meta = json.loads(raw.decode("utf-8"))
                except (OSError, ValueError):
                    meta = None
                finally:
                    try:
                        os.close(efd)
                    except OSError:
                        pass
                if isinstance(meta, dict) and meta.get("artifact_id") == artifact_id \
                        and meta.get("path") == rel and meta.get("size") == size \
                        and meta.get("sha256") == sha:
                    claimed = True
                else:
                    raise InvalidPath("cannot claim staging")
            except FileNotFoundError:
                raise InvalidPath("cannot claim staging")
            try:
                fd_claim = os.open(staging_rel,
                                   os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                   0o600, dir_fd=ns_fd)
                os.close(fd_claim)
            except FileExistsError:
                raise InvalidPath("cannot claim staging")
            except OSError:
                raise InvalidPath("cannot claim staging")
            start = 0
        # Open staging via namespace fd; retain identity through download.
        try:
            wfd = os.open(staging_rel, os.O_WRONLY | os.O_NOFOLLOW, dir_fd=ns_fd)
        except OSError:
            try:
                os.close(ns_fd)
            except OSError:
                pass
            raise InvalidPath("staging lost")
        ns_owned = True  # ns_fd retained until download finally below
        try:
            try:
                wst = os.fstat(wfd)
            except OSError:
                raise InvalidPath("staging lost")
            if not stat.S_ISREG(wst.st_mode):
                raise InvalidPath("staging not regular")
            try:
                pst = os.stat(staging_rel, dir_fd=ns_fd, follow_symlinks=False)
            except OSError:
                raise InvalidPath("staging lost")
            if stat.S_ISLNK(pst.st_mode):
                raise InvalidPath("staging changed")
            if (wst.st_dev, wst.st_ino) != (pst.st_dev, pst.st_ino):
                raise InvalidPath("staging changed")
            try:
                cur_sz = os.lseek(wfd, 0, os.SEEK_END)
            except OSError:
                raise InvalidPath("staging lost")
            if cur_sz != start:
                raise InvalidPath("staging changed")
            off = start
            while off < size:
                end = min(off + FETCH_RANGE_BYTES - 1, size - 1)
                headers: dict[str, str] = {"Accept": "*/*"}
                use_range = not (off == 0 and size <= FETCH_RANGE_BYTES)
                if use_range:
                    headers["Range"] = f"bytes={off}-{end}"
                try:
                    status, hdrs, resp_body = self._request(
                        "GET", url, headers, None,
                        send_auth=(not is_content), send_grant=True, origin=None)
                except ManureError:
                    raise
                except Exception:
                    raise ManureError("unavailable", "network error")
                lh = _lower_headers(hdrs)
                if status == 206:
                    if not use_range:
                        raise ManureError("bad-envelope", "unexpected 206")
                    s, e_excl, tot = self._parse_content_range(lh.get("content-range"), off, size)
                    if len(resp_body) != (e_excl - s):
                        raise ManureError("bad-envelope", "range length mismatch")
                    if off + len(resp_body) > size:
                        raise ManureError("bad-envelope", "range overrun")
                    view = memoryview(resp_body)
                    written = 0
                    while written < len(view):
                        try:
                            n = os.write(wfd, view[written:])
                        except OSError:
                            raise InvalidPath("staging write failed")
                        written += n
                    off += len(resp_body)
                    if len(resp_body) == 0:
                        raise ManureError("bad-envelope", "empty range part")
                    continue
                if status == 200:
                    if use_range:
                        raise ManureError("bad-envelope", "server ignored Range")
                    if len(resp_body) != size:
                        raise ManureError("hash-mismatch", "size mismatch after fetch")
                    try:
                        os.ftruncate(wfd, 0)
                        os.lseek(wfd, 0, os.SEEK_SET)
                    except OSError:
                        raise InvalidPath("staging lost")
                    view = memoryview(resp_body)
                    written = 0
                    while written < len(view):
                        try:
                            n = os.write(wfd, view[written:])
                        except OSError:
                            raise InvalidPath("staging write failed")
                        written += n
                    off = size
                    break
                if status == 416:
                    raise ManureError("invalid-range", "range unsatisfiable",
                                      http_status=status)
                raise _error_from_body(status, hdrs, resp_body)
            try:
                os.fsync(wfd)
            except OSError:
                pass
            # Re-verify identity before install (fd vs path).
            try:
                wst2 = os.fstat(wfd)
                pst2 = os.stat(str(staging), follow_symlinks=False)
            except OSError:
                raise InvalidPath("staging lost")
            if (wst2.st_dev, wst2.st_ino) != (pst2.st_dev, pst2.st_ino):
                raise InvalidPath("staging changed")
            if pst2.st_size != size:
                raise ManureError("hash-mismatch", "size mismatch after fetch")
        finally:
            try:
                os.close(wfd)
            except OSError:
                pass
            try:
                os.close(ns_fd)
            except OSError:
                pass
        # B4: install through retained descriptors (hash+rename atomic w.r.t.
        # swaps); _install_staging re-verifies identity, size, and hash itself.
        self._install_staging(staging, sidecar, final, size, sha)

    def _install_staging(self, staging: Path, sidecar: Path, final: Path,
                           size: int, sha: str, artifact_id: str = "",
                           rel: str = "") -> None:
        """Install verified staging bytes with a preserved destination (B4).

        Destination parents and the staging namespace are acquired through
        no-follow traversal and retained. A pre-existing regular destination
        is first preserved via a hard link inside the owned staging namespace;
        the install renames descriptor-relatively, then proves the installed
        name is the verified regular inode (dev/ino equality with the still
        open staging descriptor). On any mismatch the swapped-in entry is
        removed and the preserved original is restored — a refused/failed
        install never loses the previous destination nor installs a symlink
        or unverified bytes.
        """
        self._ensure_parent_no_symlink(final)
        self._refuse_symlink_final(final)
        if final.is_dir():
            raise InvalidPath(f"path is a directory: {final}")
        try:
            staging_dir_fd = _traverse_open(str(staging.parent), directory=True)
        except InvalidPath:
            raise InvalidPath("staging lost")
        try:
            parent_fd = _traverse_open(str(final.parent), directory=True)
        except InvalidPath:
            try:
                os.close(staging_dir_fd)
            except OSError:
                pass
            raise InvalidPath("symlink in dest path")
        backup_rel: str | None = None
        backup_rec: tuple[int, int] | None = None
        try:
            try:
                sfd = os.open(staging.name, os.O_RDONLY | os.O_NOFOLLOW,
                              dir_fd=staging_dir_fd)
            except OSError:
                raise InvalidPath("staging lost")
            try:
                sst = os.fstat(sfd)
                if not stat.S_ISREG(sst.st_mode):
                    raise InvalidPath("staging not regular")
                if sst.st_size != size:
                    raise ManureError("hash-mismatch", "size mismatch after fetch")
                try:
                    pst = os.stat(staging.name, dir_fd=staging_dir_fd,
                                  follow_symlinks=False)
                except OSError:
                    raise InvalidPath("staging lost")
                if (sst.st_dev, sst.st_ino) != (pst.st_dev, pst.st_ino):
                    raise InvalidPath("staging changed")
                if stat.S_ISLNK(pst.st_mode):
                    raise InvalidPath("staging changed")
                size2, sha2 = _hash_fd(sfd)
                if size2 != size or sha2 != sha:
                    raise ManureError("hash-mismatch", "sha mismatch after fetch")
                try:
                    pst2 = os.stat(staging.name, dir_fd=staging_dir_fd,
                                   follow_symlinks=False)
                except OSError:
                    raise InvalidPath("staging lost")
                if (sst.st_dev, sst.st_ino) != (pst2.st_dev, pst2.st_ino):
                    raise InvalidPath("staging changed")
                try:
                    dst = os.stat(final.name, dir_fd=parent_fd, follow_symlinks=False)
                    if stat.S_ISLNK(dst.st_mode):
                        raise InvalidPath(f"refusing to overwrite symlink: {final}")
                    if stat.S_ISDIR(dst.st_mode):
                        raise InvalidPath(f"path is a directory: {final}")
                    # Preserve the previous destination inside the owned
                    # namespace before the destructive rename. Allocation is
                    # atomic-no-replace over disambiguated names (B3): link(2)
                    # fails EEXIST on collision, so unrelated entries — even a
                    # same-PID backup name — are never unlinked or replaced.
                    # Only the allocated name is tracked and later unlinked.
                    backup_rel = None
                    _base_b = f".manure-backup-{os.getpid()}"
                    for _i in range(101):
                        _cand = _base_b if _i == 0 else f"{_base_b}.{_i}"
                        try:
                            os.link(final.name, _cand,
                                    src_dir_fd=parent_fd, dst_dir_fd=staging_dir_fd)
                        except FileExistsError:
                            continue
                        except OSError:
                            raise InvalidPath("cannot preserve destination")
                        backup_rel = _cand
                        break
                    if backup_rel is None:
                        raise InvalidPath("cannot preserve destination")
                    try:
                        bst = os.stat(backup_rel, dir_fd=staging_dir_fd,
                                      follow_symlinks=False)
                    except OSError:
                        raise InvalidPath("cannot preserve destination")
                    if (bst.st_dev, bst.st_ino) != (dst.st_dev, dst.st_ino):
                        # B3: never unlink an identity-mismatched backup — the
                        # entry at backup_rel is foreign (swapped post-link).
                        # Preserve its exact bytes/inode and fail closed.
                        raise InvalidPath("destination changed")
                    backup_rec = (dst.st_dev, dst.st_ino)
                except FileNotFoundError:
                    backup_rel = None
                try:
                    os.rename(staging.name, final.name,
                              src_dir_fd=staging_dir_fd, dst_dir_fd=parent_fd)
                except OSError:
                    raise InvalidPath("atomic install failed")

                def _restore() -> None:
                    if backup_rel is None or backup_rec is None:
                        try:
                            os.unlink(final.name, dir_fd=parent_fd)
                        except OSError:
                            pass
                        return
                    try:
                        os.unlink(final.name, dir_fd=parent_fd)
                    except OSError:
                        pass
                    try:
                        bst2 = os.stat(backup_rel, dir_fd=staging_dir_fd,
                                       follow_symlinks=False)
                    except OSError:
                        return
                    if (bst2.st_dev, bst2.st_ino) != backup_rec:
                        return
                    try:
                        os.link(backup_rel, final.name,
                                src_dir_fd=staging_dir_fd, dst_dir_fd=parent_fd)
                    except OSError:
                        pass

                try:
                    dst2 = os.stat(final.name, dir_fd=parent_fd, follow_symlinks=False)
                except OSError:
                    _restore()
                    raise InvalidPath("atomic install failed")
                if (stat.S_ISLNK(dst2.st_mode) or not stat.S_ISREG(dst2.st_mode)
                        or (dst2.st_dev, dst2.st_ino) != (sst.st_dev, sst.st_ino)):
                    _restore()
                    raise InvalidPath("staging changed")
            finally:
                try:
                    os.close(sfd)
                except OSError:
                    pass
            if backup_rel is not None and backup_rec is not None:
                # B3: inode-owned cleanup — unlink solely the backup we
                # allocated (dev/ino must still match the preserved
                # destination). A foreign or swapped entry (even at the same
                # same-PID name) is never unlinked; its exact bytes are
                # preserved.
                try:
                    bst_cleanup = os.stat(backup_rel, dir_fd=staging_dir_fd,
                                          follow_symlinks=False)
                except OSError:
                    pass
                else:
                    if ((bst_cleanup.st_dev, bst_cleanup.st_ino) == backup_rec
                            and stat.S_ISREG(bst_cleanup.st_mode)):
                        try:
                            os.unlink(backup_rel, dir_fd=staging_dir_fd)
                        except OSError:
                            pass
            try:
                cfd = os.open(sidecar.name, os.O_RDONLY | os.O_NOFOLLOW,
                              dir_fd=staging_dir_fd)
            except OSError:
                cfd = None
            if cfd is not None:
                try:
                    raw = b""
                    while True:
                        blk = os.read(cfd, 65536)
                        if not blk:
                            break
                        raw += blk
                    bound = json.loads(raw.decode("utf-8"))
                    matches = (isinstance(bound, dict)
                               and bound.get("artifact_id") == artifact_id
                               and bound.get("path") == rel
                               and bound.get("size") == size
                               and bound.get("sha256") == sha)
                except (OSError, ValueError):
                    matches = False
                finally:
                    try:
                        os.close(cfd)
                    except OSError:
                        pass
                if matches:
                    try:
                        os.unlink(sidecar.name, dir_fd=staging_dir_fd)
                    except OSError:
                        pass
            try:
                os.fsync(parent_fd)
            except OSError:
                pass
        finally:
            try:
                os.close(parent_fd)
            except OSError:
                pass
            try:
                os.close(staging_dir_fd)
            except OSError:
                pass

    @staticmethod
    def _fsync_dir(d: Path) -> None:
        fd = os.open(str(d), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
