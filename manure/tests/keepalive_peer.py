"""Loopback HTTP/1.1 peer for connection tests of the Manure client.

Behavioral-Active / Effectual-GoodCommunication test infrastructure. `Peer` is a
real TCP server (optionally TLS) with persistent connections. It counts the
connections it accepted, records every request it read and answers through a
callback, which may also end the connection or stay silent. `serve` turns the
typed in-memory current-protocol peer of test_current_client into such a
callback, so whole client operations run over real sockets. Linux only: the
idle close waits for the client's TCP acknowledgement through TCP_INFO.
"""
from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
import socket
import ssl
import struct
import threading
import time

# linux/tcp_states.h: our FIN has been acknowledged (FIN_WAIT2), so the client's socket has it,
# or the client has closed as well (TIME_WAIT, CLOSE).
TCP_FIN_DELIVERED = (5, 6, 7)
# Bound for everything a test waits for; nothing here waits this long when it works.
DEADLINE_SECONDS = 20.0
BODY_PART_BYTES = 65536


@dataclass(frozen=True)
class Request:
    connection: int  # ordinal of the accepted connection it arrived on, from 0
    method: str
    target: str
    headers: dict[str, str]  # names as sent
    body: bytes

    def header(self, name: str) -> str | None:
        for sent, value in self.headers.items():
            if sent.lower() == name.lower():
                return value
        return None


@dataclass(frozen=True)
class Reply:
    status: int
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""
    chunked: bool = False  # chunked transfer coding instead of Content-Length
    declared_length: int | None = None  # Content-Length to announce instead of the body's
    protocol: str = "HTTP/1.1"
    close: bool = False  # end the connection after the reply


@dataclass(frozen=True)
class Hangup:
    """End the connection instead of answering: with FIN, or with RST when `reset`."""
    reset: bool = False


@dataclass(frozen=True)
class Partial:
    """Send these bytes as they are, then end the connection."""
    data: bytes
    reset: bool = False


@dataclass(frozen=True)
class Silence:
    """Never answer; the connection stays open until the peer is closed."""


Action = Reply | Hangup | Partial | Silence


class _Idle:
    pass


_IDLE = _Idle()


class Peer:
    def __init__(self, respond: Callable[[Request], Action], *, idle_timeout: float | None = None,
                 tls: ssl.SSLContext | None = None):
        self._respond = respond
        self._idle_timeout = idle_timeout
        self._tls = tls
        self._state = threading.Condition()
        self._requests: list[Request] = []
        self._ended: dict[int, str] = {}
        self._open: dict[int, socket.socket] = {}
        self._failures: list[Exception] = []
        self._accepted = 0
        self._stopping = threading.Event()
        self._listener = socket.create_server(("127.0.0.1", 0))
        self.port: int = self._listener.getsockname()[1]
        self.origin = f"http://127.0.0.1:{self.port}"
        self._workers: list[threading.Thread] = []
        self._acceptor = threading.Thread(target=self._accept, daemon=True)
        self._acceptor.start()

    def __enter__(self) -> Peer:
        return self

    def __exit__(self, *_) -> None:
        self.close()

    @property
    def accepted(self) -> int:
        with self._state:
            return self._accepted

    @property
    def requests(self) -> list[Request]:
        with self._state:
            return list(self._requests)

    def wait_ended(self, connection: int) -> str:
        """Who ended that connection: 'client', 'idle' (this peer's idle timeout) or 'peer' (an action)."""
        with self._state:
            if not self._state.wait_for(lambda: connection in self._ended, DEADLINE_SECONDS):
                raise AssertionError(f"connection {connection} is still open")
            return self._ended[connection]

    def close(self) -> None:
        self._stopping.set()
        socket.create_connection(("127.0.0.1", self.port), timeout=DEADLINE_SECONDS).close()  # wakes accept()
        self._acceptor.join(DEADLINE_SECONDS)
        self._listener.close()
        with self._state:
            still_open = list(self._open.values())
        for connection in still_open:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        for worker in self._workers:
            worker.join(DEADLINE_SECONDS)
        if self._acceptor.is_alive() or any(worker.is_alive() for worker in self._workers):
            raise AssertionError("peer threads did not stop")
        if self._failures:
            raise AssertionError("peer callback failed") from self._failures[0]

    def _accept(self) -> None:
        while True:
            connection, _ = self._listener.accept()
            if self._stopping.is_set():
                connection.close()
                return
            with self._state:
                ordinal = self._accepted
                self._accepted += 1
            worker = threading.Thread(target=self._converse, args=(ordinal, connection), daemon=True)
            self._workers.append(worker)
            worker.start()

    def _converse(self, ordinal: int, connection: socket.socket) -> None:
        ended_by = "client"
        try:
            connection.settimeout(DEADLINE_SECONDS)
            connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)  # a reply is several small writes
            if self._tls is not None:
                connection = self._tls.wrap_socket(connection, server_side=True)
            with self._state:
                self._open[ordinal] = connection
            ended_by = self._exchange(ordinal, connection)
        except OSError:
            pass  # the client reset the connection or refused the TLS handshake
        except Exception as failure:
            self._failures.append(failure)
        finally:
            connection.close()
            with self._state:
                self._open.pop(ordinal, None)
                self._ended[ordinal] = ended_by
                self._state.notify_all()

    def _exchange(self, ordinal: int, connection: socket.socket) -> str:
        while True:
            request = self._read(ordinal, connection)
            if request is None:
                return "client"
            if request is _IDLE:
                connection.shutdown(socket.SHUT_WR)
                self._await_fin_acknowledged(connection)
                return "idle"
            with self._state:
                self._requests.append(request)
            action = self._respond(request)
            if isinstance(action, Silence):
                self._stopping.wait()
                return "peer"
            if isinstance(action, Reply):
                for block in self._wire(action):
                    connection.sendall(block)
                if not action.close:
                    continue
            elif isinstance(action, Partial):
                connection.sendall(action.data)
            if isinstance(action, (Hangup, Partial)) and action.reset:
                connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
            return "peer"

    def _read(self, ordinal: int, connection: socket.socket) -> Request | _Idle | None:
        """The next request, None when the client ended the connection, _IDLE after the idle timeout."""
        received = b""
        connection.settimeout(self._idle_timeout)
        while b"\r\n\r\n" not in received:
            try:
                block = connection.recv(65536)
            except TimeoutError:
                if received:
                    raise AssertionError("request head did not arrive in time")
                return _IDLE
            if not block:
                return None
            received += block
            connection.settimeout(DEADLINE_SECONDS)
        head, _, body = received.partition(b"\r\n\r\n")
        request_line, *header_lines = head.decode("latin-1").split("\r\n")
        method, target, _protocol = request_line.split(" ", 2)
        headers = {name.strip(): value.strip() for name, _, value in (line.partition(":") for line in header_lines)}
        length = int(next((value for name, value in headers.items() if name.lower() == "content-length"), "0"))
        while len(body) < length:
            block = connection.recv(65536)
            if not block:
                return None
            body += block
        if len(body) != length:
            raise AssertionError("the client sent bytes beyond one request")
        return Request(ordinal, method, target, headers, body)

    @staticmethod
    def _wire(reply: Reply) -> Iterator[bytes]:
        headers = dict(reply.headers)
        if reply.chunked:
            headers["Transfer-Encoding"] = "chunked"
        else:
            headers["Content-Length"] = str(len(reply.body) if reply.declared_length is None else reply.declared_length)
        head = f"{reply.protocol} {reply.status} Fixture\r\n" + "".join(f"{name}: {value}\r\n" for name, value in headers.items())
        yield head.encode("latin-1") + b"\r\n"
        for start in range(0, len(reply.body), BODY_PART_BYTES):
            part = reply.body[start:start + BODY_PART_BYTES]
            yield b"%x\r\n%s\r\n" % (len(part), part) if reply.chunked else part
        if reply.chunked:
            yield b"0\r\n\r\n"

    @staticmethod
    def _await_fin_acknowledged(connection: socket.socket) -> None:
        deadline = time.monotonic() + DEADLINE_SECONDS
        while connection.getsockopt(socket.IPPROTO_TCP, socket.TCP_INFO, 1)[0] not in TCP_FIN_DELIVERED:
            if time.monotonic() > deadline:
                raise AssertionError("the client's TCP stack did not acknowledge the FIN")
            time.sleep(0.001)


def serve(transport) -> Callable[[Request], Reply]:
    """Answers from a typed in-memory peer with the transport interface (test_current_client.CurrentTransport)."""
    def respond(request: Request) -> Reply:
        url = "http://" + (request.header("Host") or "") + request.target
        status, headers, payload = transport.request(request.method, url, request.headers, request.body or None)
        return Reply(status, dict(headers), payload)
    return respond


def interrupt(respond: Callable[[Request], Action], when: Callable[[Request], bool],
              action: Action) -> Callable[[Request], Action]:
    """`respond`, except that the first request for which `when` holds gets `action` instead."""
    pending = [action]

    def interrupted(request: Request) -> Action:
        if pending and when(request):
            return pending.pop()
        return respond(request)
    return interrupted
