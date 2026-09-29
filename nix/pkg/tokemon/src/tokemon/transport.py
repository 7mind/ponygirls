"""HTTP transport boundary.  Production uses urllib; tests inject a dummy."""

from __future__ import annotations

import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Mapping, Protocol

USER_AGENT = "tokemon/0.1"


class TransportError(ConnectionError):
    """The request could not be completed at the transport level."""


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes
    retry_after: str | None  # raw Retry-After header, if the server sent one

    def json(self) -> object:
        import json

        try:
            return json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise TransportError(f"response is not valid JSON: {exc}") from exc


class Transport(Protocol):
    def request(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> HttpResponse: ...


class UrllibTransport:
    def __init__(self, timeout_seconds: float) -> None:
        self._timeout_seconds = timeout_seconds

    def request(
        self, method: str, url: str, headers: Mapping[str, str], body: bytes | None
    ) -> HttpResponse:
        request = urllib.request.Request(url, data=body, method=method)
        request.add_header("User-Agent", USER_AGENT)
        for name, value in headers.items():
            request.add_header(name, value)
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                return HttpResponse(
                    status=response.status, body=response.read(), retry_after=response.headers.get("Retry-After")
                )
        except urllib.error.HTTPError as exc:
            return HttpResponse(status=exc.code, body=exc.read(), retry_after=exc.headers.get("Retry-After"))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise TransportError(f"{method} {url}: {exc}") from exc
