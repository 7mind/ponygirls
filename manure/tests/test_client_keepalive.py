"""Connection reuse of the Manure client, CLI and MCP server over real sockets.

Behavioral-Active / Effectual-GoodCommunication, specified by README "Connections".
Every case talks to a loopback peer (keepalive_peer) that counts the TCP
connections it accepted and records the requests it read; the assertions are
about what that peer saw and what the caller got back.
"""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import queue
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from urllib.parse import urlsplit
from uuid import UUID

import browser_fixtures
from keepalive_peer import DEADLINE_SECONDS, Hangup, Partial, Peer, Reply, Request, Silence, interrupt, serve
from manure import cli
from manure import current_protocol as cp
from manure.client import (FETCH_RANGE_BYTES, MAX_IDLE_SECONDS, MAX_KEPT_CONNECTIONS, MAX_TRANSPORT_BYTES,
                           ManureClient, ManureError, ReusedConnectionClosed, StdlibTransport)
from test_client_realserver import _LocalhostResolver, _make_server
from test_current_client import AID, PASSWORD, TOKEN, CurrentTransport

PROJECT = Path(__file__).resolve().parents[1]
RANGED_FILE_BYTES = 2 * FETCH_RANGE_BYTES + 4096  # three range requests
# Idle timeout of a peer that closes idle connections, and the socket timeout of a transport under test.
PEER_IDLE_SECONDS = 0.2
SHORT_TIMEOUT_SECONDS = 0.3
OTHER_TOKEN = "C" * 42 + "A"
TLS_SUFFIX = "manure-keepalive.test"
TLS_HOST = "peer." + TLS_SUFFIX


def echo(request: Request) -> Reply:
    """A body that names the request, so an answer delivered to the wrong request would be noticed."""
    return Reply(200, {"Content-Type": "text/plain"}, f"{request.method} {request.target}".encode())


def answer_of(result: tuple[int, dict[str, str], bytes]) -> tuple[int, bytes]:
    status, _, payload = result
    return status, payload


class TransportTests(unittest.TestCase):
    """StdlibTransport: what keeps a connection, what ends it, and what happens when the peer ends it."""

    def test_outside_keep_alive_each_request_opens_a_connection_and_inside_identical_requests_share_one(self):
        with Peer(echo) as peer:
            transport = StdlibTransport()
            for _ in range(2):
                self.assertEqual(answer_of(transport.request("POST", peer.origin + "/item?n=1", {"X-Probe": "p"}, b"body")),
                                 (200, b"POST /item?n=1"))
            self.assertEqual([request.connection for request in peer.requests], [0, 1])
            self.assertEqual((peer.wait_ended(0), peer.wait_ended(1)), ("client", "client"))
            with transport.keep_alive():
                for _ in range(3):
                    transport.request("POST", peer.origin + "/item?n=1", {"X-Probe": "p"}, b"body")
            self.assertEqual([request.connection for request in peer.requests], [0, 1, 2, 2, 2])
            sent = {(request.method, request.target, tuple(request.headers.items()), request.body) for request in peer.requests}
            self.assertEqual(len(sent), 1, sent)

    def test_keep_alive_reuses_the_connection_for_every_kind_of_request_and_response(self):
        def respond(request: Request) -> Reply:
            if request.target == "/chunked":
                return Reply(200, {}, b"c" * 200000, chunked=True)
            if request.target == "/empty":
                return Reply(204)
            if request.target == "/failed":
                return Reply(503, {"Retry-After": "5"}, b"busy")
            return echo(request)
        with Peer(respond) as peer:
            transport = StdlibTransport()
            with transport.keep_alive():
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/a", {}, None)), (200, b"GET /a"))
                self.assertEqual(answer_of(transport.request("POST", peer.origin + "/b", {}, b"x" * 300000)), (200, b"POST /b"))
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/chunked", {}, None)), (200, b"c" * 200000))
                self.assertEqual(answer_of(transport.request("PUT", peer.origin + "/c?q=1", {}, b"y")), (200, b"PUT /c?q=1"))
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/empty", {}, None)), (204, b""))
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/failed", {}, None)), (503, b"busy"))
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/d", {}, None)), (200, b"GET /d"))
                self.assertEqual([request.connection for request in peer.requests], [0] * 7)
                self.assertEqual(len(peer.requests[1].body), 300000)
            self.assertEqual(peer.wait_ended(0), "client")
            self.assertEqual(peer.accepted, 1)

    def test_nested_keep_alive_shares_the_connections_and_only_the_outermost_exit_closes_them(self):
        with Peer(echo) as peer:
            transport = StdlibTransport()
            with transport.keep_alive():
                transport.request("GET", peer.origin + "/outer", {}, None)
                with transport.keep_alive():
                    transport.request("GET", peer.origin + "/inner", {}, None)
                transport.request("GET", peer.origin + "/after-inner", {}, None)
                with self.assertRaises(KeyError):
                    with transport.keep_alive():
                        raise KeyError("inner body failed")
                transport.request("GET", peer.origin + "/after-failed-inner", {}, None)
                self.assertEqual([request.connection for request in peer.requests], [0, 0, 0, 0])
            self.assertEqual(peer.wait_ended(0), "client")
            self.assertEqual(peer.accepted, 1)

    def test_leaving_keep_alive_through_an_exception_closes_the_connections(self):
        with Peer(echo) as peer:
            transport = StdlibTransport()
            with self.assertRaises(KeyError):
                with transport.keep_alive():
                    transport.request("GET", peer.origin + "/kept", {}, None)
                    raise KeyError("body failed")
            self.assertEqual(peer.wait_ended(0), "client")
            transport.request("GET", peer.origin + "/later", {}, None)
            self.assertEqual([request.connection for request in peer.requests], [0, 1])
            self.assertEqual(peer.wait_ended(1), "client")

    def test_close_inside_keep_alive_closes_the_kept_connections(self):
        with Peer(echo) as peer:
            transport = StdlibTransport()
            with transport.keep_alive():
                transport.request("GET", peer.origin + "/kept", {}, None)
                transport.close()
                self.assertEqual(peer.wait_ended(0), "client")
                transport.request("GET", peer.origin + "/next", {}, None)
                self.assertEqual([request.connection for request in peer.requests], [0, 1])

    def test_a_response_that_announces_close_or_is_not_http_1_1_is_not_reused(self):
        replies = {"/closing": Reply(200, {"Connection": "close"}, b"bye", close=True),
                   "/old": Reply(200, {"Connection": "keep-alive"}, b"old", protocol="HTTP/1.0")}
        with Peer(lambda request: replies.get(request.target) or echo(request)) as peer:
            transport = StdlibTransport()
            with transport.keep_alive():
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/closing", {}, None)), (200, b"bye"))
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/old", {}, None)), (200, b"old"))
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/next", {}, None)), (200, b"GET /next"))
                self.assertEqual([request.connection for request in peer.requests], [0, 1, 2])
                self.assertEqual((peer.wait_ended(0), peer.wait_ended(1)), ("peer", "client"))

    def test_an_oversized_response_is_refused_and_its_connection_is_not_reused(self):
        replies = {"/declared": Reply(200, {}, b"", declared_length=MAX_TRANSPORT_BYTES + 1),
                   "/streamed": Reply(200, {}, b"x" * (MAX_TRANSPORT_BYTES + 1), chunked=True)}
        with Peer(lambda request: replies.get(request.target) or echo(request)) as peer:
            transport = StdlibTransport()
            with transport.keep_alive():
                for ordinal, target in enumerate(replies):
                    with self.assertRaises(ManureError) as refused:
                        transport.request("GET", peer.origin + target, {}, None)
                    self.assertEqual((refused.exception.code, refused.exception.message), ("too-large", "response too large"))
                    self.assertEqual(peer.wait_ended(ordinal), "client")
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/next", {}, None)), (200, b"GET /next"))
                self.assertEqual([request.connection for request in peer.requests], [0, 1, 2])

    def test_a_body_that_ends_early_is_returned_as_before_and_its_connection_is_not_reused(self):
        short = Partial(b"HTTP/1.1 200 Fixture\r\nContent-Length: 10\r\n\r\nabc")
        with Peer(interrupt(echo, lambda request: request.target == "/short", short)) as peer:
            transport = StdlibTransport()
            with transport.keep_alive():
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/short", {}, None)), (200, b"abc"))
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/next", {}, None)), (200, b"GET /next"))
                self.assertEqual([request.connection for request in peer.requests], [0, 1])

    def test_each_origin_has_its_own_connection(self):
        with Peer(echo) as first, Peer(echo) as second:
            transport = StdlibTransport()
            with transport.keep_alive():
                for _ in range(2):
                    self.assertEqual(answer_of(transport.request("GET", first.origin + "/first", {}, None)), (200, b"GET /first"))
                    self.assertEqual(answer_of(transport.request("GET", second.origin + "/second", {}, None)), (200, b"GET /second"))
                self.assertEqual([(request.connection, request.target) for request in first.requests], [(0, "/first")] * 2)
                self.assertEqual([(request.connection, request.target) for request in second.requests], [(0, "/second")] * 2)

    def test_kept_connections_are_bounded_and_the_least_recently_used_is_closed(self):
        peers = [Peer(echo) for _ in range(MAX_KEPT_CONNECTIONS + 1)]
        try:
            transport = StdlibTransport()
            with transport.keep_alive():
                for peer in peers[:-1]:
                    transport.request("GET", peer.origin + "/", {}, None)
                transport.request("GET", peers[0].origin + "/", {}, None)  # now peers[1] is the least recently used
                transport.request("GET", peers[-1].origin + "/", {}, None)
                self.assertEqual(peers[1].wait_ended(0), "client")
                for peer in peers[:1] + peers[2:]:
                    transport.request("GET", peer.origin + "/", {}, None)
                    self.assertEqual({request.connection for request in peer.requests}, {0})
                transport.request("GET", peers[1].origin + "/", {}, None)
                self.assertEqual([request.connection for request in peers[1].requests], [0, 1])
        finally:
            for peer in peers:
                peer.close()

    def test_a_connection_idle_longer_than_the_limit_is_replaced_and_one_idle_for_the_limit_is_reused(self):
        self.assertEqual(MAX_IDLE_SECONDS, 15.0)
        now = [1000.0]
        with Peer(echo) as peer:
            transport = StdlibTransport(clock=lambda: now[0])
            with transport.keep_alive():
                transport.request("GET", peer.origin + "/first", {}, None)
                now[0] += MAX_IDLE_SECONDS
                transport.request("GET", peer.origin + "/at-the-limit", {}, None)
                self.assertEqual([request.connection for request in peer.requests], [0, 0])
                now[0] += MAX_IDLE_SECONDS + 0.001
                transport.request("GET", peer.origin + "/past-the-limit", {}, None)
                self.assertEqual([request.connection for request in peer.requests], [0, 0, 1])
                self.assertEqual(peer.wait_ended(0), "client")

    def test_a_connection_the_peer_closed_while_idle_is_replaced_without_an_error(self):
        with Peer(echo, idle_timeout=PEER_IDLE_SECONDS) as peer:
            transport = StdlibTransport()
            with transport.keep_alive():
                asked = time.monotonic()
                transport.request("POST", peer.origin + "/first", {}, b"1")
                self.assertEqual(peer.wait_ended(0), "idle")
                self.assertGreaterEqual(time.monotonic() - asked, PEER_IDLE_SECONDS)
                self.assertEqual(answer_of(transport.request("POST", peer.origin + "/second", {}, b"2")), (200, b"POST /second"))
                self.assertEqual([(request.connection, request.target) for request in peer.requests], [(0, "/first"), (1, "/second")])

    def test_a_kept_connection_closed_before_the_response_is_reported_and_nothing_is_sent_twice(self):
        for reset in (False, True):
            with self.subTest(reset=reset), Peer(interrupt(echo, lambda request: request.target == "/second", Hangup(reset))) as peer:
                transport = StdlibTransport()
                with transport.keep_alive():
                    transport.request("POST", peer.origin + "/first", {}, b"1")
                    with self.assertRaises(ReusedConnectionClosed) as closed:
                        transport.request("POST", peer.origin + "/second", {}, b"2")
                    self.assertEqual((closed.exception.code, closed.exception.message), ("unavailable", "network error"))
                    self.assertEqual(answer_of(transport.request("POST", peer.origin + "/third", {}, b"3")), (200, b"POST /third"))
                    self.assertEqual([(request.connection, request.target) for request in peer.requests],
                                     [(0, "/first"), (0, "/second"), (1, "/third")])

    def test_a_new_connection_closed_before_the_response_is_an_ordinary_failure(self):
        for reset in (False, True):
            with self.subTest(reset=reset), Peer(lambda request: Hangup(reset)) as peer:
                transport = StdlibTransport()
                with transport.keep_alive(), self.assertRaises(ManureError) as failed:
                    transport.request("GET", peer.origin + "/first", {}, None)
                self.assertIs(type(failed.exception), ManureError)
                self.assertEqual((failed.exception.code, failed.exception.message), ("unavailable", "network error"))
                self.assertEqual(len(peer.requests), 1)

    def test_a_kept_connection_closed_after_part_of_the_response_is_an_ordinary_failure(self):
        for reset in (False, True):
            started = Partial(b"HTTP/1.1 2", reset)
            with self.subTest(reset=reset), Peer(interrupt(echo, lambda request: request.target == "/second", started)) as peer:
                transport = StdlibTransport()
                with transport.keep_alive():
                    transport.request("GET", peer.origin + "/first", {}, None)
                    with self.assertRaises(ManureError) as failed:
                        transport.request("GET", peer.origin + "/second", {}, None)
                    self.assertIs(type(failed.exception), ManureError)
                    self.assertEqual((failed.exception.code, failed.exception.message), ("unavailable", "network error"))
                    self.assertEqual([(request.connection, request.target) for request in peer.requests], [(0, "/first"), (0, "/second")])

    def test_the_timeout_applies_to_a_new_and_to_a_kept_connection_and_a_timed_out_request_is_not_repeated(self):
        self.assertEqual(StdlibTransport().timeout, 30.0)
        with Peer(lambda request: Silence() if request.target == "/silent" else echo(request)) as peer:
            transport = StdlibTransport(timeout=SHORT_TIMEOUT_SECONDS)
            with transport.keep_alive():
                for kept in (False, True):
                    with self.subTest(kept=kept):
                        if kept:
                            transport.request("GET", peer.origin + "/first", {}, None)
                        asked = time.monotonic()
                        with self.assertRaises(ManureError) as failed:
                            transport.request("GET", peer.origin + "/silent", {}, None)
                        self.assertGreaterEqual(time.monotonic() - asked, SHORT_TIMEOUT_SECONDS)
                        self.assertIs(type(failed.exception), ManureError)
                        self.assertEqual((failed.exception.code, failed.exception.message), ("unavailable", "network error"))
                self.assertEqual([(request.connection, request.target) for request in peer.requests],
                                 [(0, "/silent"), (1, "/first"), (1, "/silent")])
                self.assertEqual(answer_of(transport.request("GET", peer.origin + "/next", {}, None)), (200, b"GET /next"))
                self.assertEqual(peer.requests[-1].connection, 2)


def unlock_at(origin: str):
    """CurrentTransport answers Unlock for one fixed origin and has no Version; this adds both for a peer's origin."""
    def override(method, url, headers, body):
        if method != "POST":
            return None
        if urlsplit(url).path == "/api/current":
            envelope = cp.decode(cp.ClientEnvelope, cp.loads(body))
            if not isinstance(envelope.command, cp.Command_Version):
                return None
            return 200, {}, cp.dumps(cp.ServerEnvelope(envelope.requestId, cp.Result_Version(cp.VersionInfo(cp.API_VERSION, [cp.API_VERSION]))))
        if not urlsplit(url).path.endswith("/__manure/current"):
            return None
        envelope = cp.decode(cp.ContentEnvelope, cp.loads(body))
        if not isinstance(envelope.command, cp.ContentCommand_Unlock):
            return None
        assert envelope.command.password == PASSWORD and headers["Origin"] == origin
        assert not any(name.lower() in ("authorization", "cookie") for name in headers)
        return (200, {"Set-Cookie": "mgrant-dev=grant-cookie; Path=/; HttpOnly; SameSite=Lax"},
                cp.dumps(cp.ServerEnvelope(envelope.requestId, cp.Result_Ok())))
    return override


def published(files: dict[str, bytes], visibility: cp.Visibility, content_base: str) -> CurrentTransport:
    """The in-memory service holding one ready artifact with these files."""
    service = CurrentTransport(content_base)
    service.state = cp.ArtifactState.Ready
    service.visibility = visibility
    service.files = [cp.ManifestEntry_File(path, len(data), hashlib.sha256(data).hexdigest()) for path, data in files.items()]
    service.received = dict(files)
    return service


def source_tree(root: Path, files: dict[str, bytes]) -> Path:
    for path, data in files.items():
        target = root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    return root


THREE_FILES = {"big.bin": b"r" * RANGED_FILE_BYTES, "notes/a.txt": b"alpha", "notes/b.txt": b"beta"}


class OperationTests(unittest.TestCase):
    """A client operation that sends several requests pays for one connection per origin."""

    def test_fetch_by_id_sends_manifest_and_every_range_on_one_connection(self):
        service = published(THREE_FILES, cp.Visibility.Internal, "http://unused.invalid")
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(service)) as peer:
            client = ManureClient(peer.origin, TOKEN, cache_dir=Path(tmp) / "cache")
            client.fetch_to_dest(AID, Path(tmp) / "out")
            for path, data in THREE_FILES.items():
                self.assertEqual((Path(tmp) / "out" / path).read_bytes(), data)
            self.assertEqual([request.method for request in peer.requests], ["POST"] + ["GET"] * 5)
            self.assertEqual(peer.accepted, 1)
            self.assertEqual(peer.wait_ended(0), "client")

    def test_upload_sends_init_chunks_finish_and_info_on_one_connection(self):
        service = CurrentTransport("http://unused.invalid")
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(service)) as peer:
            source = source_tree(Path(tmp) / "site", {"index.html": b"<p>hi</p>", "a/one.txt": b"1", "a/two.txt": b"22"})
            client = ManureClient(peer.origin, TOKEN, cache_dir=Path(tmp) / "cache")
            result = client.upload_path(source, "internal")
            self.assertEqual(result["artifact_id"], AID)
            self.assertEqual([request.method for request in peer.requests], ["POST", "PUT", "PUT", "PUT", "POST", "POST"])
            self.assertEqual(peer.accepted, 1)
            self.assertEqual(peer.wait_ended(0), "client")

    def test_default_search_sends_capabilities_and_search_on_one_connection(self):
        service = CurrentTransport("http://unused.invalid")
        with Peer(serve(service)) as peer:
            found = ManureClient(peer.origin, TOKEN).search_expression("report")
            self.assertEqual(found.mode, "hybrid")
            self.assertEqual([type(command) for command in service.commands], [cp.Command_GetCapabilities, cp.Command_Search])
            self.assertEqual(peer.accepted, 1)
            self.assertEqual(peer.wait_ended(0), "client")

    def test_fetch_by_content_url_sends_unlock_manifest_and_ranges_on_one_connection(self):
        service = published(THREE_FILES, cp.Visibility.External, "set below")
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(service)) as peer:
            content = service.content_base = peer.origin + "/view/" + AID
            service.override = unlock_at(peer.origin)
            # No API origin is involved: the unused API base would fail the fetch if it were contacted.
            client = ManureClient("http://127.0.0.1:9", cache_dir=Path(tmp) / "cache")
            client.fetch_to_dest(content, Path(tmp) / "out", password=PASSWORD)
            self.assertEqual((Path(tmp) / "out" / "big.bin").read_bytes(), THREE_FILES["big.bin"])
            self.assertEqual([request.method for request in peer.requests], ["POST", "POST"] + ["GET"] * 5)
            self.assertEqual(peer.accepted, 1)
            self.assertEqual(peer.wait_ended(0), "client")

    def test_a_scope_held_by_the_owner_of_the_transport_keeps_the_connection_across_clients_and_operations(self):
        service = CurrentTransport("http://unused.invalid")
        transport = StdlibTransport()
        with Peer(serve(service)) as peer:
            with transport.keep_alive():
                ManureClient(peer.origin, TOKEN, transport=transport).search_expression("report")
                second = ManureClient(peer.origin, TOKEN, transport=transport)
                second.whoami()
                second.search_expression("another")
                self.assertEqual([request.connection for request in peer.requests], [0] * 5)
            self.assertEqual(peer.wait_ended(0), "client")
            ManureClient(peer.origin, TOKEN, transport=transport).search_expression("after the scope")
            self.assertEqual([request.connection for request in peer.requests], [0] * 5 + [1] * 2)
            self.assertEqual(peer.wait_ended(1), "client")

    def test_separate_calls_outside_an_operation_open_a_connection_each(self):
        service = CurrentTransport("http://unused.invalid")
        with Peer(serve(service)) as peer:
            client = ManureClient(peer.origin, TOKEN)
            client.whoami()
            self.assertEqual(peer.wait_ended(0), "client")
            client.get_artifact(AID)
            self.assertEqual(peer.wait_ended(1), "client")
            self.assertEqual(peer.accepted, 2)


def management_command(request: Request) -> cp.Command | None:
    if request.method != "POST" or request.target != "/api/current":
        return None
    return cp.decode(cp.ClientEnvelope, cp.loads(request.body)).command


def content_command(request: Request) -> cp.ContentCommand | None:
    if request.method != "POST" or not request.target.endswith("/__manure/current"):
        return None
    return cp.decode(cp.ContentEnvelope, cp.loads(request.body)).command


def carries(kind: type):
    """Matches the request that carries a management or content command of this kind."""
    return lambda request: isinstance(management_command(request) or content_command(request), kind)


ONE_FILE = {"f.txt": b"file bytes"}
# What the client may send a second time: the call that sends it and how to recognise its request.
REPLAYED = {
    "Version": (lambda client: client.version(), carries(cp.Command_Version)),
    "GetCapabilities": (lambda client: client.capabilities(), carries(cp.Command_GetCapabilities)),
    "Whoami": (lambda client: client.whoami(), carries(cp.Command_Whoami)),
    "ListArtifacts": (lambda client: client.list_artifacts(), carries(cp.Command_ListArtifacts)),
    "GetArtifact": (lambda client: client.get_artifact(AID), carries(cp.Command_GetArtifact)),
    "GetManifest": (lambda client: client.get_manifest(AID), carries(cp.Command_GetManifest)),
    "GetUploadStatus": (lambda client: client.get_upload_status(AID), carries(cp.Command_GetUploadStatus)),
    "Search": (lambda client: client.search("report"), carries(cp.Command_Search)),
    "FinishUpload": (lambda client: client.publish(AID), carries(cp.Command_FinishUpload)),
    "chunk PUT": (lambda client: client.put_chunk(AID, "new.bin", 0, b"chunk"), lambda request: request.method == "PUT"),
    "GET": (lambda client: client.fetch_to_dest(AID, tempfile.mkdtemp(dir=client.cache_dir)), lambda request: request.method == "GET"),
    "content GetManifest": (lambda client: client.fetch_to_dest(client.api_base + "/view/" + AID, tempfile.mkdtemp(dir=client.cache_dir), PASSWORD),
                            carries(cp.ContentCommand_GetManifest)),
}
# What is sent at most once.
NEVER_REPLAYED = {
    "InitUpload": (lambda client: client.init_upload("n", "dir", "internal", []), carries(cp.Command_InitUpload)),
    "PatchArtifact": (lambda client: client.patch_artifact(AID, name="renamed"), carries(cp.Command_PatchArtifact)),
    "DeleteArtifact": (lambda client: client.delete(AID), carries(cp.Command_DeleteArtifact)),
    "RotateExternalPassword": (lambda client: client.rotate_password(AID), carries(cp.Command_RotateExternalPassword)),
    "CreateGrant": (lambda client: client.create_grant(AID), carries(cp.Command_CreateGrant)),
    "content Unlock": (lambda client: client.fetch_to_dest(client.api_base + "/view/" + AID, tempfile.mkdtemp(dir=client.cache_dir), PASSWORD),
                       carries(cp.ContentCommand_Unlock)),
}


class ReplayTests(unittest.TestCase):
    """A kept connection that the peer ends before it answers: which requests go out again, and which never do."""

    def interrupted(self, call, matches, reset: bool, tmp: str):
        """Runs `call` on a connection that has answered one request, cutting off its first matching request.

        Returns the failure of the call, the connections its matching requests arrived on, and the connections accepted.
        """
        service = published(ONE_FILE, cp.Visibility.External, "set below")
        primed = []
        with Peer(interrupt(serve(service), lambda request: bool(primed) and matches(request), Hangup(reset))) as peer:
            service.content_base = peer.origin + "/view/" + AID
            service.override = unlock_at(peer.origin)
            transport = StdlibTransport()
            client = ManureClient(peer.origin, TOKEN, cache_dir=tmp, transport=transport)
            try:
                with transport.keep_alive():
                    client.whoami()
                    primed.append(True)
                    call(client)
                failure = None
            except ManureError as error:
                failure = error
            return failure, [request.connection for request in peer.requests[1:] if matches(request)], peer.accepted

    def test_requests_that_are_harmless_to_repeat_are_sent_again_on_a_new_connection(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name, (call, matches) in REPLAYED.items():
                for reset in (False, True):
                    with self.subTest(request=name, reset=reset):
                        failure, connections, accepted = self.interrupted(call, matches, reset, tmp)
                        self.assertIsNone(failure)
                        self.assertEqual((connections, accepted), ([0, 1], 2))

    def test_requests_that_change_state_are_sent_once_and_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name, (call, matches) in NEVER_REPLAYED.items():
                for reset in (False, True):
                    with self.subTest(request=name, reset=reset):
                        failure, connections, accepted = self.interrupted(call, matches, reset, tmp)
                        self.assertIsNotNone(failure)
                        self.assertEqual((failure.code, failure.message), ("unavailable", "network error"))
                        self.assertEqual((connections, accepted), ([0], 1))

    def test_a_request_is_not_repeated_after_part_of_its_response_arrived(self):
        with tempfile.TemporaryDirectory() as tmp:
            for reset in (False, True):
                service = published(ONE_FILE, cp.Visibility.Internal, "http://unused.invalid")
                with self.subTest(reset=reset), Peer(interrupt(serve(service), lambda request: request.method == "GET",
                                                               Partial(b"HTTP/1.1 2", reset))) as peer:
                    client = ManureClient(peer.origin, TOKEN, cache_dir=Path(tmp) / "cache")
                    with self.assertRaises(ManureError) as failed:
                        client.fetch_to_dest(AID, Path(tmp) / f"out-{reset}")
                    self.assertEqual((failed.exception.code, failed.exception.message), ("unavailable", "network error"))
                    self.assertEqual([(request.connection, request.method) for request in peer.requests], [(0, "POST"), (0, "GET")])
                    self.assertEqual(peer.wait_ended(0), "peer")


class RedirectTests(unittest.TestCase):
    def test_a_redirect_to_another_origin_uses_that_origins_connection_without_credentials(self):
        files = {"one.txt": b"first file", "two.txt": b"second file"}
        service = published(files, cp.Visibility.Internal, "http://unused.invalid")
        with tempfile.TemporaryDirectory() as tmp, Peer(lambda request: Reply(200, {}, files[request.target[1:]])) as elsewhere:
            def respond(request: Request) -> Reply:
                if request.method == "GET":
                    return Reply(302, {"Location": elsewhere.origin + "/" + request.target.split("/")[-2]})
                return serve(service)(request)
            with Peer(respond) as api:
                ManureClient(api.origin, TOKEN, cache_dir=Path(tmp) / "cache").fetch_to_dest(AID, Path(tmp) / "out")
                for path, data in files.items():
                    self.assertEqual((Path(tmp) / "out" / path).read_bytes(), data)
                self.assertEqual([(request.connection, request.method) for request in api.requests],
                                 [(0, "POST"), (0, "GET"), (0, "GET")])
                self.assertEqual([request.header("Authorization") for request in api.requests], ["Bearer " + TOKEN] * 3)
                self.assertEqual([(request.connection, request.target) for request in elsewhere.requests],
                                 [(0, "/one.txt"), (0, "/two.txt")])
                for request in elsewhere.requests:
                    self.assertEqual({name.lower() for name in request.headers} & {"authorization", "cookie", "origin"}, set())
                self.assertEqual((api.wait_ended(0), elsewhere.wait_ended(0)), ("client", "client"))


class TlsTests(unittest.TestCase):
    """HTTPS with the default verification: the peer's certificate is trusted through the platform's CA file setting."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.certificate, key = browser_fixtures.make_test_cert(self.directory.name, browser_fixtures.find_openssl(), [TLS_HOST])
        self.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.context.load_cert_chain(self.certificate, key)
        resolver = _LocalhostResolver(TLS_SUFFIX)
        resolver.__enter__()
        self.addCleanup(resolver.__exit__)

    def trusted(self):
        # nixpkgs' OpenSSL reads NIX_SSL_CERT_FILE before SSL_CERT_FILE.
        return mock.patch.dict(os.environ, {"SSL_CERT_FILE": self.certificate, "NIX_SSL_CERT_FILE": self.certificate})

    def test_an_operation_over_https_uses_one_verified_connection(self):
        service = published(THREE_FILES, cp.Visibility.Internal, "http://unused.invalid")
        with Peer(serve(service), tls=self.context) as peer, self.trusted():
            client = ManureClient(f"https://{TLS_HOST}:{peer.port}", TOKEN, cache_dir=Path(self.directory.name) / "cache")
            client.fetch_to_dest(AID, Path(self.directory.name) / "out")
            self.assertEqual((Path(self.directory.name) / "out" / "big.bin").read_bytes(), THREE_FILES["big.bin"])
            self.assertEqual([request.connection for request in peer.requests], [0] * 6)
            self.assertEqual(peer.accepted, 1)
            self.assertEqual(peer.wait_ended(0), "client")

    def test_an_https_connection_the_peer_closed_while_idle_is_replaced_without_an_error(self):
        with Peer(echo, tls=self.context, idle_timeout=PEER_IDLE_SECONDS) as peer, self.trusted():
            transport = StdlibTransport()
            with transport.keep_alive():
                transport.request("POST", f"https://{TLS_HOST}:{peer.port}/first", {}, b"1")
                self.assertEqual(peer.wait_ended(0), "idle")
                self.assertEqual(answer_of(transport.request("POST", f"https://{TLS_HOST}:{peer.port}/second", {}, b"2")),
                                 (200, b"POST /second"))
                self.assertEqual([(request.connection, request.target) for request in peer.requests], [(0, "/first"), (1, "/second")])

    def test_an_untrusted_certificate_is_refused_before_any_request(self):
        with Peer(echo, tls=self.context) as peer:
            transport = StdlibTransport()
            with transport.keep_alive(), self.assertRaises(ManureError) as refused:
                transport.request("GET", f"https://{TLS_HOST}:{peer.port}/secret", {"Authorization": "Bearer " + TOKEN}, None)
            self.assertEqual((refused.exception.code, refused.exception.message), ("unavailable", "network error"))
            self.assertEqual(peer.requests, [])


class RealServerTests(unittest.TestCase):
    """Against the real server, which the fixture peer only imitates: the connections the client opens."""

    def test_an_upload_of_twenty_files_and_its_fetch_open_one_connection_each(self):
        files = {f"pages/{number:02}.html": f"<p>page {number}</p>".encode() for number in range(20)}
        with tempfile.TemporaryDirectory() as tmp:
            server, token = _make_server(tmp)
            try:
                source = source_tree(Path(tmp) / "site", files)
                client = ManureClient(server.effective_api_origin, token=token, cache_dir=Path(tmp) / "cache")
                with mock.patch.object(socket, "create_connection", wraps=socket.create_connection) as connect:
                    uploaded = client.upload_path(source, "internal", fresh=True)
                    self.assertEqual(connect.call_count, 1)
                    client.fetch_to_dest(uploaded["artifact_id"], Path(tmp) / "out")
                    self.assertEqual(connect.call_count, 2)
                    client.whoami()
                    client.whoami()
                    self.assertEqual(connect.call_count, 4)
                for path, data in files.items():
                    self.assertEqual((Path(tmp) / "out" / path).read_bytes(), data)
            finally:
                server.close()


def run_cli(arguments: list[str], peer: Peer, cache: Path) -> tuple[int, str, str]:
    """The CLI entry point in this process, configured for one peer through its environment."""
    environment = {"MANURE_URL": peer.origin, "MANURE_TOKEN": TOKEN, "MANURE_CACHE_DIR": str(cache)}
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.dict(os.environ, environment), redirect_stdout(out), redirect_stderr(err):
        for name in [name for name in os.environ if name.startswith("MANURE_") and name not in environment]:
            del os.environ[name]
        code = cli.main(arguments)
    return code, out.getvalue(), err.getvalue()


class CliTests(unittest.TestCase):
    """Every CLI command opens one connection per origin, however many requests it sends."""

    def assert_one_connection(self, peer: Peer, arguments: list, requests: int, cache: Path) -> None:
        connections, received = peer.accepted, len(peer.requests)
        code, _, err = run_cli([str(argument) for argument in arguments] + ["--json"], peer, cache)
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(len(peer.requests) - received, requests)
        self.assertEqual(peer.accepted - connections, 1)
        self.assertEqual(peer.wait_ended(connections), "client")

    def test_single_request_commands(self):
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(CurrentTransport("http://unused.invalid"))) as peer:
            for arguments in (["whoami"], ["list"], ["info", AID], ["delete", AID], ["rotate-password", AID],
                              ["search", "mode:lexical report"], ["search", "state:ready"]):
                with self.subTest(command=arguments):
                    self.assert_one_connection(peer, arguments, 1, Path(tmp) / "cache")

    def test_default_search(self):
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(CurrentTransport("http://unused.invalid"))) as peer:
            self.assert_one_connection(peer, ["search", "report"], 2, Path(tmp) / "cache")

    def test_upload(self):
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(CurrentTransport("http://unused.invalid"))) as peer:
            source = source_tree(Path(tmp) / "site", {"index.html": b"<p>hi</p>", "a/one.txt": b"1"})
            self.assert_one_connection(peer, ["upload", source, "--access", "internal"], 5, Path(tmp) / "cache")

    def test_resumed_upload(self):
        files = {"a.txt": b"first", "b.txt": b"second", "c.txt": b"third"}
        service = CurrentTransport("http://unused.invalid")
        refused = cp.dumps(cp.ServerEnvelope(UUID(int=0), cp.Result_Error(cp.Failure(cp.ErrorCode.Unavailable, "fixture", None))))
        respond = interrupt(serve(service), lambda request: request.method == "PUT" and "b.txt" in request.target,
                            Reply(503, {}, refused))
        with tempfile.TemporaryDirectory() as tmp, Peer(respond) as peer:
            source = source_tree(Path(tmp) / "site", files)
            code, _, err = run_cli(["upload", str(source), "--access", "internal"], peer, Path(tmp) / "cache")
            self.assertEqual((code, err), (1, "unavailable: unavailable\n"))
            self.assertEqual(service.received, {"a.txt": b"first"})
            # Upload status, artifact, manifest, the two missing chunks, finish, artifact.
            self.assert_one_connection(peer, ["upload", source, "--access", "internal"], 7, Path(tmp) / "cache")
            self.assertEqual(service.received, files)

    def test_fetch_by_id(self):
        service = published(THREE_FILES, cp.Visibility.Internal, "http://unused.invalid")
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(service)) as peer:
            self.assert_one_connection(peer, ["fetch", AID, Path(tmp) / "out"], 6, Path(tmp) / "cache")

    def test_fetch_by_content_url_with_password(self):
        service = published(THREE_FILES, cp.Visibility.External, "set below")
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(service)) as peer:
            service.content_base = peer.origin + "/view/" + AID
            service.override = unlock_at(peer.origin)
            password_file = Path(tmp) / "password"
            password_file.write_text(PASSWORD + "\n")
            self.assert_one_connection(peer, ["fetch", service.content_base, Path(tmp) / "out",
                                              "--password-file", password_file], 7, Path(tmp) / "cache")


class McpServer:
    """`python -m manure.mcp` as a child process, driven one JSON-RPC line at a time."""

    def __init__(self, peer: Peer, cache: Path, settings: dict[str, str]):
        environment = {name: value for name, value in os.environ.items() if not name.startswith("MANURE_")}
        environment.update(settings, MANURE_URL=peer.origin, MANURE_CACHE_DIR=str(cache), PYTHONPATH=str(PROJECT))
        self._diagnostics = tempfile.TemporaryFile()
        self.process = subprocess.Popen([sys.executable, "-m", "manure.mcp"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=self._diagnostics, env=environment, text=True, cwd=str(PROJECT))
        self._replies: queue.Queue[str] = queue.Queue()
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()
        self._next_id = 1

    def __enter__(self) -> McpServer:
        self._exchange("initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                                      "clientInfo": {"name": "keepalive", "version": "0"}})
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return self

    def __exit__(self, *_) -> None:
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(DEADLINE_SECONDS)
        self._reader.join(DEADLINE_SECONDS)
        for stream in (self.process.stdin, self.process.stdout, self._diagnostics):
            stream.close()

    def _read(self) -> None:
        for line in self.process.stdout:
            self._replies.put(line)

    def _send(self, message: dict) -> None:
        self.process.stdin.write(json.dumps(message) + "\n")
        self.process.stdin.flush()

    def _exchange(self, method: str, params: dict) -> dict:
        identifier = self._next_id
        self._next_id += 1
        self._send({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params})
        try:
            reply = json.loads(self._replies.get(timeout=DEADLINE_SECONDS))
        except queue.Empty:
            self._diagnostics.seek(0)
            raise AssertionError("no reply from the MCP server: " + self._diagnostics.read().decode(errors="replace")) from None
        assert reply["id"] == identifier, reply
        return reply["result"]

    def call(self, tool: str, arguments: dict) -> dict:
        return self._exchange("tools/call", {"name": tool, "arguments": arguments})

    def end_input(self) -> int:
        self.process.stdin.close()
        return self.process.wait(DEADLINE_SECONDS)


class McpTests(unittest.TestCase):
    """The MCP server keeps one transport for its process: tool calls share its connections until it stops."""

    def test_tool_calls_of_one_server_process_share_one_connection_which_ends_with_its_input(self):
        service = CurrentTransport("http://unused.invalid")
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(service)) as peer, \
                McpServer(peer, Path(tmp) / "cache", {"MANURE_TOKEN": TOKEN}) as server:
            for tool, arguments in (("whoami", {}), ("list_artifacts", {}), ("get_artifact", {"artifact_id": AID}),
                                    ("delete_artifact", {"artifact_id": AID})):
                self.assertNotIn("isError", server.call(tool, arguments), tool)
            self.assertEqual([request.connection for request in peer.requests], [0, 0, 0, 0])
            self.assertEqual(peer.accepted, 1)
            self.assertEqual(server.end_input(), 0)
            self.assertEqual(peer.wait_ended(0), "client")

    def test_a_mutating_call_after_the_peer_closed_the_idle_connection_is_sent_once_on_a_new_connection(self):
        service = CurrentTransport("http://unused.invalid")
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(service), idle_timeout=PEER_IDLE_SECONDS) as peer, \
                McpServer(peer, Path(tmp) / "cache", {"MANURE_TOKEN": TOKEN}) as server:
            self.assertNotIn("isError", server.call("whoami", {}))
            self.assertEqual(peer.wait_ended(0), "idle")
            self.assertEqual(json.loads(server.call("delete_artifact", {"artifact_id": AID})["content"][0]["text"]), {"ok": True})
            self.assertEqual([(request.connection, type(management_command(request))) for request in peer.requests],
                             [(0, cp.Command_Whoami), (1, cp.Command_DeleteArtifact)])
            self.assertEqual(peer.accepted, 2)

    def test_credentials_are_read_for_every_call_while_the_connection_is_kept(self):
        def identity(request: Request) -> Reply:
            envelope = cp.decode(cp.ClientEnvelope, cp.loads(request.body))
            result = cp.Result_Identity(cp.Principal("u", "t", cp.PrincipalType.Agent))
            return Reply(200, {"Content-Type": "application/json"}, cp.dumps(cp.ServerEnvelope(envelope.requestId, result)))
        with tempfile.TemporaryDirectory() as tmp, Peer(identity) as peer:
            token_file = Path(tmp) / "token"
            token_file.write_text(TOKEN + "\n")
            with McpServer(peer, Path(tmp) / "cache", {"MANURE_TOKEN_FILE": str(token_file)}) as server:
                self.assertNotIn("isError", server.call("whoami", {}))
                token_file.write_text(OTHER_TOKEN + "\n")
                self.assertNotIn("isError", server.call("whoami", {}))
                self.assertEqual([(request.connection, request.header("Authorization")) for request in peer.requests],
                                 [(0, "Bearer " + TOKEN), (0, "Bearer " + OTHER_TOKEN)])

    def test_a_terminated_server_leaves_no_connection_open(self):
        service = CurrentTransport("http://unused.invalid")
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(service)) as peer, \
                McpServer(peer, Path(tmp) / "cache", {"MANURE_TOKEN": TOKEN}) as server:
            self.assertNotIn("isError", server.call("whoami", {}))
            server.process.send_signal(signal.SIGTERM)
            server.process.wait(DEADLINE_SECONDS)
            self.assertEqual(peer.wait_ended(0), "client")
            self.assertEqual(peer.accepted, 1)

    def test_an_invalid_http_setting_is_reported_by_each_call_and_nothing_is_sent(self):
        service = CurrentTransport("http://unused.invalid")
        with tempfile.TemporaryDirectory() as tmp, Peer(serve(service)) as peer, \
                McpServer(peer, Path(tmp) / "cache", {"MANURE_TOKEN": TOKEN, "MANURE_ALLOW_INSECURE_HTTP": "yes"}) as server:
            for _ in range(2):
                result = server.call("whoami", {})
                self.assertTrue(result["isError"])
                self.assertEqual(json.loads(result["content"][0]["text"])["code"], "bad-envelope")
            self.assertEqual(server.end_input(), 0)
            self.assertEqual(peer.accepted, 0)


if __name__ == "__main__":
    unittest.main()
