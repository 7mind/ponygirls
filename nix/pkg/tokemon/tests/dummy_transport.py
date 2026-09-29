"""Hand-written dummy Transport (dual-tests pattern) with a routing table."""

from __future__ import annotations

from typing import Mapping

from tokemon.transport import HttpResponse, TransportError


class ScriptedTransport:
    """In-memory Transport: routes (method, url) -> HttpResponse or exception."""

    def __init__(self, routes: Mapping[tuple[str, str], object]) -> None:
        self._routes = dict(routes)
        self.calls: list[tuple[str, str]] = []

    def request(self, method: str, url: str, headers: Mapping[str, str], body: bytes | None) -> HttpResponse:
        self.calls.append((method, url))
        outcome = self._routes.get((method, url))
        if outcome is None:
            raise TransportError(f"no scripted route for {method} {url}")
        if isinstance(outcome, Exception):
            raise outcome
        assert isinstance(outcome, HttpResponse)
        return outcome


def json_response(status: int, payload: object) -> HttpResponse:
    import json

    return HttpResponse(status=status, body=json.dumps(payload).encode("utf-8"))
