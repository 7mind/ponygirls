#!/usr/bin/env python3
"""Escaped, read-only presentation of the original longitudinal graph trajectory."""
import argparse
import html
from pathlib import Path
from types import SimpleNamespace

from profile import Rejected, canonical
from run import read_json, sha, write_json
from session_run import load_session, score_result

HERE = Path(__file__).resolve().parent


def bind(directory: Path):
    names = [path for path in directory.rglob("*.json") if path.name != "presentation-bindings.json"]
    write_json(directory / "presentation-bindings.json", {"version":"steward-session-presentation-v1", "renderer_sha256":sha(Path(__file__)), "files":{str(path.relative_to(directory)):sha(path) for path in sorted(names)}})


def render(directory: Path, session_path: Path, oracle_path: Path) -> str:
    bindings = read_json(directory / "presentation-bindings.json")
    if bindings["renderer_sha256"] != sha(Path(__file__)):
        raise Rejected("renderer binding")
    actual_names = {str(path.relative_to(directory)) for path in directory.rglob("*.json") if path.name != "presentation-bindings.json"}
    if actual_names != set(bindings["files"]):
        raise Rejected("presentation inventory binding")
    for name, expected in bindings["files"].items():
        path = directory / name
        if not path.resolve().is_relative_to(directory.resolve()) or sha(path) != expected:
            raise Rejected("presentation artifact binding")
    score = read_json(directory / "score.json")
    if score != score_result(SimpleNamespace(session=session_path,oracle=oracle_path,out=directory)):
        raise Rejected("original score binding")
    session, _, _ = load_session(session_path,oracle_path)
    review = read_json(directory / "semantic-review.json")
    if review["score_sha256"] != sha(directory / "score.json") or review["attempts_sha256"] != sha(directory / "attempts.json") or review["manifest_sha256"] != sha(directory / "manifest.json"):
        raise Rejected("qualitative review binding")
    manifest = read_json(directory / "manifest.json")
    def escape(value):return html.escape(str(value),quote=True)
    def pretty(value):return escape(canonical(value).decode())
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Full-session ontology maintenance</title><style>body{font:16px system-ui;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#182533}table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #bcc8d0;text-align:left;vertical-align:top;padding:.5rem;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eef3f6;padding:1rem}summary{cursor:pointer;padding:.6rem;font-weight:600}article{border-top:2px solid #bcc8d0;margin-top:2rem}small{color:#405564}</style><body>',
             '<h1>Automatic ontology maintenance: one evolving synthetic session</h1>',
             '<p>Revising the ontology’s representation and intent tags is automatic curation, <strong>not editing Human intent</strong>. No per-change approval gate. Sources remain immutable; nodes/links are the model’s revisable account, not Human ratification or execution authority.</p>',
             f'<p><strong>{score["planned"]} planned / {score["attempted"]} admitted / {score["published"]} published checkpoints.</strong> {score["passed_checks"]}/{score["evaluated_checks"]} predeclared controls satisfied. These are not semantic-accuracy or Human-benefit measurements.</p>',
             f'<p>Model: <code>{escape(manifest["model"]["provider"])}/{escape(manifest["model"]["model"])}</code>, {escape(manifest["model"]["thinking"])} thinking. Source commit <code>{escape(manifest["source_commit"])}</code>. One persistent graph; raw growing source prefix plus actual prior model graph at each update. Fresh tool-less Agent per update. No repair, replacement or semantic rerun.</p>',
             '<p><strong>Evidence limits:</strong> compact24-event synthetic sequence fits the context window. Parent review is non-blind Agent judgment, not Human gold or independent-family certification. No native integration, long-session/context-eviction, deployment or Human-usability acceptance is implied.</p>',
             '<h2>Qualitative trajectory review</h2><pre>'+pretty(review)+'</pre>',
             '<details><summary>Complete immutable synthetic source session (24events)</summary>']
    for event in session["events"]:
        parts.append(f'<p id="{escape(event["id"])}"><strong>{escape(event["id"])} · {escape(event["role"])}</strong> {escape(event["text"])}</p>')
    parts.append('</details><h2>Every update, including original failures</h2>')
    for row in score["rows"]:
        key = row["checkpoint"]
        parts.append(f'<article id="{escape(key)}"><h3>{escape(key)} · {escape(row["status"])}</h3>')
        if row["status"] == "unattempted":
            parts.append('<p>Unattempted; no model result asserted.</p></article>')
            continue
        view = read_json(directory / key / "view.json")
        parts.append(f'<p>Source prefix through event{view["current_prefix"]}; last valid graph through event{view["last_valid_through"]}. {escape(view["coverage"])}</p>')
        parts.append('<details><summary>Maintained graph: all nodes and intent tags</summary><table><thead><tr><th>ID</th><th>Kind / intent / state / priority</th><th>Revisable account</th><th>Source IDs</th></tr></thead><tbody>')
        for node in view["graph"]["nodes"]:
            parts.append('<tr><td>'+escape(node["id"])+'</td><td>'+escape(' / '.join(node[field] for field in ("kind","intent","state","priority")))+'</td><td>'+escape(node["text"])+'</td><td>'+escape(', '.join(node["sources"]))+'</td></tr>')
        parts.append('</tbody></table><h4>All maintained relations</h4><pre>'+pretty(view["graph"]["relations"])+'</pre></details>')
        parts.append('<details><summary>Predeclared control results (not entailment)</summary><pre>'+pretty(row)+'</pre></details></article>')
    parts.append('<details><summary>Frozen generic curator prompt</summary><pre>'+escape(read_json(directory / "C01/request.json")["system"])+'</pre></details><p><small>All original JSON records and version history are retained in the repository evidence bundle. Static view; no inference, scripts, operational controls or credential material.</small></p></body></html>')
    return ''.join(parts)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command",choices=("bind","render"))
    parser.add_argument("--directory",type=Path,required=True)
    parser.add_argument("--session",type=Path,required=True)
    parser.add_argument("--oracle",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    args = parser.parse_args()
    if args.command == "bind":bind(args.directory)
    else:
        with args.output.open("x",encoding="utf-8") as output:output.write(render(args.directory,args.session,args.oracle))

if __name__ == "__main__":main()
