#!/usr/bin/env python3
"""Offline, fixed-protocol evaluation of the frozen TREC-DL BM25/CE runs."""

import argparse
from dataclasses import asdict, dataclass
import hashlib
import json
import math
from pathlib import Path
import random

SCHEMA = "pi-search-hub.fusion-evaluation.v1"
MANIFEST_SHA256 = "1e74650954e188f3aa6970d1585445d401b8b2d2d2f8a132489e39100c918e52"
QRELS = {
    2019: ("qrels.dl19-passage.txt", "8a1f10d550732e4cd91d7fc49846a3784de4040972f583e69285a88f3c5fee92", 43),
    2020: ("qrels.dl20-passage.txt", "60d4c34561f9687f8f73e0a752ba80ab80159b3e9c1bedd0a351f747ed6f5684", 54),
}
ENGINES = ("bm25", "bm25_ce")
DEPTHS = (4, 10, 20, 100)
BOOTSTRAP_REPETITIONS = 10_000
BOOTSTRAP_SEED = 20260601
TOLERANCE = 1e-12
PROTOCOL = {
    "selection_year": 2019,
    "heldout_year": 2020,
    "selection_depth": 10,
    "selection_metric": "ndcg@10",
    "selection_tie_break": "candidate_grid_order",
    "depths": list(DEPTHS),
    "ndcg_gain": "linear_grade",
    "binary_relevance_threshold": 2,
    "macro_queries": "all_qrels_queries; none_silently_excluded",
    "fusion_tie_break": ["score_desc", "independent_votes_desc", "first_encounter"],
    "engine_order": list(ENGINES),
    "dedup": "per_engine_before_ranking; preserve_first_encounter",
    "bootstrap_repetitions": BOOTSTRAP_REPETITIONS,
    "bootstrap_seed": BOOTSTRAP_SEED,
    "bootstrap_interval": "paired_percentile_95; linear_interpolation",
    "comparison_tie_tolerance": TOLERANCE,
}


@dataclass(frozen=True)
class Candidate:
    name: str
    method: str
    parameter: float | None = None


CANDIDATES = tuple(
    [Candidate(f"rrf_k{k}", "rrf", k) for k in (0, 10, 20, 60, 100)]
    + [Candidate(f"rbc_p{p}", "rbc", p) for p in (0.5, 0.8, 0.9, 0.95)]
    + [Candidate("borda", "borda")]
)
GRID = [asdict(candidate) for candidate in CANDIDATES]
BASELINE = next(candidate for candidate in CANDIDATES if candidate.name == "rrf_k60")


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    def invalid(value):
        raise ValueError(f"Nonfinite JSON value: {value}")

    def finite_float(value):
        parsed = float(value)
        if not math.isfinite(parsed):
            invalid(value)
        return parsed

    return json.loads(data, object_pairs_hook=pairs, parse_constant=invalid, parse_float=finite_float)


def checked_bytes(path, expected_sha256, expected_size=None):
    data = path.read_bytes()
    if expected_size is not None and len(data) != expected_size:
        raise ValueError(f"Byte count mismatch: {path}")
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise ValueError(f"SHA256 mismatch: {path}")
    return data


def validate_sources(directory):
    manifest = strict_json(checked_bytes(directory / "bundle_manifest.json", MANIFEST_SHA256))
    files = {}
    for member in manifest["members"]:
        name = member["path"]
        if name in files:
            raise ValueError(f"Duplicate manifest member: {name}")
        checked_bytes(directory / name, member["sha256"], member["bytes"])
        files[name] = member["sha256"]
    for name, sha256, _count in QRELS.values():
        checked_bytes(directory / name, sha256)
        files[name] = sha256
    return manifest, {"bundle_manifest_sha256": MANIFEST_SHA256, "files": files}


def read_qrels(path):
    judgments = {}
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        fields = line.split()
        if len(fields) != 4 or fields[1] not in ("0", "Q0"):
            raise ValueError(f"Malformed qrels row {path}:{line_number}")
        qid, _unused, docid, raw_grade = fields
        try:
            grade = int(raw_grade)
        except ValueError as error:
            raise ValueError(f"Malformed grade {path}:{line_number}") from error
        if grade not in (0, 1, 2, 3):
            raise ValueError(f"Invalid TREC-DL grade {path}:{line_number}")
        query = judgments.setdefault(qid, {})
        if docid in query:
            raise ValueError(f"Duplicate qrels document {qid}/{docid}")
        query[docid] = grade
    if not judgments:
        raise ValueError(f"Empty qrels: {path}")
    return judgments


def read_run(path):
    rankings, seen = {}, {}
    for line_number, line in enumerate(path.read_text().splitlines(), 1):
        fields = line.split()
        if len(fields) != 6 or fields[1] != "Q0":
            raise ValueError(f"Malformed run row {path}:{line_number}")
        qid, _unused, docid, raw_rank, raw_score, _tag = fields
        ranking = rankings.setdefault(qid, [])
        try:
            rank, score = int(raw_rank), float(raw_score)
        except ValueError as error:
            raise ValueError(f"Malformed rank/score {path}:{line_number}") from error
        if rank != len(ranking) + 1 or not raw_rank.isdecimal():
            raise ValueError(f"Noncontiguous/malformed rank {path}:{line_number}")
        if not math.isfinite(score):
            raise ValueError(f"Nonfinite score {path}:{line_number}")
        query_seen = seen.setdefault(qid, set())
        if docid in query_seen:
            raise ValueError(f"Duplicate run document {qid}/{docid}")
        query_seen.add(docid)
        ranking.append(docid)
    if not rankings:
        raise ValueError(f"Empty run: {path}")
    return rankings


def require_queries(rankings, judgments):
    if set(rankings) != set(judgments):
        missing = sorted(set(judgments) - set(rankings))
        extra = sorted(set(rankings) - set(judgments))
        raise ValueError(f"Query mismatch: missing={missing}, extra={extra}")


def load_year(directory, manifest, year):
    qrels_name, _sha, count = QRELS[year]
    judgments = read_qrels(directory / qrels_name)
    if len(judgments) != count:
        raise ValueError(f"Expected {count} judged queries for {year}, got {len(judgments)}")
    members = {member["system"]: member for member in manifest["members"] if member.get("year") == year}
    if set(members) != set(ENGINES):
        raise ValueError(f"Unexpected systems for {year}")
    runs = {}
    for engine in ENGINES:
        member = members[engine]
        run = read_run(directory / member["path"])
        require_queries(run, judgments)
        if len(run) != member["query_count"] or sum(map(len, run.values())) != member["row_count"]:
            raise ValueError(f"Run count mismatch: {engine}/{year}")
        if any(len(ranking) != member["max_depth"] for ranking in run.values()):
            raise ValueError(f"Run depth mismatch: {engine}/{year}")
        runs[engine] = run
    return runs, judgments, members


def fuse(engine_lists, candidate):
    """One vote per engine/document, with production RRF60 tie semantics."""
    if candidate not in CANDIDATES:
        raise ValueError(f"Unknown candidate: {candidate}")
    scores, votes, seen_engines = {}, {}, set()
    for engine, documents in engine_lists:
        if engine in seen_engines:
            raise ValueError(f"Duplicate engine: {engine}")
        seen_engines.add(engine)
        unique = list(dict.fromkeys(documents))
        for rank, docid in enumerate(unique, 1):
            if candidate.method == "rrf":
                contribution = 1 / (candidate.parameter + rank)
            elif candidate.method == "rbc":
                contribution = (1 - candidate.parameter) * candidate.parameter ** (rank - 1)
            else:
                contribution = (len(unique) - rank + 1) / len(unique)
            scores[docid] = scores.get(docid, 0.0) + contribution
            votes[docid] = votes.get(docid, 0) + 1
    first = {docid: index for index, docid in enumerate(scores)}
    return sorted(scores, key=lambda docid: (-scores[docid], -votes[docid], first[docid]))


def recall_at(ranking, judgments, cutoff):
    relevant = {docid for docid, grade in judgments.items() if grade >= 2}
    return len(set(ranking[:cutoff]) & relevant) / len(relevant) if relevant else 0.0


def query_metrics(ranking, judgments):
    if len(ranking) != len(set(ranking)):
        raise ValueError("Duplicate document in metric ranking")
    if any(type(grade) is not int or grade not in (0, 1, 2, 3) for grade in judgments.values()):
        raise ValueError("Invalid/nonfinite metric judgment")
    top = ranking[:10]
    ideal = math.fsum(grade / math.log2(rank + 1) for rank, grade in enumerate(sorted(judgments.values(), reverse=True)[:10], 1))
    dcg = math.fsum(judgments.get(docid, 0) / math.log2(rank + 1) for rank, docid in enumerate(top, 1))
    return {
        "ndcg@10": dcg / ideal if ideal else 0.0,
        "mrr@10": next((1 / rank for rank, docid in enumerate(top, 1) if judgments.get(docid, 0) >= 2), 0.0),
        "recall@10": recall_at(ranking, judgments, 10),
        "judged_fraction@10": sum(docid in judgments for docid in top) / len(top) if top else 0.0,
        "results_returned@10": len(top),
        "pool_recall": recall_at(ranking, judgments, len(ranking)),
    }


def summarize(rankings, judgments):
    require_queries(rankings, judgments)
    if not judgments:
        raise ValueError("No judged queries to average")
    per_query = {qid: query_metrics(rankings[qid], judgments[qid]) for qid in sorted(judgments)}
    macro = {metric: math.fsum(row[metric] for row in per_query.values()) / len(per_query) for metric in next(iter(per_query.values()))}
    return {"macro": macro, "per_query": per_query}


def verify_originals(runs, judgments, members):
    verified = {}
    for engine in ENGINES:
        summary = summarize(runs[engine], judgments)["macro"]
        expected = members[engine]["expected_metrics"]
        actual = {}
        for metric, target in expected.items():
            if metric.startswith("recall@"):
                cutoff = int(metric.split("@")[1])
                actual[metric] = math.fsum(recall_at(runs[engine][qid], grades, cutoff) for qid, grades in judgments.items()) / len(judgments)
            else:
                actual[metric] = summary[metric]
            if not math.isfinite(target) or not math.isclose(actual[metric], target, rel_tol=0, abs_tol=TOLERANCE):
                raise ValueError(f"Original metric mismatch; stop before candidate evaluation: {engine} {metric}: {actual[metric]} != {target}")
        verified[engine] = {"expected": expected, "actual": actual}
    return verified


def evaluate_depth(runs, judgments, depth, candidates):
    result = {engine: summarize({qid: docs[:depth] for qid, docs in runs[engine].items()}, judgments) for engine in ENGINES}
    for candidate in candidates:
        rankings = {
            qid: fuse([(engine, runs[engine][qid][:depth]) for engine in ENGINES], candidate)
            for qid in judgments
        }
        result[candidate.name] = summarize(rankings, judgments)
    return result


def choose(development_depth):
    values = [development_depth[candidate.name]["macro"]["ndcg@10"] for candidate in CANDIDATES]
    if any(not math.isfinite(value) or not 0 <= value <= 1 for value in values):
        raise ValueError("Invalid development selection metric")
    winner = CANDIDATES[max(range(len(values)), key=lambda index: values[index])]
    return {"candidate": asdict(winner), "depth": 10, "metric": "ndcg@10", "value": max(values)}


def percentile(sorted_values, probability):
    position = (len(sorted_values) - 1) * probability
    lower = math.floor(position)
    upper = math.ceil(position)
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (position - lower)


def paired_bootstrap(selected, control, repetitions=BOOTSTRAP_REPETITIONS, seed=BOOTSTRAP_SEED):
    if not selected or len(selected) != len(control) or repetitions < 1:
        raise ValueError("Bootstrap requires nonempty equal-length paired observations and positive repetitions")
    if any(not math.isfinite(value) for value in [*selected, *control]):
        raise ValueError("Nonfinite bootstrap metric")
    deltas = [left - right for left, right in zip(selected, control)]
    rng = random.Random(seed)
    samples = sorted(math.fsum(deltas[rng.randrange(len(deltas))] for _ in deltas) / len(deltas) for _ in range(repetitions))
    return {
        "mean_delta": math.fsum(deltas) / len(deltas),
        "ci95": [percentile(samples, 0.025), percentile(samples, 0.975)],
        "wins": sum(delta > TOLERANCE for delta in deltas),
        "ties": sum(abs(delta) <= TOLERANCE for delta in deltas),
        "losses": sum(delta < -TOLERANCE for delta in deltas),
        "query_count": len(deltas),
        "repetitions": repetitions,
        "seed": seed,
    }


def compare_selected(depth_results, selected_name):
    comparisons = {}
    for control in (BASELINE.name, *ENGINES):
        comparisons[control] = {}
        for metric in ("ndcg@10", "recall@10"):
            selected = depth_results[selected_name]["per_query"]
            other = depth_results[control]["per_query"]
            if set(selected) != set(other):
                raise ValueError("Unpaired query IDs in heldout comparison")
            qids = sorted(selected)
            comparisons[control][metric] = paired_bootstrap(
                [selected[qid][metric] for qid in qids], [other[qid][metric] for qid in qids],
            )
    return comparisons


def load_selection(path, source_binding):
    raw = path.read_bytes()
    development = strict_json(raw)
    if development.get("schema") != SCHEMA or development.get("phase") != "development" or development.get("year") != 2019:
        raise ValueError("Selection must come from a development evaluation")
    if development.get("source_binding") != source_binding or development.get("candidate_grid") != GRID or development.get("protocol") != PROTOCOL:
        raise ValueError("Selection source hashes/candidate grid/protocol differ")
    selection = development["selection"]
    if selection != choose(development["depth_results"]["10"]):
        raise ValueError("Selection does not match the fixed development winner")
    candidate = next((candidate for candidate in CANDIDATES if asdict(candidate) == selection["candidate"]), None)
    if candidate is None:
        raise ValueError("Selected candidate is outside the frozen grid")
    return candidate, hashlib.sha256(raw).hexdigest()


def run_phase(phase, directory, selection_path=None):
    if phase not in ("development", "heldout"):
        raise ValueError(f"Unknown phase: {phase}")
    manifest, binding = validate_sources(directory)
    year = 2019 if phase == "development" else 2020
    selected = selection_digest = None
    if phase == "heldout":
        if selection_path is None:
            raise ValueError("Heldout requires a frozen development selection")
        selected, selection_digest = load_selection(selection_path, binding)
    runs, judgments, members = load_year(directory, manifest, year)
    # This gate deliberately precedes *every* candidate metric computation.
    originals = verify_originals(runs, judgments, members)
    candidates = CANDIDATES if phase == "development" else tuple(dict.fromkeys((selected, BASELINE)))
    depths = {str(depth): evaluate_depth(runs, judgments, depth, candidates) for depth in DEPTHS}
    report = {
        "schema": SCHEMA, "phase": phase, "year": year, "query_count": len(judgments),
        "source_binding": binding, "candidate_grid": GRID, "protocol": PROTOCOL,
        "original_system_validation": originals, "depth_results": depths,
    }
    if phase == "development":
        report["selection"] = choose(depths["10"])
    else:
        report["fixed_candidate"] = asdict(selected)
        report["development_selection_sha256"] = selection_digest
        report["paired_comparisons"] = {depth: compare_selected(results, selected.name) for depth, results in depths.items()}
    return report


def write_fresh(path, report):
    serialized = json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n"
    with path.open("x") as output:
        output.write(serialized)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="phase", required=True)
    for phase in ("development", "heldout"):
        subparser = subparsers.add_parser(phase)
        subparser.add_argument("--data-dir", required=True, type=Path)
        subparser.add_argument("--output", required=True, type=Path)
        if phase == "heldout":
            subparser.add_argument("--selection", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise FileExistsError(f"Refusing to overwrite: {args.output}")
        report = run_phase(args.phase, args.data_dir, getattr(args, "selection", None))
        write_fresh(args.output, report)
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, f"evaluation failed: {error}\n")
    print(json.dumps({"output": str(args.output), "phase": args.phase, "selection": report.get("selection", report.get("fixed_candidate"))}, sort_keys=True))


if __name__ == "__main__":
    main()
