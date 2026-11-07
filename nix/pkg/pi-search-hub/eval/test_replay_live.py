import copy
import unittest

from evaluate import BASELINE, fuse
from replay_live import replay, target, target_metrics


def fixture():
    query = {"id": "public-doc", "query": "public docs", "targets": [{"host": "example.org", "path": "^/manual$"}]}
    engines = [
        {"name": "a", "tier": "main", "ok": True, "documents": ["https://example.org/manual", "https://example.org/other"], "duplicateRows": 0, "elapsedMs": 10},
        {"name": "b", "tier": "native", "ok": True, "documents": ["https://example.org/other", "https://example.org/manual"], "duplicateRows": 0, "elapsedMs": 20},
    ]
    baseline = fuse([(engine["name"], engine["documents"]) for engine in engines], BASELINE)
    return {"schema": 1, "binding": {"fixture": "controlled"}, "cases": [{"query": query, "engines": engines, "elapsedMs": 20, "productionRrf60": baseline}]}


class LiveReplayTests(unittest.TestCase):
    def test_exact_host_and_declared_path_not_host_suffix(self):
        query = fixture()["cases"][0]["query"]
        self.assertTrue(target("https://example.org/manual?tracking=yes#section", query))
        self.assertFalse(target("https://example.org.evil/manual", query))
        self.assertFalse(target("https://example.org/Manual", query))

    def test_reports_target_metrics_not_unfounded_relevance_grades(self):
        query = fixture()["cases"][0]["query"]
        self.assertEqual(target_metrics(["https://elsewhere.org/valid-document", "https://example.org/manual"], query),
                         {"target_hit@10": 1, "target_rr@10": 0.5, "target_in_pool": 1})

    def test_source_parity_is_a_gate_before_comparisons(self):
        data = fixture()
        data["cases"][0]["productionRrf60"].reverse()
        with self.assertRaisesRegex(ValueError, "parity failed"):
            replay(data)

    def test_duplicate_ids_and_bad_status_fail_fast(self):
        for change in ("query", "engine", "status"):
            data = fixture()
            if change == "query":
                data["cases"].append(copy.deepcopy(data["cases"][0]))
            elif change == "engine":
                data["cases"][0]["engines"].append(copy.deepcopy(data["cases"][0]["engines"][0]))
            else:
                data["cases"][0]["engines"][0]["ok"] = "yes"
            with self.subTest(change=change), self.assertRaises(ValueError):
                replay(data)

    def test_replay_is_deterministic_and_preserves_input(self):
        data = fixture()
        before = copy.deepcopy(data)
        result = replay(data)
        self.assertEqual(result, replay(data))
        self.assertEqual(data, before)
        self.assertEqual(result["production_rrf60_parity_cases"], 1)
        self.assertEqual(result["engines"]["a"]["success"], 1)
        self.assertEqual(result["engines"]["b"]["median_elapsed_ms"], 20)
        self.assertTrue(any("not complete relevance" in text or "not full relevance" in text for text in result["limitations"]))


if __name__ == "__main__":
    unittest.main()
