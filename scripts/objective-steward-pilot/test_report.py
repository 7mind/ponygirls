"""Behavioral-Active Blackbox Good-Communication presentation controls."""
from pathlib import Path
import tempfile
import unittest

from pilot import Pilot
from profile import parse_input
from report import generate
from run import frozen_sources, sha, write_json
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
        write_json(out / "score.json", {"manifest_sha256": sha(out / "manifest.json"), "rows": rows, "planned": 16, "attempted": 16, "published": 16, "verdict_checks": 16, "verdict_matches": 16, "citation_matches": 16, "primary_source_links": 16})
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

    def test_tampered_view_is_not_presented_as_bound_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            cases, oracle, out = self.prepared(Path(directory))
            target = out / "P01/view.json"
            target.write_text(target.read_text().replace('"human_acceptance":"not-recorded"', '"human_acceptance":"accepted"'))
            with self.assertRaisesRegex(ValueError, "artifact binding"):
                generate(cases, oracle, out)

if __name__ == "__main__":
    unittest.main()
