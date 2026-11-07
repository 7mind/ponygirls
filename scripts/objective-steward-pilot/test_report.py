"""Behavioral-Active Blackbox Good-Communication presentation controls."""
from pathlib import Path
import json
import tempfile
import unittest

from pilot import Pilot
from profile import canonical, parse_input
from report import generate
from run import frozen_sources, read_json, sha, write_json
from store import MemoryStore
from test_pilot import answer, fixture


class ReportTests(unittest.TestCase):
    def prepared(self, root):
        cases, answers, rows = [], [], []
        out = root / "run"
        out.mkdir()
        for index in range(1, 17):
            identity = f"P{index:02}"
            split = "development" if index <= 8 else "heldout"
            value = fixture()
            value["sources"][0]["text"] = "<script>window.sentinel=1</script> Human understanding."
            cases.append({"id": identity, "split": split, "input": value})
            answers.append({"id": identity, "split": split, "verdicts": {"c": ["challenged"]}, "required_citations": {"c": ["s1"]}, "primary_source": "s1", "rationale": "Synthetic presentation fixture only"})
            directory = out / identity
            directory.mkdir()
            pilot = Pilot(MemoryStore())
            pilot.initialize(parse_input(value))
            job = pilot.begin()
            pilot.publish(job, answer())
            pilot.drained(job)
            write_json(directory / "input.json", value)
            write_json(directory / "view.json", pilot.view())
            write_json(directory / "admission.json", {"case": identity, "split": split, "input_sha256": sha(directory / "input.json")})
            write_json(directory / "attempt.json", {"case": identity, "split": split, "status": "published", "published": True, "artifacts": {name: sha(directory / name) for name in ("input.json", "view.json", "admission.json")}})
            rows.append({"case": identity, "split": split, "status": "published"})
        cases_path, oracle_path = root / "cases.json", root / "oracle.json"
        write_json(cases_path, {"version": "steward-corpus-v1", "cases": cases})
        write_json(oracle_path, {"version": "steward-oracle-v1", "cases": answers})
        write_json(out / "manifest.json", {"source_sha256": frozen_sources(cases_path, oracle_path), "head": "synthetic-source-id", "prompt_sha256": "synthetic", "model": {"provider": "dummy", "model": "none", "thinking": "off"}})
        write_json(out / "attempts.json", [read_json(out / f"P{index:02}" / "attempt.json") for index in range(1,17)])
        write_json(out / "score.json", {"attempts_sha256": sha(out / "attempts.json"), "manifest_sha256": sha(out / "manifest.json"), "rows": rows, "planned": 16, "attempted": 16, "published": 16, "verdict_checks": 16, "verdict_matches": 16, "citation_matches": 16, "primary_source_links": 16})
        return cases_path, oracle_path, out

    def test_escaped_sources_and_all_case_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            cases, oracle, out = self.prepared(Path(directory))
            rendered = generate(cases, oracle, out)
            self.assertNotIn("<script>window.sentinel", rendered)
            self.assertIn("&lt;script&gt;window.sentinel", rendered)
            self.assertEqual(rendered.count("<section>"), 16)
            self.assertIn("not Human gold", rendered)
            self.assertIn("Human acceptance: not-recorded", rendered)

    def test_qualitative_findings_are_visible_escaped_and_score_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            cases, oracle, out = self.prepared(Path(directory))
            path = out / "semantic-review.json"
            value = {"score_sha256": sha(out / "score.json"), "method": "Nonblind <script>review</script>", "conclusion": "Not Human benefit", "cross_case_limits": ["No live repair demonstrated"], "rows": [{"case": f"P{index:02}", "risk": "Primary and ancillary criteria mixed"} for index in range(1,17)]}
            write_json(path, value)
            rendered = generate(cases, oracle, out)
            self.assertIn("Primary and ancillary criteria mixed", rendered)
            self.assertIn("&lt;script&gt;review", rendered)
            value["score_sha256"] = "incorrect"
            path.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError, "qualitative review binding"):
                generate(cases, oracle, out)

    def test_refreshed_subordinate_hashes_do_not_bypass_original_score(self):
        with tempfile.TemporaryDirectory() as directory:
            cases, oracle, out = self.prepared(Path(directory))
            target = out / "P01/view.json"
            view = read_json(target)
            view["review"]["assessments"][0]["reason"] = "Altered after original scoring"
            target.write_bytes(canonical(view))
            receipt_path = out / "P01/attempt.json"
            receipt = read_json(receipt_path)
            receipt["artifacts"]["view.json"] = sha(target)
            receipt_path.write_bytes(canonical(receipt))
            aggregate = read_json(out / "attempts.json")
            aggregate[0] = receipt
            (out / "attempts.json").write_bytes(canonical(aggregate))
            with self.assertRaisesRegex(ValueError, "score.*attempt"):
                generate(cases, oracle, out)

    def test_tampered_view_is_not_presented_as_bound_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            cases, oracle, out = self.prepared(Path(directory))
            target = out / "P01/view.json"
            target.write_text(target.read_text().replace('"human_acceptance":"not-recorded"', '"human_acceptance":"accepted"'))
            with self.assertRaisesRegex(ValueError, "artifact binding"):
                generate(cases, oracle, out)

if __name__ == "__main__":
    unittest.main()
