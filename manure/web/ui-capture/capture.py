#!/usr/bin/env python3
"""Manure UI capture harness: isolated server + synthetic seed + Playwright screenshots.

Not part of any build, check or test run. Invoke through run.sh (it provisions
the owned PostgreSQL cluster, server command and tool paths); see README.md.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.join(REPO, "manure", "tests"))
sys.path.insert(0, os.path.join(REPO, "manure"))
sys.path.insert(0, HERE)

import browser_fixtures as bf  # noqa: E402  (reused launcher/fixtures from the browser tests)
import seed as seedmod  # noqa: E402


def log(message: str) -> None:
    print(f"[ui-capture {time.strftime('%H:%M:%S')}] {message}", flush=True)


class Person:
    def __init__(self, directory: str, user_id: str, kind: str, display: str, login: str | None, extra_tokens: int):
        sub = os.path.join(directory, user_id)
        os.mkdir(sub)
        ident = bf._make_identity(sub)
        self.user_id, self.kind, self.display, self.login = user_id, kind, display, login
        self.token, self.token_hash_file = ident.token, ident.hash_file
        self.password, self.password_hash_file = ident.password, ident.password_hash_file
        self.configured = [{"id": f"t-{user_id}-cli", "hashFile": ident.hash_file}]
        for index in range(extra_tokens):
            secret = bf.canonical_secret()
            path = os.path.join(sub, f"extra-{index}.hash")
            with open(path, "w", encoding="utf-8") as handle:
                import hashlib
                handle.write(hashlib.sha256(secret.encode("ascii")).hexdigest() + "\n")
            os.chmod(path, 0o600)
            self.configured.append({"id": f"t-{user_id}-ci-{index}", "hashFile": path})

    def config(self) -> dict:
        entry = {"id": self.user_id, "type": self.kind, "tokens": self.configured, "displayName": self.display,
                 "enabled": True, "login": self.login}
        entry["passwordHashFile"] = self.password_hash_file if self.login else None
        return entry


def issue_account_tokens(fix, person: Person, names: list[str], revoke: list[str]) -> None:
    """Mint dashboard-issued tokens through the real account API (session cookie + actor header)."""
    origin = {"Origin": fix.api_base}
    login = fix.http.login(fix.api_base, person.login, person.password, headers=origin)
    if login.status != 200:
        raise RuntimeError(f"account login failed: HTTP {login.status}")
    account = fix.http.request("GET", fix.api_base + "/api/account/v1", headers=origin)
    actor = account.json()["user"]["actor"]
    scopes = account.json()["scopes"]
    log(f"account scopes offered: {scopes}")
    issued = {}
    for name in names:
        result = fix.http.request("POST", fix.api_base + "/api/account/v1/tokens", body={"name": name, "scopes": ["api"] if "api" in scopes else scopes[:1]},
                                  headers={**origin, "X-Account-Actor": actor})
        if result.status != 200:
            raise RuntimeError(f"token mint failed: HTTP {result.status} {result.body[:200]!r}")
        issued[name] = result.json()["token"]["id"]
    for name in revoke:
        result = fix.http.request("POST", fix.api_base + f"/api/account/v1/tokens/{urllib.parse.quote(issued[name])}/revoke", body={},
                                  headers={**origin, "X-Account-Actor": actor})
        if result.status != 200:
            raise RuntimeError(f"token revoke failed: HTTP {result.status}")
    fix.http.request("POST", fix.api_base + "/api/account/v1/logout", body={}, headers=origin)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", help="output directory for PNGs, index.md and DOM dumps")
    parser.add_argument("--count", type=int, default=260, help="bulk artifacts to seed (default 260)")
    parser.add_argument("--scenes", default="", help="comma-separated scene names to run (default all; see capture.mjs SCENES)")
    parser.add_argument("--hold-payload", default="", help="developer option: seed, write the browser payload (contains throwaway credentials, mode 0600) to this path, "
                        "then keep the server up until PATH.stop exists, so capture.mjs can be re-run with `node capture.mjs < PATH`")
    parser.add_argument("--timeout", type=int, default=1500, help="browser phase deadline in seconds")
    args = parser.parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)

    core = bf.playwright_core_path()
    chromium = bf.chromium_bin()
    node = bf.node_bin()
    viewer_dir = os.environ.get("MANURE_TEST_VIEWER_DIR", "")
    if not viewer_dir or not os.path.isfile(os.path.join(viewer_dir, "viewer.js")):
        raise SystemExit("MANURE_TEST_VIEWER_DIR must point at built viewer assets (run.sh provides it)")

    with tempfile.TemporaryDirectory(prefix="manure-ui-capture-ident-") as ident_dir:
        people = [
            Person(ident_dir, "alice.okonkwo", "human", "Alice Okonkwo", "alice", 1),
            Person(ident_dir, "bob.lindqvist", "human", "Bob Lindqvist", "bob", 0),
            Person(ident_dir, "carol.nakamura", "human", "Carol Nakamura", "carol", 0),
            Person(ident_dir, "ci-deploy-bot", "agent", "CI deploy bot", None, 0),
        ]
        overrides = {
            "users": [p.config() for p in people],
            "viewer_dir": viewer_dir,
            "rate_limit_per_min": 1_000_000, "login_rate_per_min_per_ip": 100_000, "unlock_rate_per_min": 100_000,
            "max_sessions_per_user": 500, "max_sessions_global": 5000,
        }
        log("starting isolated server (owned PostgreSQL + JVM jar)")
        fix = bf.start_server(suffix_mode="sibling", config_overrides=overrides)
        try:
            log(f"server up at {fix.api_base}")
            users = {alias: {"token": p.token} for alias, p in zip(["alice", "bob", "carol", "bot"], people)}
            t0 = time.monotonic()
            roles = seedmod.seed(fix, users, args.count, log)
            log(f"seeding finished in {time.monotonic() - t0:.1f}s")
            alice = people[0]
            issue_account_tokens(fix, alice, [f"{n}" for n in [
                "laptop-cli", "ci-pipeline-main", "gpu-node-1137 nightly export", "agent: capacity-review bot",
                "temporary token for the 2026-11 incident bridge", "docs-site publisher", "old-token-2025", "grafana-annotations",
                "token with a deliberately long name that should wrap or truncate somewhere in the dialog layout to expose overflow behaviour",
                "pi-agent", "backup-sync"]], revoke=["old-token-2025", "grafana-annotations"])
            for role in roles.values():
                role["content_url"] = bf.content_url_for(fix, role["artifact_id"])
            payload = {
                "base": fix.api_base, "core": core, "chromium": chromium, "resolver": bf.HOST_RESOLVER_RULES, "out": out,
                "scenes": [s for s in args.scenes.split(",") if s],
                "alice": {"login": alice.login, "password": alice.password, "user_id": alice.user_id},
                "bob": {"login": "bob", "password": people[1].password},
                "roles": roles, "bulk_count": args.count,
            }
            if args.hold_payload:
                fd = os.open(args.hold_payload, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(fd, "w") as handle:
                    json.dump(payload, handle)
                log(f"payload written to {args.hold_payload}; server held until {args.hold_payload}.stop exists")
                while not os.path.exists(args.hold_payload + ".stop"):
                    time.sleep(1)
                return 0
            log("running browser scenes")
            proc = subprocess.run([node, os.path.join(HERE, "capture.mjs")], input=json.dumps(payload).encode(), timeout=args.timeout, cwd=HERE,
                                  stdout=sys.stdout, stderr=sys.stderr)
            if proc.returncode != 0:
                log(f"capture.mjs exited {proc.returncode}")
                return proc.returncode
        finally:
            fix.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
