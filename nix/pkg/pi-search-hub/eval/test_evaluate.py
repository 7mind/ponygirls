"""Offline specification tests; no network, external packages, or mocks."""

from copy import deepcopy
import hashlib
import itertools
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import evaluate as ev


# Behavioral-Active-Blackbox-Atomic; specified metric and fusion contracts.
class MetricsTests(unittest.TestCase):
    def test_exact_linear_metrics_and_binary_threshold(self):
        metrics = ev.query_metrics(["unjudged", "marginal", "relevant"], {"best": 3, "relevant": 2, "marginal": 1, "zero": 0})
        expected_ndcg = (1 / math.log2(3) + 2 / math.log2(4)) / (3 + 2 / math.log2(3) + 1 / math.log2(4))
        self.assertAlmostEqual(metrics["ndcg@10"], expected_ndcg, places=15)
        self.assertEqual(metrics["mrr@10"], 1 / 3)
        self.assertEqual(metrics["recall@10"], 1 / 2)
        self.assertEqual(metrics["judged_fraction@10"], 2 / 3)
        self.assertEqual(metrics["results_returned@10"], 3)
        self.assertEqual(metrics["pool_recall"], 1 / 2)

    def test_empty_ranking_scores_zero(self):
        self.assertTrue(all(value == 0 for value in ev.query_metrics([], {"relevant": 3}).values()))

    def test_no_ideal_or_binary_relevant_documents(self):
        self.assertEqual(ev.query_metrics(["zero"], {"zero": 0})["ndcg@10"], 0)
        metrics = ev.query_metrics(["marginal"], {"marginal": 1})
        self.assertEqual(metrics["ndcg@10"], 1)
        self.assertEqual(metrics["mrr@10"], 0)
        self.assertEqual(metrics["recall@10"], 0)

    def test_cutoff_and_pool_recall_are_different(self):
        metrics = ev.query_metrics([str(index) for index in range(11)], {"10": 3})
        self.assertEqual(metrics["recall@10"], 0)
        self.assertEqual(metrics["pool_recall"], 1)
        self.assertEqual(metrics["results_returned@10"], 10)
        self.assertEqual(metrics["judged_fraction@10"], 0)

    def test_metric_bounds_for_every_small_permutation(self):
        judgments = {"a": 3, "b": 2, "c": 1, "d": 0}
        for ranking in itertools.permutations([*judgments, "unjudged"]):
            for size in range(len(ranking) + 1):
                metrics = ev.query_metrics(ranking[:size], judgments)
                for name, value in metrics.items():
                    self.assertTrue(math.isfinite(value))
                    self.assertGreaterEqual(value, 0, name)
                    self.assertLessEqual(value, 10 if name == "results_returned@10" else 1, name)
                self.assertGreaterEqual(metrics["pool_recall"], metrics["recall@10"])

    def test_macro_includes_queries_with_empty_results(self):
        summary = ev.summarize({"a": ["r"], "b": []}, {"a": {"r": 3}, "b": {"r": 3}})
        self.assertEqual(set(summary["per_query"]), {"a", "b"})
        self.assertTrue(all(value == 0.5 for value in summary["macro"].values()))

    def test_missing_and_extra_queries_fail_instead_of_being_excluded(self):
        for rankings in ({"a": []}, {"a": [], "b": [], "extra": []}):
            with self.subTest(rankings=rankings), self.assertRaisesRegex(ValueError, "Query mismatch"):
                ev.summarize(rankings, {"a": {"r": 3}, "b": {"r": 3}})
        with self.assertRaisesRegex(ValueError, "No judged queries"):
            ev.summarize({}, {})

    def test_duplicate_results_and_nonfinite_judgments_fail(self):
        with self.assertRaisesRegex(ValueError, "Duplicate document"):
            ev.query_metrics(["a", "a"], {"a": 3})
        for grade in (math.nan, math.inf, -1, 4, 2.0, True):
            with self.subTest(grade=grade), self.assertRaisesRegex(ValueError, "Invalid/nonfinite"):
                ev.query_metrics(["a"], {"a": grade})

    def test_consensus_is_not_relevance(self):
        ranking = ev.fuse([("a", ["consensus", "relevant"]), ("b", ["consensus"])], ev.BASELINE)
        metrics = ev.query_metrics(ranking, {"relevant": 3})
        self.assertEqual(metrics["mrr@10"], 0.5)
        self.assertEqual(metrics["judged_fraction@10"], 0.5)
        self.assertAlmostEqual(metrics["ndcg@10"], 1 / math.log2(3))


class FusionTests(unittest.TestCase):
    def test_exact_grid_and_formula_rankings(self):
        self.assertEqual(len(ev.CANDIDATES), 10)
        lists = [("a", ["a", "u1", "u2", "shared"]), ("b", ["b", "v1", "v2", "shared"])]
        for candidate in ev.CANDIDATES:
            if candidate.name == "rrf_k0":
                expected = ["a", "b", "shared", "u1", "v1", "u2", "v2"]
            elif candidate.name in ("rbc_p0.5", "borda"):
                expected = ["a", "b", "u1", "v1", "shared", "u2", "v2"]
            else:
                expected = ["shared", "a", "b", "u1", "v1", "u2", "v2"]
            with self.subTest(candidate=candidate.name):
                self.assertEqual(ev.fuse(lists, candidate), expected)

    def test_first_encounter_not_lexical_order_breaks_final_ties(self):
        self.assertEqual(ev.fuse([("a", ["z"]), ("b", ["a"])], ev.BASELINE), ["z", "a"])
        self.assertEqual(ev.fuse([("b", ["a"]), ("a", ["z"])], ev.BASELINE), ["a", "z"])

    def test_duplicates_cannot_buy_votes_or_depress_later_ranks(self):
        lists = [("a", ["a", "shared", "last"]), ("b", ["shared", "other"])]
        for candidate in ev.CANDIDATES:
            expected = ev.fuse(lists, candidate)
            for engine_index, (_engine, docs) in enumerate(lists):
                for hit_index in range(len(docs)):
                    for repetitions in (1, 2, 5):
                        repeated = deepcopy(lists)
                        repeated[engine_index][1][hit_index:hit_index] = [docs[hit_index]] * repetitions
                        with self.subTest(candidate=candidate.name, engine=engine_index, rank=hit_index, repetitions=repetitions):
                            self.assertEqual(ev.fuse(repeated, candidate), expected)

    def test_empty_lists_and_single_multi_list_parity(self):
        for candidate in ev.CANDIDATES:
            self.assertEqual(ev.fuse([], candidate), [])
            self.assertEqual(ev.fuse([("a", [])], candidate), [])
            self.assertEqual(ev.fuse([("a", ["x", "x", "y"])], candidate), ["x", "y"])
            self.assertEqual(ev.fuse([("a", ["x", "x", "y"]), ("empty", [])], candidate), ["x", "y"])

    def test_duplicate_engine_ids_and_unknown_candidates_fail(self):
        with self.assertRaisesRegex(ValueError, "Duplicate engine"):
            ev.fuse([("a", ["x"]), ("a", ["y"])], ev.BASELINE)
        with self.assertRaisesRegex(ValueError, "Unknown candidate"):
            ev.fuse([], ev.Candidate("unplanned", "rrf", 42))

    def test_only_fixed_candidates_are_evaluated_and_depth_caps_each_engine(self):
        runs = {"bm25": {"q": ["a", "b", "c"]}, "bm25_ce": {"q": ["c", "d", "e"]}}
        candidate = ev.CANDIDATES[0]
        result = ev.evaluate_depth(runs, {"q": {"c": 3, "e": 2}}, 2, (candidate, ev.BASELINE))
        self.assertEqual(set(result), {"bm25", "bm25_ce", candidate.name, ev.BASELINE.name})
        self.assertEqual(result[candidate.name]["macro"]["results_returned@10"], 4)
        self.assertEqual(result[candidate.name]["macro"]["pool_recall"], 0.5)
        self.assertEqual(result[ev.BASELINE.name]["macro"]["pool_recall"], 0.5)


class BootstrapTests(unittest.TestCase):
    def test_exact_constant_difference_interval(self):
        result = ev.paired_bootstrap([0.75] * 3, [0.25] * 3)
        self.assertEqual(result["mean_delta"], 0.5)
        self.assertEqual(result["ci95"], [0.5, 0.5])
        self.assertEqual((result["wins"], result["ties"], result["losses"]), (3, 0, 0))
        self.assertEqual(result["repetitions"], 10_000)
        self.assertEqual(result["seed"], ev.BOOTSTRAP_SEED)

    def test_seeded_paired_resampling_and_tie_counts(self):
        result = ev.paired_bootstrap([1, 0, 0.5], [0, 1, 0.5])
        self.assertEqual(result, ev.paired_bootstrap([1, 0, 0.5], [0, 1, 0.5]))
        self.assertEqual(result["mean_delta"], 0)
        self.assertEqual((result["wins"], result["ties"], result["losses"]), (1, 1, 1))
        self.assertEqual(result["ci95"], [-1, 1])

    def test_bad_pairs_and_nonfinite_metrics_fail(self):
        for selected, control in (([], []), ([0], [0, 1]), ([math.nan], [0]), ([0], [math.inf])):
            with self.subTest(selected=selected, control=control), self.assertRaises(ValueError):
                ev.paired_bootstrap(selected, control)

    def test_percentile_interpolates(self):
        self.assertEqual(ev.percentile([0, 1, 2, 3], 0.25), 0.75)
        self.assertEqual(ev.percentile([7], 0.975), 7)


# Behavioral-Active-Effectual-GoodCommunication: tiny real temporary files and CLI.
# Pure scoring tests above need no FS adapter/dummy; no mocked call expectations.
class InputOutputTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def file(self, text, name="input"):
        path = self.directory / name
        path.write_text(text)
        return path

    def test_valid_trec_rows(self):
        path = self.file("q Q0 a 1 7.5 bm25\nq Q0 b 2 -1 bm25\np Q0 b 1 0 bm25\n")
        self.assertEqual(ev.read_run(path), {"q": ["a", "b"], "p": ["b"]})
        self.assertEqual(ev.read_qrels(self.file("q Q0 a 3\nq Q0 b 1\np Q0 b 0\n")), {"q": {"a": 3, "b": 1}, "p": {"b": 0}})

    def test_malformed_ranks_scores_and_duplicate_run_ids_fail(self):
        invalid = [
            "q Q0 a 0 1 tag\n", "q Q0 a 2 1 tag\n", "q Q0 a 1.0 1 tag\n",
            "q Q0 a 1 nan tag\n", "q Q0 a 1 inf tag\n", "q Q0 a 1 1e999 tag\n",
            "q Q0 a 1 nope tag\n", "q Q0 a 1 1\n", "",
            "q Q0 a 1 1 tag\nq Q0 a 2 1 tag\n",
            "q Q0 a 1 1 tag\nq Q0 b 3 1 tag\n",
        ]
        for text in invalid:
            with self.subTest(text=text), self.assertRaises(ValueError):
                ev.read_run(self.file(text))

    def test_malformed_duplicate_or_nonfinite_qrels_fail(self):
        for text in ("", "q Q0 a nan\n", "q Q0 a 2.0\n", "q Q0 a -1\n", "q Q0 a 4\n", "q Q0 a\n", "q Q0 a 3\nq Q0 a 2\n"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                ev.read_qrels(self.file(text))

    def test_byte_counts_and_sha256_are_checked(self):
        path = self.file("abc")
        digest = hashlib.sha256(b"abc").hexdigest()
        self.assertEqual(ev.checked_bytes(path, digest, 3), b"abc")
        with self.assertRaisesRegex(ValueError, "Byte count"):
            ev.checked_bytes(path, digest, 2)
        with self.assertRaisesRegex(ValueError, "SHA256"):
            ev.checked_bytes(path, "0" * 64)
        path.write_text("abd")
        with self.assertRaisesRegex(ValueError, "SHA256"):
            ev.checked_bytes(path, digest, 3)

    def test_json_rejects_duplicate_keys_and_nonfinite_numbers(self):
        for text in ('{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', '{"a":1e999}'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                ev.strict_json(text)

    def test_output_is_fresh_and_nonfinite_output_is_rejected_before_creation(self):
        path = self.directory / "result.json"
        ev.write_fresh(path, {"a": 1})
        with self.assertRaises(FileExistsError):
            ev.write_fresh(path, {"a": 2})
        self.assertEqual(json.loads(path.read_text()), {"a": 1})
        invalid = self.directory / "nonfinite.json"
        with self.assertRaises(ValueError):
            ev.write_fresh(invalid, {"a": math.nan})
        self.assertFalse(invalid.exists())

    def development(self):
        depth = {candidate.name: {"macro": {"ndcg@10": 0.5}} for candidate in ev.CANDIDATES}
        depth[ev.CANDIDATES[1].name]["macro"]["ndcg@10"] = 0.75
        return {
            "schema": ev.SCHEMA, "phase": "development", "year": 2019,
            "source_binding": {"frozen": "sourcehash"}, "candidate_grid": ev.GRID,
            "protocol": ev.PROTOCOL, "depth_results": {"10": depth}, "selection": ev.choose(depth),
        }

    def test_selection_is_fixed_to_development_depth10_and_grid_ties(self):
        report = self.development()
        path = self.file(json.dumps(report), "development.json")
        selected, digest = ev.load_selection(path, report["source_binding"])
        self.assertEqual(selected, ev.CANDIDATES[1])
        self.assertEqual(digest, hashlib.sha256(path.read_bytes()).hexdigest())
        depth = {candidate.name: {"macro": {"ndcg@10": 0.5}} for candidate in ev.CANDIDATES}
        self.assertEqual(ev.choose(depth)["candidate"], ev.GRID[0])

    def test_selection_rejects_changed_sources_grid_protocol_or_winner(self):
        for key, replacement in (
            ("source_binding", {"frozen": "different"}), ("candidate_grid", ev.GRID[:-1]),
            ("protocol", {**ev.PROTOCOL, "selection_depth": 4}), ("phase", "heldout"),
            ("selection", {"candidate": ev.GRID[-1]}),
        ):
            report = deepcopy(self.development())
            report[key] = replacement
            with self.subTest(key=key), self.assertRaises(ValueError):
                ev.load_selection(self.file(json.dumps(report)), {"frozen": "sourcehash"})

    def test_original_metric_reproduction_is_a_hard_gate(self):
        runs = {engine: {"q": ["r"]} for engine in ev.ENGINES}
        judgments = {"q": {"r": 3}}
        members = {engine: {"expected_metrics": {"ndcg@10": 1, "mrr@10": 1, "recall@100": 1}} for engine in ev.ENGINES}
        validated = ev.verify_originals(runs, judgments, members)
        self.assertEqual(validated["bm25"]["actual"]["ndcg@10"], 1)
        members["bm25"]["expected_metrics"]["ndcg@10"] = 0.9
        with self.assertRaisesRegex(ValueError, "stop before candidate evaluation"):
            ev.verify_originals(runs, judgments, members)

    def test_cli_refuses_overwrite_before_loading_data(self):
        path = self.file("keep", "existing.json")
        result = subprocess.run([
            sys.executable, str(Path(ev.__file__)), "development", "--data-dir", str(self.directory / "missing"), "--output", str(path),
        ], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("Refusing to overwrite", result.stderr)
        self.assertEqual(path.read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
