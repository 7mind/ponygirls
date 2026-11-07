#!/usr/bin/env python3
"""Offline target-page diagnostics; these are not complete relevance judgments."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import random
import re
import statistics
from urllib.parse import urlsplit

from evaluate import BASELINE, CANDIDATES, fuse, strict_json, write_fresh

DEPTHS = (4, 10)
SHUFFLE_REPETITIONS = 100
SHUFFLE_SEED = 20261107


def target(document, query):
    parsed = urlsplit(document)
    return any(parsed.hostname == item["host"] and re.search(item["path"], parsed.path) for item in query["targets"])


def target_metrics(ranking, query):
    rank = next((rank for rank, document in enumerate(ranking[:10], 1) if target(document, query)), None)
    return {"target_hit@10": int(rank is not None), "target_rr@10": 1 / rank if rank else 0.0,
            "target_in_pool": int(any(target(document, query) for document in ranking))}


def macro(rows):
    if not rows:
        raise ValueError("No live diagnostic cases")
    return {key: sum(row[key] for row in rows) / len(rows) for key in rows[0]}


def jaccard(left, right):
    union = set(left) | set(right)
    return len(set(left) & set(right)) / len(union) if union else 1.0


def replay(fixture):
    if fixture["schema"] != 1 or not fixture["cases"]:
        raise ValueError("Expected nonempty normalized live fixture")
    cases = fixture["cases"]
    if len({case["query"]["id"] for case in cases}) != len(cases):
        raise ValueError("Duplicate live query IDs")
    for case in cases:
        names = [engine["name"] for engine in case["engines"]]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate live engine IDs")
        for engine in case["engines"]:
            if type(engine["ok"]) is not bool or engine["tier"] not in ("main", "fallback", "native"):
                raise ValueError("Invalid live engine status/tier")
            if any(not isinstance(document, str) for document in engine["documents"]):
                raise ValueError("Invalid document identity")
        lists = [(engine["name"], engine["documents"]) for engine in case["engines"] if engine["ok"]]
        if fuse(lists, BASELINE) != case["productionRrf60"]:
            raise ValueError(f"Python/production RRF60 parity failed: {case['query']['id']}")

    results = {}
    for depth in DEPTHS:
        per_candidate = {}
        for candidate in CANDIDATES:
            observations = {}
            for case in cases:
                lists = [(engine["name"], engine["documents"][:depth]) for engine in case["engines"] if engine["ok"]]
                observations[case["query"]["id"]] = target_metrics(fuse(lists, candidate), case["query"])
            per_candidate[candidate.name] = {"macro": macro(list(observations.values())), "per_query": observations}
        results[str(depth)] = per_candidate

    by_engine, overlaps = {}, {}
    for case in cases:
        for engine in case["engines"]:
            state = by_engine.setdefault(engine["name"], {"attempted": 0, "success": 0, "empty": 0, "failed": 0, "returned": 0, "duplicate_rows": 0, "elapsed_ms": [], "targets": []})
            state["attempted"] += 1
            state["success" if engine["ok"] else "failed"] += 1
            state["empty"] += int(engine["ok"] and not engine["documents"])
            state["returned"] += len(engine["documents"])
            state["duplicate_rows"] += engine["duplicateRows"]
            state["elapsed_ms"].append(engine["elapsedMs"])
            state["targets"].append(target_metrics(engine["documents"], case["query"]))
        successful = [engine for engine in case["engines"] if engine["ok"]]
        for left, right in itertools.combinations(successful, 2):
            key = " | ".join(sorted((left["name"], right["name"])))
            overlaps.setdefault(key, []).append(jaccard(left["documents"][:10], right["documents"][:10]))
    for state in by_engine.values():
        state["target_metrics"] = macro(state.pop("targets"))
        durations = state.pop("elapsed_ms")
        state["median_elapsed_ms"] = statistics.median(durations)
        state["max_elapsed_ms"] = max(durations)

    perturbations = {}
    for candidate_name in ("rrf_k60", "rrf_k10"):
        candidate = next(item for item in CANDIDATES if item.name == candidate_name)
        rng = random.Random(SHUFFLE_SEED)
        rows = {}
        for case in cases:
            engines = [engine for engine in case["engines"] if engine["ok"]]
            original = fuse([(engine["name"], engine["documents"][:10]) for engine in engines], candidate)
            original_top = original[:10]
            shuffles = []
            for _ in range(SHUFFLE_REPETITIONS):
                lists = []
                for engine in engines:
                    documents = list(engine["documents"][:10])
                    if engine["tier"] == "native":
                        rng.shuffle(documents)
                    lists.append((engine["name"], documents))
                ranking = fuse(lists, candidate)
                shuffles.append({"top10_set_jaccard": jaccard(original_top, ranking[:10]),
                                 "ordered_top10_changed": int(original_top != ranking[:10]),
                                 "target_rr@10": target_metrics(ranking, case["query"])["target_rr@10"]})
            native = next((engine for engine in engines if engine["tier"] == "native"), None)
            cloned = original if native is None else fuse([(engine["name"], engine["documents"][:10]) for engine in engines] + [("deliberate-clone:" + native["name"], native["documents"][:10])], candidate)
            rows[case["query"]["id"]] = {"native_order_shuffle_mean": macro(shuffles), "clone_top10_set_jaccard": jaccard(original_top, cloned[:10]),
                "clone_ordered_top10_changed": original_top != cloned[:10], "clone_target_rr@10": target_metrics(cloned, case["query"])["target_rr@10"]}
        perturbations[candidate_name] = {"seed": SHUFFLE_SEED, "repetitions_per_query": SHUFFLE_REPETITIONS, "per_query": rows,
            "mean_shuffle": macro([row["native_order_shuffle_mean"] for row in rows.values()]),
            "mean_clone_set_jaccard": statistics.mean(row["clone_top10_set_jaccard"] for row in rows.values()),
            "clone_changed_query_count": sum(row["clone_ordered_top10_changed"] for row in rows.values())}
    durations = [case["elapsedMs"] for case in cases]
    return {"schema": 1, "query_count": len(cases), "limitations": ["Target predicates are not full relevance judgments; non-targets remain unjudged.",
        "Depth4 is a prefix replay of depth10 requests, not a new production retrieval.", "Native citations are in source-encounter order; relevance-order guarantee is unverified.",
        "Exact-clone and native-order permutations are sensitivity probes, not observed production configurations.",
        "Shared URLs indicate overlap, not statistically independent corroboration or factual correctness."],
        "source_binding": fixture["binding"], "production_rrf60_parity_cases": len(cases), "depth_results": results,
        "engines": by_engine, "mean_pairwise_top10_jaccard": {key: statistics.mean(values) for key, values in overlaps.items()},
        "native_perturbations": perturbations, "median_query_ms": statistics.median(durations), "max_query_ms": max(durations)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"Refusing to overwrite: {args.output}")
    raw = args.input.read_bytes()
    report = replay(strict_json(raw))
    report["fixture_sha256"] = hashlib.sha256(raw).hexdigest()
    write_fresh(args.output, report)
    print(json.dumps({"queries": report["query_count"], "rrf60_depth10": report["depth_results"]["10"]["rrf_k60"]["macro"], "output": str(args.output)}))


if __name__ == "__main__":
    main()
