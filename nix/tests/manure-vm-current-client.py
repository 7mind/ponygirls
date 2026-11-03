#!/usr/bin/env python3
"""Guest-only current-wire probes; NOT a server or compatibility adapter.

Behavioral-Active / Blackbox-GoodCommunication (installed native service).
The portable client and generated current_protocol own requests/codecs. TLS
connections go only to the private guest loopback; CERT_NONE proves transport
and Host routing, NOT SAN trust (the VM retains separate curl --cacert controls).
No credential/body values are printed. Pure receipt/observer checks are also
exercised independently by test_manure_vm_current_client.py.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import http.client
from http.cookies import SimpleCookie
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import time
from urllib.parse import urljoin, urlsplit
from uuid import UUID, uuid4

from manure import current_protocol as cp
from manure.client import ManureClient, read_token_file

API = "https://api.example.test"
TOKEN_FILE = "/srv/manure-test/token.raw"
ZERO = UUID(int=0)


class GuestTransport:
    """Real guest TLS/HTTP, preserving authority; never a live host endpoint."""
    def request(self, method, url, headers, data):
        u = urlsplit(url)
        assert u.hostname in {"api.example.test", "strict.example.test", "127.0.0.1"} or re.fullmatch(r"[0-9a-f]{32}\.c\.example\.test", u.hostname or ""), "unexpected guest endpoint"
        assert u.scheme in {"http", "https"} and not u.username and not u.password, "invalid guest URL"
        if u.scheme == "https":
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            connection = http.client.HTTPSConnection("127.0.0.1", u.port or 443, context=context, timeout=30)
        else:
            connection = http.client.HTTPConnection("127.0.0.1", u.port or 80, timeout=30)
        selected = {"Host": u.netloc, **headers}
        try:
            connection.request(method, (u.path or "/") + ("?" + u.query if u.query else ""), body=data, headers=selected)
            response = connection.getresponse()
            body = response.read(8 * 1024 * 1024 + 1)
            assert len(body) <= 8 * 1024 * 1024, "oversized fixture response"
            return response.status, dict(response.getheaders()), body
        finally:
            connection.close()


def checked_reply(status, payload, request_id, expected, expected_status=200, error=None, pre_envelope=False):
    assert status == expected_status, "unexpected current HTTP status"
    result = cp.decode(cp.ServerEnvelope, cp.loads(payload))
    assert result.requestId == request_id or (pre_envelope and result.requestId == ZERO and isinstance(result.result, cp.Result_Error)), "uncorrelated current response"
    if error is not None:
        assert isinstance(result.result, cp.Result_Error) and result.result.failure.code is cp.ErrorCode(error), "wrong current error"
    else:
        assert isinstance(result.result, expected), "wrong current result variant"
    return result.result


class Wire:
    def __init__(self, base=API):
        self.base = base
        self.transport = GuestTransport()

    def command(self, command, expected, *, bearer=False, headers=None, status=200, error=None, pre_envelope=False):
        request_id = uuid4()
        body = cp.dumps(cp.ClientEnvelope(request_id, cp.API_VERSION, command))
        h = {"Content-Type": "application/json", **(headers or {})}
        if bearer:
            h["Authorization"] = "Bearer " + read_token_file(TOKEN_FILE)
        code, response_headers, payload = self.transport.request("POST", self.base + "/api/current", h, body)
        return checked_reply(code, payload, request_id, expected, status, error, pre_envelope), response_headers


def version(args):
    headers = {}
    for value, name in ((args.host, "Host"), (args.xfp, "X-Forwarded-Proto"), (args.xfh, "X-Forwarded-Host")):
        if value is not None:
            headers[name] = value
    result, _ = Wire(args.base).command(cp.Command_Version(), cp.Result_Version, headers=headers,
        status=args.expect_status, error=args.expect_error, pre_envelope=args.expect_error is not None)
    if args.expect_error is None:
        assert result.versions.current == cp.API_VERSION and result.versions.supported == [cp.API_VERSION], "wrong current version set"
    print("CURRENT_VERSION_PROBE_OK")


def cookie(headers, name, same_site):
    parsed = SimpleCookie({k.lower(): v for k, v in headers.items()}["set-cookie"])
    assert list(parsed) == [name], "wrong cookie names"
    value = parsed[name]
    assert value["secure"] and value["httponly"] and value["path"] == "/" and not value["domain"] and value["samesite"].lower() == same_site.lower(), "cookie isolation attributes"
    return name + "=" + value.value


def auth_probe():
    wire = Wire()
    token = read_token_file(TOKEN_FILE)
    result, headers = wire.command(cp.Command_Login(token), cp.Result_Identity, headers={"Origin": API})
    assert (result.principal.userId, result.principal.tokenId, result.principal.principalType) == ("w-agent", "default", cp.PrincipalType.Agent)
    session = cookie(headers, "__Host-manure", "Strict")
    result, _ = wire.command(cp.Command_Whoami(), cp.Result_Identity, headers={"Cookie": session})
    assert result.principal.userId == "w-agent"
    for command, h, status, error in ((cp.Command_Login(token), {}, 403, "Forbidden"),
                                    (cp.Command_Login("x"), {"Origin": API}, 401, "Unauthorized")):
        _, rejected = wire.command(command, cp.Result_Identity, headers=h, status=status, error=error)
        assert "set-cookie" not in {k.lower(): v for k, v in rejected.items()}, "rejected login sets cookie"
    print("CURRENT_LOGIN_COOKIE_ORIGIN_OK")


def ready():
    config = json.loads(Path("/run/manure/manure-config.json").read_text())
    pid = int(subprocess.check_output(["systemctl", "show", "-p", "MainPID", "--value", "manure.service"], timeout=30))
    assert pid > 0
    package = Path(Path("/etc/manure-test/installed-package").read_text().strip())
    assert Path(f"/proc/{pid}/exe").resolve(strict=True) == (package / "bin/manure-server").resolve(strict=True)
    journal = subprocess.check_output(["journalctl", "-u", "manure.service", "-o", "cat", "--no-pager"], text=True, timeout=30)
    records = [json.loads(line.removeprefix("MANURE_READY ")) for line in journal.splitlines() if line.startswith("MANURE_READY ")]
    assert any(record == {"apiOrigin": config["api_origin"], "port": config["port"], "pid": pid} for record in records), "selected native child not ready"
    print("CURRENT_OWN_NATIVE_READY_OK")


def client():
    return ManureClient(API, token_file=TOKEN_FILE, transport=GuestTransport())


def handoff():
    c = client()
    data = b"hello manure"
    created = c.init_upload("vm", "dir", "internal", [{"path": "index.html", "kind": "file", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}])
    aid = created["artifact_id"]
    receipt = c.put_chunk(aid, "index.html", 0, data)
    assert receipt["received_bytes"] == len(data)
    published = c.publish(aid)
    grant = c.create_grant(aid)
    request_id = uuid4()
    control = cp.dumps(cp.ContentEnvelope(request_id, cp.API_VERSION, cp.ContentCommand_RedeemGrant(grant["grant"])))
    status, headers, body = GuestTransport().request("POST", published["content_url"] + "/__manure/current", {"Content-Type": "application/json", "Origin": API}, control)
    checked_reply(status, body, request_id, cp.Result_Ok)
    content_cookie = cookie(headers, "__Host-mgrant", "Lax")
    status, _, payload = GuestTransport().request("GET", published["content_url"] + "/index.html", {"Cookie": content_cookie}, None)
    assert status == 200 and payload == data, "internal current handoff bytes"
    print("CURRENT_INTERNAL_HANDOFF_OK")


def body_bounds():
    for count, expected in ((2000, 200), (6000, 413)):
        request_id = uuid4()
        files = [cp.ManifestEntry_File("f%06d" % i + "x" * 790, 1, hashlib.sha256(b"").hexdigest()) for i in range(count)]
        command = cp.Command_InitUpload("body-bound", cp.ArtifactKind.Directory, cp.Visibility.Internal, None, files)
        payload = cp.dumps(cp.ClientEnvelope(request_id, cp.API_VERSION, command))
        assert (1048576 < len(payload) < 4194304) if count == 2000 else len(payload) > 4194304, "body-bound fixture ineffective"
        code, _, raw = GuestTransport().request("POST", API + "/api/current", {"Content-Type": "application/json", "Authorization": "Bearer " + read_token_file(TOKEN_FILE)}, payload)
        assert code == expected, "proxy current command body bound"
        if expected == 200:
            checked_reply(code, raw, request_id, cp.Result_UploadInitialized)
    print("CURRENT_PROXY_BODY_BOUNDS_OK")


class Resources(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "script" and "src" in values:
            self.urls.append(values["src"])
        if tag == "link" and values.get("rel") == "stylesheet":
            self.urls.append(values["href"])


def installed_shells():
    package = Path("/etc/manure-test/installed-package").read_text().strip()
    assert package.startswith("/nix/store/")
    pid = int(subprocess.check_output(["systemctl", "show", "-p", "MainPID", "--value", "manure.service"], timeout=30))
    executable = Path(f"/proc/{pid}/exe").resolve(strict=True)
    assert executable == (Path(package) / "bin/manure-server").resolve(strict=True), "not installed service executable"
    with executable.open("rb") as handle:
        assert handle.read(4) == b"\x7fELF", "not native Scala executable"
    config = json.loads(Path("/run/manure/manure-config.json").read_text())
    web = Path(package) / "share/manure/web"
    assert config["dashboard_dir"] == str(web / "dashboard") and config["unlock_shell_dir"] == str(web / "unlock"), "asset override hides installed defaults"
    for file in sorted((web / "dashboard").rglob("*")):
        if not file.is_file() or file.suffix not in {".html", ".js", ".css"}:
            continue
        relative = file.relative_to(web / "dashboard").as_posix()
        route = "/" if relative == "index.html" else "/" + relative
        status, headers, body = GuestTransport().request("GET", API + route, {}, None)
        assert status == 200 and body == file.read_bytes(), "installed dashboard byte mismatch"
        assert {k.lower(): v for k, v in headers.items()}["referrer-policy"] == ("strict-origin" if route == "/" else "no-referrer")
    c = client()
    created = c.init_upload("installed-unlock-shell", "dir", "external", [{"path": "index.html", "kind": "file", "size": 0, "sha256": hashlib.sha256(b"").hexdigest()}])
    content = c.publish(created["artifact_id"])["content_url"]
    status, headers, html = GuestTransport().request("GET", content, {}, None)
    assert status == 200 and {k.lower(): v for k, v in headers.items()}["referrer-policy"] == "strict-origin"
    assert html == (web / "unlock/index.html").read_bytes(), "installed unlock HTML mismatch"
    resources = Resources()
    resources.feed(html.decode("utf-8"))
    assert len(resources.urls) == 2, "unlock resource inventory"
    for relative in resources.urls:
        resource = urljoin(content, relative)
        assert urlsplit(resource).netloc == urlsplit(content).netloc
        status, _, body = GuestTransport().request("GET", resource, {}, None)
        assert status == 200 and body == (web / "unlock" / Path(urlsplit(resource).path).name).read_bytes(), "installed unlock resource mismatch"
    print("CURRENT_INSTALLED_NATIVE_AND_SHELL_BYTES_OK")


def status_for(aid):
    result, _ = Wire().command(cp.Command_GetUploadStatus(aid), cp.Result_UploadProgress, bearer=True)
    assert result.status.artifactId == aid, "wrong upload status artifact"
    return result.status


def interrupt_upload(source, output):
    output = Path(output)
    assert os.environ["MANURE_URL"] == API and os.environ["MANURE_TOKEN_FILE"] == TOKEN_FILE, "not the evaluated HM credential selection"
    cache = Path(os.environ["MANURE_CACHE_DIR"]) / "uploads"
    # Actual installed/HM CLI child, never a replacement uploader.
    with (output / "up1.json").open("wb") as stdout, (output / "up1.err").open("wb") as stderr:
        process = subprocess.Popen(["manure", "upload", source, "--access", "internal", "--json"], stdout=stdout, stderr=stderr)
        try:
            records = []
            for _ in range(300):
                records = sorted(cache.glob("*.json"))
                if records:
                    break
                assert process.poll() is None, "CLI exited before cache admission"
                time.sleep(0.02)
            assert len(records) == 1 and re.fullmatch(r"[0-9a-f]{32}", records[0].stem), "upload cache ID missing/ambiguous"
            aid = records[0].stem
            (output / "aid1").write_text(aid + "\n")
            for _ in range(300):
                status = status_for(aid)
                if status.files[0].receivedBytes > 0 and status.files[0].receivedRanges:
                    break
                assert process.poll() is None, "CLI exited before durable partial receipt"
                time.sleep(0.02)
            assert status.files[0].receivedBytes > 0 and status.files[0].receivedRanges, "no durable pre-kill receipts"
            process.kill()
            assert process.wait(timeout=30) == -9, "actual CLI was not SIGKILLed"
            (output / "kill-code").write_text("killed-exit:137\n")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=30)
    print("CURRENT_REAL_CLI_SIGKILL_OK")


def partial_status(status):
    assert re.fullmatch(r"[0-9a-f]{32}", status.artifactId), "invalid upload ID"
    assert status.state is cp.ArtifactState.Uploading and len(status.files) == 1
    file = status.files[0]
    assert file.path == "hm-big.bin" and 0 < file.receivedBytes < file.size and file.receivedRanges, "not a nonempty incomplete upload"
    ranges = [(r.start, r.endExclusive) for r in file.receivedRanges]
    assert all(0 <= start < end <= file.size for start, end in ranges)
    assert all(ranges[i][1] <= ranges[i + 1][0] for i in range(len(ranges) - 1))
    assert sum(end - start for start, end in ranges) == file.receivedBytes
    assert status.chunkBytes > 0
    assert all(start % status.chunkBytes == 0 and (end % status.chunkBytes == 0 or end == file.size) for start, end in ranges), "unaligned receipt ranges"
    return {offset for offset in range(0, file.size, status.chunkBytes)
            if not any(start <= offset and min(file.size, offset + status.chunkBytes) <= end for start, end in ranges)}


def snapshot_status(output):
    output = Path(output)
    aid = (output / "aid1").read_text().strip()
    status = status_for(aid)
    missing = partial_status(status)
    assert 0 < len(missing) < (status.files[0].size + status.chunkBytes - 1) // status.chunkBytes
    (output / "up-status.json").write_bytes(cp.dumps(status))
    (output / "rb").write_text(str(status.files[0].receivedBytes))
    (output / "tot").write_text(str(status.files[0].size))
    (output / "nr").write_text(str(len(status.files[0].receivedRanges)))
    print("CURRENT_DURABLE_PARTIAL_BASELINE_OK")


def check_resume(status_path, log_path, start_byte):
    status = cp.decode(cp.UploadStatus, cp.loads(Path(status_path).read_bytes()))
    missing = partial_status(status)
    raw = Path(log_path).read_bytes()
    assert 0 <= start_byte <= len(raw), "observer offset outside log"
    assert start_byte == 0 or raw[start_byte - 1:start_byte] == b"\n", "observer cursor splits a record"
    records = [cp.loads(line.encode("utf-8")) for line in raw[start_byte:].decode("utf-8").splitlines() if line]
    route = "/api/current/artifacts/" + status.artifactId + "/chunks"
    actual = []
    for record in records:
        assert set(record) == {"uri", "offset", "status"}, "unexpected observer fields"
        assert record["uri"] == route, "observer contains another artifact"
        assert record["status"] == "200", "failed/incomplete chunk in resume window"
        assert re.fullmatch(r"0|[1-9][0-9]{0,7}", record["offset"]), "invalid observer offset"
        actual.append(int(record["offset"]))
    assert Counter(actual) == Counter(missing), "missing/duplicate/already-acknowledged chunk PUT"
    print("CURRENT_EXACT_MISSING_OFFSETS_ONLY_OK")


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="action", required=True)
    probe = sub.add_parser("version")
    probe.add_argument("--base", default=API)
    probe.add_argument("--host")
    probe.add_argument("--xfp")
    probe.add_argument("--xfh")
    probe.add_argument("--expect-status", type=int, default=200)
    probe.add_argument("--expect-error", choices=[e.value for e in cp.ErrorCode])
    for name in ("ready", "auth", "handoff", "body-bounds", "installed", "version-payload"):
        sub.add_parser(name)
    for name in ("check-version", "check-notfound"):
        item = sub.add_parser(name)
        item.add_argument("--file", required=True)
        item.add_argument("--request" if name == "check-version" else "--status-file", required=True)
    item = sub.add_parser("interrupt-upload")
    item.add_argument("--source", required=True)
    item.add_argument("--output", required=True)
    item = sub.add_parser("snapshot-status")
    item.add_argument("--output", required=True)
    item = sub.add_parser("check-resume")
    item.add_argument("--status", required=True)
    item.add_argument("--log", required=True)
    item.add_argument("--start-byte", type=int, required=True)
    args = parser.parse_args()
    if args.action == "version": version(args)
    elif args.action == "ready": ready()
    elif args.action == "auth": auth_probe()
    elif args.action == "handoff": handoff()
    elif args.action == "body-bounds": body_bounds()
    elif args.action == "installed": installed_shells()
    elif args.action == "version-payload": print(cp.dumps(cp.ClientEnvelope(uuid4(), cp.API_VERSION, cp.Command_Version())).decode("ascii"))
    elif args.action == "check-version":
        request = cp.decode(cp.ClientEnvelope, cp.loads(Path(args.request).read_bytes()))
        reply = checked_reply(200, Path(args.file).read_bytes(), request.requestId, cp.Result_Version)
        assert reply.versions.current == cp.API_VERSION and reply.versions.supported == [cp.API_VERSION]
    elif args.action == "check-notfound":
        checked_reply(int(Path(args.status_file).read_text()), Path(args.file).read_bytes(), ZERO, cp.Result_Error, 404, "NotFound")
    elif args.action == "interrupt-upload": interrupt_upload(args.source, args.output)
    elif args.action == "snapshot-status": snapshot_status(args.output)
    elif args.action == "check-resume": check_resume(args.status, args.log, args.start_byte)


if __name__ == "__main__":
    main()
