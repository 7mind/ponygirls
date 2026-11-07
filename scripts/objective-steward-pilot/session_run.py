#!/usr/bin/env python3
"""Single-pass full-session ontology maintenance on raw synthetic conversation events."""
import argparse
import asyncio
import hashlib
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
import time

from profile import Rejected, canonical, decode, fields, items, text
from run import execution_identity, read_json, sha, write_json
from session_model import SessionModel, SessionModelConfig
from session_pilot import SessionPilot
from session_profile import Graph, KINDS, RELATIONS, STATES, SYSTEM, parse_events, parse_graph
from store import SqliteStore

HERE = Path(__file__).resolve().parent
SOURCE_NAMES = ("session_profile.py", "session_pilot.py", "session_model.py", "session_run.py", "profile.py", "store.py", "run.py", "pilot.py", "live.mjs")


def selector(value, event_ids):
    item = fields(value, {"kind", "intent", "state", "priority", "sources_any", "words_any"})
    for key, allowed in (("kind", KINDS), ("intent", ("explicit", "inferred", "none")), ("state", STATES), ("priority", ("primary", "secondary", "none"))):
        if item[key] is not None and item[key] not in allowed:
            raise Rejected("invalid oracle selector")
    if type(item["sources_any"]) is not list or not set(item["sources_any"]) <= event_ids or type(item["words_any"]) is not list or any(type(word) is not str or not word for word in item["words_any"]):
        raise Rejected("oracle selector source/text")
    return item


def load_session(session_path: Path, oracle_path: Path):
    session = fields(read_json(session_path), {"version", "session", "events", "checkpoints"})
    oracle = fields(read_json(oracle_path), {"version", "session", "checkpoints"})
    if session["version"] != "steward-session-v1" or oracle["version"] != "steward-session-oracle-v1" or session["session"] != oracle["session"]:
        raise Rejected("session version/identity")
    text(session["session"])
    events = parse_events(session["events"])
    checkpoints = items(session["checkpoints"], 16)
    answers = items(oracle["checkpoints"], 16)
    if len(events) != 24 or len(checkpoints) != 12 or len(answers) != 12:
        raise Rejected("full session inventory")
    previous_keys = {}
    for index, (checkpoint, answer) in enumerate(zip(checkpoints, answers)):
        fields(checkpoint, {"id", "through"})
        fields(answer, {"id", "requirements", "relations", "identity", "forbidden", "rationale"})
        if checkpoint["id"] != f"C{index+1:02}" or checkpoint["through"] != events[2*index+1].id or answer["id"] != checkpoint["id"]:
            raise Rejected("checkpoint order")
        available = {item.id for item in events[:2*index+2]}
        keys = set()
        for requirement in items(answer["requirements"], 32):
            fields(requirement, {"key", "selector", "min", "max"})
            if requirement["key"] in keys or type(requirement["min"]) is not int or type(requirement["max"]) is not int or not 0 <= requirement["min"] <= requirement["max"] <= 64:
                raise Rejected("requirement cardinality")
            keys.add(text(requirement["key"]))
            selector(requirement["selector"], available)
        for relation in items(answer["relations"], 32):
            fields(relation, {"kind", "from", "to", "min"})
            if relation["kind"] not in RELATIONS or relation["from"] not in keys or relation["to"] not in keys or type(relation["min"]) is not int or relation["min"] < 1:
                raise Rejected("oracle relation")
        for rule in items(answer["identity"], 32):
            fields(rule, {"selector", "same_as"})
            prior = fields(rule["same_as"], {"checkpoint", "selector"})
            if rule["selector"] not in keys or prior["checkpoint"] not in previous_keys or prior["selector"] not in previous_keys[prior["checkpoint"]]:
                raise Rejected("oracle identity")
        for forbidden in items(answer["forbidden"], 32):
            selector(forbidden, available)
        previous_keys[checkpoint["id"]] = keys
    return session, events, {item["id"]: item for item in answers}


def checkpoint_inventory(directory, receipts):
    temporary = directory / "attempts.next"
    write_json(temporary, receipts)
    temporary.replace(directory / "attempts.json")


async def evaluate(args):
    identity = execution_identity()
    if args.session.resolve() != HERE / "fixtures/session-001.json" or args.oracle.resolve() != HERE / "fixtures/session-001-oracle.json":
        raise Rejected("use committed frozen full session")
    session, events, _ = load_session(args.session, args.oracle)
    args.out.mkdir(parents=True, exist_ok=False)
    write_json(args.out / "manifest.json", {"version": "steward-session-run-v1", "source_commit": identity,
               "source_identity_sha256": sha(HERE / "source-identity.json"), "session_sha256": sha(args.session), "oracle_sha256": sha(args.oracle),
               "prompt_sha256": hashlib.sha256(SYSTEM.encode()).hexdigest(), "started": datetime.now(timezone.utc).isoformat(),
               "model": {key: getattr(args, key) for key in ("node", "sdk", "provider", "model", "thinking")},
               "procedure": "One persistent graph across all checkpoints. Raw chronological prefix + last committed model graph only; no oracle/selectors/manual ontology seeded. No repair/rerun/provider fallback."})
    (args.out / "source-identity.json").write_bytes((HERE / "source-identity.json").read_bytes())
    await execute(args, session, events, SessionModel)


async def execute(args, session, events, model_factory):
    store = SqliteStore(args.out / "session.sqlite", "write")
    pilot = SessionPilot(store)
    pilot.initialize(session["session"])
    receipts = []
    checkpoint_inventory(args.out, receipts)
    try:
        for index, checkpoint in enumerate(session["checkpoints"]):
            directory = args.out / checkpoint["id"]
            directory.mkdir()
            pilot.append(events[2*index:2*index+2])
            ticket = pilot.begin(checkpoint["id"])
            write_json(directory / "snapshot.json", ticket.snapshot.wire())
            write_json(directory / "admission.json", {"checkpoint": checkpoint["id"], "input_sha256": sha(directory / "snapshot.json"), "previous_graph_sha256": ticket.snapshot.previous.fingerprint(), "event_count": len(ticket.snapshot.events)})
            worker = model_factory(SessionModelConfig(args.node, args.sdk, args.provider, args.model, args.thinking), directory)
            started = time.monotonic()
            interrupted = False
            try:
                raw = await worker.review(ticket.snapshot)
                pilot.publish(ticket, decode(raw, 32768))
            except asyncio.CancelledError:
                interrupted = True
                pilot.fail(ticket, "interrupted")
                raise
            except Exception as error:
                pilot.fail(ticket, str(error) if isinstance(error, Rejected) else type(error).__name__)
            finally:
                pilot.drained(ticket)
                view = pilot.view()
                write_json(directory / "view.json", view)
                result = view["attempts"][-1]
                receipt = {"checkpoint": checkpoint["id"], "status": "interrupted" if interrupted else result["outcome"], "error": result["error"],
                           "elapsed_seconds": time.monotonic()-started,
                           "artifacts": {path.name: sha(path) for path in sorted(directory.glob('*.json'))}}
                write_json(directory / "attempt.json", receipt)
                receipts.append(receipt)
                checkpoint_inventory(args.out, receipts)
            print(checkpoint["id"], receipt["status"], flush=True)
        write_json(args.out / "history.json", pilot.history())
        write_json(args.out / "final-view.json", pilot.view())
    finally:
        store.close()


def matches(node, condition):
    for key in ("kind", "intent", "state", "priority"):
        if condition[key] is not None and node[key] != condition[key]:
            return False
    return (not condition["sources_any"] or bool(set(node["sources"]) & set(condition["sources_any"]))) and (not condition["words_any"] or any(word.casefold() in node["text"].casefold() for word in condition["words_any"]))


def score_result(args):
    session, events, oracle = load_session(args.session, args.oracle)
    manifest = read_json(args.out / "manifest.json")
    if manifest["session_sha256"] != sha(args.session) or manifest["oracle_sha256"] != sha(args.oracle):
        raise Rejected("session/oracle binding changed")
    source = read_json(args.out / "source-identity.json")
    if manifest["source_identity_sha256"] != sha(args.out / "source-identity.json") or source["commit"] != manifest["source_commit"] or manifest["prompt_sha256"] != hashlib.sha256(SYSTEM.encode()).hexdigest():
        raise Rejected("source/prompt identity mismatch")
    for name in (*SOURCE_NAMES, "fixtures/session-001.json", "fixtures/session-001-oracle.json"):
        if source["files"].get(name) != sha(HERE / name):
            raise Rejected("instrument source mismatch")
    receipts = read_json(args.out / "attempts.json")
    if type(receipts) is not list or [item["checkpoint"] for item in receipts] != [item["id"] for item in session["checkpoints"][:len(receipts)]]:
        raise Rejected("attempt inventory order")
    rows = []
    selected = {}
    previous = {"nodes": [], "relations": []}
    for index, checkpoint in enumerate(session["checkpoints"]):
        key = checkpoint["id"]
        receipt = next((item for item in receipts if item["checkpoint"] == key), None)
        if receipt is None:
            rows.append({"checkpoint": key, "status": "unattempted"})
            continue
        directory = args.out / key
        if receipt != read_json(directory / "attempt.json"):
            raise Rejected("checkpoint receipt mismatch")
        for name, expected in receipt["artifacts"].items():
            if Path(name).name != name or sha(directory / name) != expected:
                raise Rejected("checkpoint artifact mismatch")
        snapshot = read_json(directory / "snapshot.json")
        if snapshot["session"] != session["session"] or snapshot["checkpoint"] != key or snapshot["previous_graph"] != previous or snapshot["events"] != [asdict(item) for item in events[:2*index+2]]:
            raise Rejected("not one evolving graph/source prefix")
        if receipt["status"] != "published":
            rows.append({"checkpoint": key, "status": receipt["status"], "error": receipt["error"]})
            continue
        request = read_json(directory / "request.json")
        response = fields(read_json(directory / "response.json"), {"text", "usage", "provider", "model", "thinking"})
        if request != {"system": SYSTEM, "input": snapshot} or any(response[key] != manifest["model"][key] for key in ("provider", "model", "thinking")):
            raise Rejected("participant request/model binding")
        prefix = events[:2*index+2]
        prior = parse_graph(previous, prefix, Graph((), ()))
        graph = parse_graph(decode(response["text"].encode(), 32768), prefix, prior).wire()
        view = read_json(directory / "view.json")
        if view["graph"] != graph or view["last_valid_through"] != len(prefix) or view["inflight_marker"] or view["events"] != snapshot["events"]:
            raise Rejected("published graph differs from original model return")
        answer = oracle[key]
        chosen = {item["key"]: [node["id"] for node in graph["nodes"] if matches(node,item["selector"])] for item in answer["requirements"]}
        checks = []
        for requirement in answer["requirements"]:
            found = chosen[requirement["key"]]
            checks.append({"kind": "classification/cardinality", "key": requirement["key"], "pass": requirement["min"] <= len(found) <= requirement["max"], "nodes": found})
        for relation in answer["relations"]:
            found = [edge["id"] for edge in graph["relations"] if edge["state"] == "active" and edge["kind"] == relation["kind"] and edge["source"] in chosen[relation["from"]] and edge["target"] in chosen[relation["to"]]]
            checks.append({"kind": "relation", "key": relation, "pass": len(found) >= relation["min"], "relations": found})
        for rule in answer["identity"]:
            old = selected.get(rule["same_as"]["checkpoint"], {}).get(rule["same_as"]["selector"], [])
            current = chosen[rule["selector"]]
            checks.append({"kind": "identity", "key": rule, "pass": len(current) == len(old) == 1 and current == old, "current": current, "prior": old})
        for condition in answer["forbidden"]:
            found = [node["id"] for node in graph["nodes"] if matches(node,condition)]
            checks.append({"kind": "forbidden", "key": condition, "pass": not found, "nodes": found})
        selected[key] = chosen
        rows.append({"checkpoint": key, "status": "published", "checks": checks, "nodes": len(graph["nodes"]), "relations": len(graph["relations"]), "same_graph_input_confirmed": True})
        previous = graph
    checks = [item for row in rows if row["status"] == "published" for item in row["checks"]]
    result = {"manifest_sha256": sha(args.out / "manifest.json"), "attempts_sha256": sha(args.out / "attempts.json"),
              "planned": 12, "attempted": len(receipts), "published": sum(row["status"] == "published" for row in rows),
              "evaluated_checks": len(checks), "passed_checks": sum(item["pass"] for item in checks), "rows": rows,
              "scope": "Predeclared classifications/relations/identity controls, not semantic entailment or Human benefit. All original checkpoints/failures retained; no hidden oracle fields sent to model."}
    return result


def score(args):
    result = score_result(args)
    write_json(args.out / "score.json", result)
    print(canonical(result).decode())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest="command", required=True)
    for name in ("validate", "evaluate", "score"):
        sub = subs.add_parser(name)
        sub.add_argument("--session", required=True, type=Path)
        sub.add_argument("--oracle", required=True, type=Path)
        if name != "validate": sub.add_argument("--out", required=True, type=Path)
        if name == "evaluate":
            for key in ("node", "sdk", "provider", "model", "thinking"):sub.add_argument("--"+key, required=True)
    args = parser.parse_args()
    if args.command == "validate":
        session, events, _ = load_session(args.session,args.oracle)
        print(canonical({"session":session["session"], "events":len(events),"checkpoints":len(session["checkpoints"])}).decode())
    elif args.command == "evaluate":asyncio.run(evaluate(args))
    else:score(args)

if __name__ == "__main__":main()
