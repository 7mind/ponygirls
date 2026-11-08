"""Fixture self-tests: BA for documents, BA/Good-Communication for real loopback adapters."""
from __future__ import annotations

import http.client
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent))

from client import FixtureControl, LoopbackTransport, NO_BODY
from fixtures import (
    EXPECTED_TOOLS, FORGE_PROJECTS, MODEL_KEY, OPERATOR_CLIENT, OPERATOR_SECRET,
    REDIRECT_PATH, FixtureServer, model_config, run_git,
)


class FixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="rites-fixture-selftest-")
        self.root = Path(self.temporary.name)
        self.server = FixtureServer(self.root)
        self.server.start()
        self.control = FixtureControl(self.server.base_url)
        self.transport = LoopbackTransport(self.server.base_url, 10)

    def tearDown(self) -> None:
        self.server.close()
        self.temporary.cleanup()

    def post_json(self, path: str, body: dict[str, object], expected: int) -> dict[str, object]:
        response = self.transport.request("POST", path, body, {"Content-Type": "application/json"})
        self.assertEqual(expected, response.status)
        self.assertIsInstance(response.json, dict)
        return response.json

    def oauth_refresh(self) -> dict[str, object]:
        form = {
            "grant_type": "refresh_token", "client_id": OPERATOR_CLIENT,
            "client_secret": OPERATOR_SECRET, "refresh_token": "synthetic-oauth-refresh-0",
            "redirect_uri": self.server.base_url + REDIRECT_PATH,
        }
        return self.raw_form(form)

    def raw_form(self, form: dict[str, str]) -> dict[str, object]:
        # LoopbackTransport deliberately owns JSON encoding; form transport is kept local.
        raw = http.client.HTTPConnection("127.0.0.1", self.server.httpd.server_port, timeout=10)
        try:
            raw.request("POST", "/gitlab/oauth/token", urlencode(form), {"Content-Type": "application/x-www-form-urlencoded"})
            response = raw.getresponse()
            self.assertEqual(200, response.status)
            value = json.loads(response.read(65536))
            self.assertIsInstance(value, dict)
            return value
        finally:
            raw.close()

    def test_model_document_selects_only_synthetic_fixture_provider(self) -> None:
        document = model_config(self.server.base_url)
        self.assertEqual({"provider", "modelsJson", "credential"}, set(document))
        self.assertEqual("fixture", document["provider"])
        providers = document["modelsJson"]["providers"]
        self.assertEqual(["fixture"], list(providers))
        self.assertEqual("synthetic-model-key", document["credential"]["key"])

    def test_github_and_gitlab_create_precede_predecessor_close(self) -> None:
        for forge, api in (("Github", "/github/api/v3"), ("Gitlab", "/gitlab/api/v4")):
            project = FORGE_PROJECTS[forge]
            if forge == "Github":
                root = f"{api}/repos/{project}/pulls"
                token = "synthetic-github-token"
                first_body = {"title": "Rites site", "head": "rites/repo/site/one", "base": "main", "body": "rites-run:one\nbase-target:main"}
                second_body = dict(first_body, head="rites/repo/site/two", body="rites-run:two\nbase-target:main")
            else:
                from urllib.parse import quote
                root = f"{api}/projects/{quote(project, safe='')}/merge_requests"
                token = "synthetic-oauth-access-0"
                first_body = {"title": "Rites site", "source_branch": "rites/repo/site/one", "target_branch": "main", "description": "rites-run:one\nbase-target:main"}
                second_body = dict(first_body, source_branch="rites/repo/site/two", description="rites-run:two\nbase-target:main")
            headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
            first = self.transport.request("POST", root, first_body, headers)
            second = self.transport.request("POST", root, second_body, headers)
            self.assertEqual(201, first.status)
            self.assertEqual(201, second.status)
            remote_id = first.json["number" if forge == "Github" else "iid"]
            close_body = {"state": "closed"} if forge == "Github" else {"state_event": "close"}
            close_method = "PATCH" if forge == "Github" else "PUT"
            closed = self.transport.request(close_method, f"{root}/{remote_id}", close_body, headers)
            self.assertEqual(200, closed.status)
            events = self.control.observation()["events"]
            relevant = [event for event in events if event["forge"] == forge]
            self.assertEqual(["create", "create", "close"], [event["event"] for event in relevant])
            remaining = self.transport.request("GET", root + "?state=open", NO_BODY, {"Authorization": f"Bearer {token}"})
            self.assertEqual(200, remaining.status)
            self.assertEqual(1, len(remaining.json))

    def test_real_smart_http_clone_and_push_use_askpass(self) -> None:
        clone = self.root / "clone"
        askpass = self.root / "askpass"
        token_file = self.root / "git-token"
        token_file.write_text("synthetic-github-token", encoding="utf-8")
        token_file.chmod(stat.S_IRUSR | stat.S_IWUSR)
        askpass.write_text(f"#!/bin/sh\ncase \"$1\" in *Password*) exec /bin/cat {token_file};; *) exit 1;; esac\n", encoding="utf-8")
        askpass.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
        env = {"GIT_ASKPASS": str(askpass)}
        url = f"http://x-access-token@127.0.0.1:{self.server.httpd.server_port}/github/git/fixture/github-repository.git"
        result = run_git(["clone", url, str(clone)], self.root, b"", env)
        self.assertEqual(0, result.returncode, result.stderr.decode())
        self.assertEqual("Update result.txt using the brokered workspace tools.\n", (clone / "prompt.md").read_text())
        (clone / "result.txt").write_text("real git push\n", encoding="utf-8")
        run_git(["-C", str(clone), "config", "user.name", "Fixture Test"], self.root, b"", env)
        run_git(["-C", str(clone), "config", "user.email", "fixture@localhost"], self.root, b"", env)
        for arguments in (["-C", str(clone), "add", "result.txt"], ["-C", str(clone), "commit", "-m", "Fixture push"], ["-C", str(clone), "push", "origin", "HEAD:refs/heads/rites/selftest"]):
            result = run_git(arguments, self.root, b"", env)
            self.assertEqual(0, result.returncode, result.stderr.decode())
        show = run_git(["--git-dir", str(self.root / "repositories/fixture/github-repository.git"), "show", "refs/heads/rites/selftest:result.txt"], self.root, b"", None)
        self.assertEqual(b"real git push\n", show.stdout)

    def test_gitlab_smart_http_accepts_rotated_oauth_token(self) -> None:
        rotated = self.oauth_refresh()
        clone = self.root / "gitlab-clone"
        askpass = self.root / "gitlab-askpass"
        token_file = self.root / "gitlab-token"
        token_file.write_text(str(rotated["access_token"]), encoding="utf-8")
        token_file.chmod(stat.S_IRUSR | stat.S_IWUSR)
        askpass.write_text(f"#!/bin/sh\ncase \"$1\" in *Password*) exec /bin/cat {token_file};; *) exit 1;; esac\n", encoding="utf-8")
        askpass.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
        url = f"http://oauth2@127.0.0.1:{self.server.httpd.server_port}/gitlab/git/fixture/gitlab-repository.git"
        result = run_git(["clone", url, str(clone)], self.root, b"", {"GIT_ASKPASS": str(askpass)})
        self.assertEqual(0, result.returncode, result.stderr.decode())
        self.assertTrue((clone / "README.md").is_file())

    def test_model_requires_exact_broker_tools_then_stops(self) -> None:
        tools = [{"type": "function", "function": {"name": name, "parameters": {}}} for name in sorted(EXPECTED_TOOLS)]
        body = {"model": "fixture-model", "messages": [], "tools": tools, "stream": True}
        headers = {"Authorization": f"Bearer {MODEL_KEY}", "Content-Type": "application/json"}
        first = self.transport.request("POST", "/model/chat/completions", body, headers)
        self.assertEqual(200, first.status)
        self.assertIn('"name":"rites_write"', first.json)
        second = self.transport.request("POST", "/model/chat/completions", body, headers)
        self.assertEqual(200, second.status)
        self.assertIn('"finish_reason":"stop"', second.json)
        observation = self.control.observation()
        self.assertEqual(2, observation["model"]["calls"])
        self.assertEqual([sorted(EXPECTED_TOOLS), sorted(EXPECTED_TOOLS)], observation["model"]["toolSets"])

    def test_partial_provider_modes_write_then_fail(self) -> None:
        tools = [{"type": "function", "function": {"name": name, "parameters": {}}} for name in sorted(EXPECTED_TOOLS)]
        body = {"model": "fixture-model", "messages": [], "tools": tools, "stream": True}
        headers = {"Authorization": f"Bearer {MODEL_KEY}", "Content-Type": "application/json"}
        self.control.model("partial-length", "partial\\n", False)
        first = self.transport.request("POST", "/model/chat/completions", body, headers)
        second = self.transport.request("POST", "/model/chat/completions", body, headers)
        self.assertIn('"name":"rites_write"', first.json)
        self.assertIn('"finish_reason":"length"', second.json)
        self.control.model("partial-error", "partial\\n", False)
        first_error = self.transport.request("POST", "/model/chat/completions", body, headers)
        second_error = self.transport.request("POST", "/model/chat/completions", body, headers)
        self.assertIn('"name":"rites_write"', first_error.json)
        self.assertEqual(500, second_error.status)
        self.assertEqual("synthetic", second_error.json["error"]["type"])

    def test_oauth_rotates_and_drop_response_is_observable_without_new_tokens(self) -> None:
        rotated = self.oauth_refresh()
        self.assertNotEqual("synthetic-oauth-access-0", rotated["access_token"])
        old = self.transport.request("GET", "/gitlab/api/v4/user", NO_BODY, {"Authorization": "Bearer synthetic-oauth-access-0"})
        current = self.transport.request("GET", "/gitlab/api/v4/user", NO_BODY, {"Authorization": f"Bearer {rotated['access_token']}"})
        self.assertEqual(401, old.status)
        self.assertEqual(200, current.status)
        # Uncertainty behavior is exercised in a fresh state by the native suite;
        # this test also guarantees observations never disclose rotated material.
        encoded_observation = json.dumps(self.control.observation())
        self.assertNotIn(str(rotated["access_token"]), encoded_observation)
        self.assertNotIn(str(rotated["refresh_token"]), encoded_observation)

    def test_oauth_can_commit_rotation_then_drop_response(self) -> None:
        self.control.oauth("drop-next")
        with self.assertRaises((http.client.RemoteDisconnected, ConnectionResetError)):
            self.oauth_refresh()
        observation = self.control.observation()
        self.assertEqual(1, observation["oauth"]["generation"])
        self.assertEqual(1, observation["oauth"]["refreshCalls"])
        old = self.transport.request("GET", "/gitlab/api/v4/user", NO_BODY, {"Authorization": "Bearer synthetic-oauth-access-0"})
        new = self.transport.request("GET", "/gitlab/api/v4/user", NO_BODY, {"Authorization": "Bearer synthetic-oauth-access-1"})
        self.assertEqual(401, old.status)
        self.assertEqual(200, new.status)

    def test_observation_never_contains_fixture_secrets(self) -> None:
        self.oauth_refresh()
        encoded = json.dumps(self.control.observation())
        for secret in (MODEL_KEY, OPERATOR_SECRET, "synthetic-oauth-access-1", "synthetic-oauth-refresh-1", "synthetic-github-token"):
            self.assertNotIn(secret, encoded)


if __name__ == "__main__":
    unittest.main()
