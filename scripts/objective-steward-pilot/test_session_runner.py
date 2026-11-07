"""Scripted transport controls; these never establish semantic maintenance quality."""
import asyncio
from dataclasses import asdict
import hashlib
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest

from profile import Rejected, canonical
from run import read_json, sha, write_json
from session_profile import SYSTEM
from session_run import HERE, SOURCE_NAMES, execute, load_session, score_result


class ScriptedModel:
    def __init__(self, config, directory, failure):
        self.config = config
        self.directory = directory
        self.failure = failure

    async def review(self, snapshot):
        write_json(self.directory / "request.json", {"system": SYSTEM, "input": snapshot.wire()})
        if snapshot.checkpoint == "C02" and self.failure == "interrupt":
            raise asyncio.CancelledError()
        graph = {"nodes": [{"id": "goal", "kind": "objective", "intent": "explicit", "state": "active", "priority": "primary", "text": "Scripted mechanics-only objective", "sources": [snapshot.events[0].id]}], "relations": []}
        if snapshot.checkpoint == "C02" and self.failure == "invalid":
            graph["nodes"][0]["id"] = "forgotten-concept"
        body = canonical(graph).decode()
        write_json(self.directory / "response.json", {"text": body, "provider": self.config.provider, "model": self.config.model, "thinking": self.config.thinking, "usage": None})
        return body.encode()


class SessionRunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.out = Path(self.directory.name)
        self.session_path = HERE / "fixtures/session-001.json"
        self.oracle_path = HERE / "fixtures/session-001-oracle.json"
        self.args = SimpleNamespace(out=self.out, session=self.session_path, oracle=self.oracle_path, node="scripted", sdk="scripted", provider="scripted", model="scripted", thinking="scripted")
        source = {"commit": "scripted-controls-not-a-live-source-freeze", "files": {name: sha(HERE / name) for name in (*SOURCE_NAMES, "fixtures/session-001.json", "fixtures/session-001-oracle.json")}}
        write_json(self.out / "source-identity.json", source)
        write_json(self.out / "manifest.json", {"session_sha256": sha(self.session_path), "oracle_sha256": sha(self.oracle_path), "source_identity_sha256": sha(self.out / "source-identity.json"), "source_commit": source["commit"], "prompt_sha256": hashlib.sha256(SYSTEM.encode()).hexdigest(), "model": {key: getattr(self.args,key) for key in ("node","sdk","provider","model","thinking")}})

    def tearDown(self):
        self.directory.cleanup()

    def run_session(self, failure):
        session, events, _ = load_session(self.session_path,self.oracle_path)
        return asyncio.run(execute(self.args,session,events,lambda config,directory: ScriptedModel(config,directory,failure)))

    def change(self, path, value):
        path.write_bytes(canonical(value)+b"\n")

    def refresh_checkpoint_receipt(self, checkpoint):
        directory = self.out / checkpoint
        receipt = read_json(directory / "attempt.json")
        receipt["artifacts"] = {name:sha(directory/name) for name in receipt["artifacts"]}
        self.change(directory / "attempt.json",receipt)
        attempts = read_json(self.out / "attempts.json")
        attempts[next(index for index,item in enumerate(attempts) if item["checkpoint"] == checkpoint)] = receipt
        self.change(self.out / "attempts.json",attempts)

    def test_every_checkpoint_receives_actual_prior_graph_and_only_source_prefix(self):
        self.run_session("none")
        result = score_result(self.args)
        self.assertEqual((result["planned"],result["attempted"],result["published"]),(12,12,12))
        previous = {"nodes":[],"relations":[]}
        for index in range(12):
            directory = self.out / f"C{index+1:02}"
            snapshot = read_json(directory / "snapshot.json")
            self.assertEqual(snapshot["previous_graph"],previous)
            self.assertEqual(len(snapshot["events"]),2*index+2)
            self.assertEqual(set(snapshot),{"session","checkpoint","events","previous_graph","meaning"})
            previous = read_json(directory / "view.json")["graph"]
        self.assertEqual(len(read_json(self.out / "history.json")),12)
        self.assertTrue(all(row["same_graph_input_confirmed"] for row in result["rows"]))

    def test_invalid_original_is_retained_and_next_checkpoint_does_not_use_it(self):
        self.run_session("invalid")
        result = score_result(self.args)
        self.assertEqual(result["attempted"],12)
        self.assertEqual(result["published"],11)
        self.assertEqual(result["rows"][1]["status"],"failed")
        self.assertTrue((self.out / "C02/response.json").is_file())
        self.assertEqual(read_json(self.out / "C03/snapshot.json")["previous_graph"],read_json(self.out / "C01/view.json")["graph"])
        failed = read_json(self.out / "C02/view.json")
        self.assertEqual(failed["coverage"],"unreviewed-or-failed-prefix")
        self.assertEqual(failed["last_valid_through"],2)

    def test_interruption_keeps_terminal_receipt_and_unattempted_inventory(self):
        with self.assertRaises(asyncio.CancelledError):
            self.run_session("interrupt")
        result = score_result(self.args)
        self.assertEqual((result["attempted"],result["published"]),(2,1))
        self.assertEqual(result["rows"][1]["status"],"interrupted")
        self.assertEqual(sum(row["status"]=="unattempted" for row in result["rows"]),10)
        self.assertFalse(read_json(self.out / "C02/view.json")["inflight_marker"])

    def test_forged_published_graph_rejected_even_with_refreshed_receipts(self):
        self.run_session("none")
        view = read_json(self.out / "C01/view.json")
        view["graph"]["nodes"][0]["text"] = "Forged published interpretation"
        self.change(self.out / "C01/view.json",view)
        self.refresh_checkpoint_receipt("C01")
        with self.assertRaisesRegex(Rejected,"original model return"):
            score_result(self.args)

    def test_hidden_oracle_in_request_rejected_even_with_refreshed_receipts(self):
        self.run_session("none")
        request = read_json(self.out / "C01/request.json")
        request["input"]["oracle"] = "leaked expected classifications"
        self.change(self.out / "C01/request.json",request)
        self.refresh_checkpoint_receipt("C01")
        with self.assertRaisesRegex(Rejected,"request/model"):
            score_result(self.args)

    def test_duplicate_attempt_inventory_rejected(self):
        self.run_session("none")
        attempts = read_json(self.out / "attempts.json")
        self.change(self.out / "attempts.json",[attempts[0],*attempts])
        with self.assertRaisesRegex(Rejected,"inventory order"):
            score_result(self.args)

    def test_source_and_oracle_bindings_checked(self):
        self.run_session("none")
        manifest = read_json(self.out / "manifest.json")
        manifest["oracle_sha256"] = "0"*64
        self.change(self.out / "manifest.json",manifest)
        with self.assertRaisesRegex(Rejected,"oracle binding"):
            score_result(self.args)


if __name__ == "__main__":unittest.main()
