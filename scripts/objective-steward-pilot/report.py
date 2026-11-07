#!/usr/bin/env python3
"""Escaped, static synthetic evidence viewer; never invokes a model or applies edits."""
import argparse
from html import escape
import json
from pathlib import Path

from run import admitted_attempts, corpus, frozen_sources, read_json, sha


def literal(value: object) -> str:
    return "<pre>" + escape(json.dumps(value, indent=2, ensure_ascii=False)) + "</pre>"


def generate(cases_path: Path, oracle_path: Path, directory: Path) -> str:
    cases, oracle = corpus(cases_path, oracle_path)
    manifest = read_json(directory / "manifest.json")
    score = read_json(directory / "score.json")
    if frozen_sources(cases_path, oracle_path) != manifest["source_sha256"] or score["manifest_sha256"] != sha(directory / "manifest.json"):
        raise ValueError("report source binding mismatch")
    inventory = directory / "attempts.json"
    observed_inventory = sha(inventory) if inventory.exists() else None
    if score["attempts_sha256"] != observed_inventory:
        raise ValueError("report score-to-attempt binding mismatch")
    qualitative_path = directory / "semantic-review.json"
    if qualitative_path.exists():
        qualitative = read_json(qualitative_path)
        if qualitative["score_sha256"] != sha(directory / "score.json") or {item["case"] for item in qualitative["rows"]} != {item["id"] for item in cases} or len(qualitative["rows"]) != len(cases):
            raise ValueError("qualitative review binding mismatch")
        qualifications = ["<h2>Qualitative findings (non-blind Agent, not Human gold)</h2><p>" + escape(qualitative["method"]) + "</p><p><strong>" + escape(qualitative["conclusion"]) + "</strong></p><ul>"]
        for item in qualitative["rows"]:
            for key in ("risk", "qualification"):
                if key in item:
                    qualifications.append("<li><strong>" + escape(item["case"]) + ":</strong> " + escape(item[key]) + "</li>")
        qualifications.append("</ul><h3>Unestablished capabilities</h3>" + literal(qualitative["cross_case_limits"]) + "<details><summary>Full qualitative assessment of all sixteen cases</summary>" + literal(qualitative["rows"]) + "</details>")
        qualitative_html = "".join(qualifications)
    else:
        qualitative_html = "<p class='warning'>No qualitative review supplied. Mechanical results do not establish faithful objective interpretation, ontology quality or Human benefit.</p>"
    attempts = {item["case"]: item for item in admitted_attempts(directory, cases)}
    if attempts and score["attempts_sha256"] is None:
        raise ValueError("report score has no anchored attempt inventory")
    if {item["case"] for item in score["rows"]} != {item["id"] for item in cases} or len(score["rows"]) != len(cases):
        raise ValueError("report inventory mismatch")
    cards = []
    for case in cases:
        row = next(item for item in score["rows"] if item["case"] == case["id"])
        attempt = attempts.get(case["id"])
        expected_status = "unattempted" if attempt is None else attempt["status"]
        if row["status"] != expected_status:
            raise ValueError("report attempt status mismatch")
        artifacts = {} if attempt is None else attempt.get("artifacts", {})
        for name, expected in artifacts.items():
            target = directory / case["id"] / name
            if Path(name).name != name or target.resolve().parent != (directory / case["id"]).resolve() or sha(target) != expected:
                raise ValueError("report artifact binding mismatch")
        path = directory / case["id"] / "view.json"
        view = read_json(path) if "view.json" in artifacts else None
        if view is not None and (view["input"] != case["input"] or view["human_acceptance"] != "not-recorded"):
            raise ValueError("report primary-record invariant violated")
        cards.append("<section><h2>" + escape(case["id"] + " · " + case["split"] + " · " + row["status"]) + "</h2>")
        for source in case["input"]["sources"]:
            if source["role"] == "human":
                cards.append("<h3>Synthetic Human request · " + escape(source["id"]) + "</h3><p>" + escape(source["text"]) + "</p>")
        cards.append("<h3>Tracked objectives and worker claims</h3>" + literal({"objectives": case["input"]["objectives"], "claims": case["input"]["claims"]}))
        if view is not None:
            cards.append("<h3>Steward account, notes, assessments and proposals</h3>" + literal(view["review"]))
            cards.append("<p><strong>Human acceptance: " + escape(view["human_acceptance"]) + "</strong> · Coverage: " + escape(view["coverage"]) + " · Semantic completeness: not established.</p>")
            cards.append("<details><summary>Feedback issue state (not an SDK delivery receipt)</summary>" + literal(view["issues"]) + "</details>")
        cards.append("<details><summary>All synthetic sources, exact revisions and gaps</summary>" + literal(case["input"]) + "</details>")
        cards.append("<details><summary>Predeclared Agent-authored oracle and mechanical checks (not Human gold)</summary>" + literal({"oracle": oracle[case["id"]], "checks": row}) + "</details></section>")
    summary = {key: score[key] for key in ("planned", "attempted", "published", "verdict_checks", "verdict_matches", "citation_matches", "primary_source_links")}
    return """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Objective steward · synthetic feasibility pilot</title><style>
body{background:#111827;color:#e5e7eb;font:16px/1.55 system-ui,sans-serif;max-width:1000px;margin:auto;padding:24px}h1,h2,h3,summary{color:#c4d5fa}section{border:1px solid #475569;border-radius:12px;padding:20px;margin:24px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#182235;border-radius:8px;padding:14px;font-size:14px}p{overflow-wrap:anywhere}details{margin:18px 0}summary{cursor:pointer}strong{color:#fde68a}.warning{border-left:4px solid #f59e0b;padding:12px 20px;background:#222535}a{color:#a5c9ff}
</style><h1>Objective steward: feasibility, not acceptance</h1>
<p>Isolated prescribed-profile pilot. Synthetic captures only; no private sessions, installed writer, live goal mutation or automatic Human approval. A fresh tool-less model reviews each input.</p>
<p class="warning">Controls below test verdict/citation/source-link behavior on a small authored corpus, not complete semantic truth or improved Human oversight. Native Pi commands/hotkeys, real safe-boundary feedback and native source authentication are not implemented. Pending-request crash recovery remains fail-closed and unresolved.</p>
<h2>Single-pass control results</h2>""" + literal(summary) + "<p>Generic prompt and oracle were frozen before live evaluation. No participant replacement or rescue. Oracle and qualitative review are fallible Agent judgments, not Human gold. Correct-worker cases are negative controls against manufactured criticism.</p>" + literal({"model": {key: manifest["model"][key] for key in ("provider", "model", "thinking")}, "source_commit": manifest["head"], "prompt_sha256": manifest["prompt_sha256"], "score_sha256": sha(directory / "score.json")}) + qualitative_html + "".join(cards) + "<footer><p>Read-only evidence presentation. Expanding a section records no acceptance, acknowledgement or authorization. Any proposed correction remains a proposal; original intent and worker claims remain visible.</p></footer></html>"

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--oracle", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--html", type=Path, required=True)
    args = parser.parse_args()
    result = generate(args.cases, args.oracle, args.out)
    with args.html.open("x", encoding="utf-8") as stream:
        stream.write(result)
