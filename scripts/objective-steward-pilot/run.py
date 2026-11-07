#!/usr/bin/env python3
"""Explicit synthetic-only pilot, source freeze, single-pass evaluation and views."""
import argparse
import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import time

HERE = Path(__file__).resolve().parent
SOURCE_NAMES = ("profile.py", "store.py", "pilot.py", "run.py", "live.mjs")
LOAD_SOURCE_BINDINGS = tuple((name, hashlib.sha256((HERE / name).read_bytes()).hexdigest()) for name in SOURCE_NAMES)

from pilot import Controller, Pilot, render
from profile import SYSTEM, Rejected, canonical, decode, fields, parse_input
from store import SqliteStore
HARD_DEADLINE_SECONDS = 205
MAX_BRIDGE_BYTES = 256 * 1024


def read_json(path: Path):
    return decode(path.read_bytes(), 1024 * 1024)


def write_json(path: Path, value: object):
    with path.open("xb") as stream:
        stream.write(canonical(value) + b"\n")


def sha(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def corpus(cases_path: Path, oracle_path: Path):
    source = fields(read_json(cases_path), {"version", "cases"})
    oracle = fields(read_json(oracle_path), {"version", "cases"})
    if source["version"] != "steward-corpus-v1" or oracle["version"] != "steward-oracle-v1":
        raise Rejected("unsupported corpus")
    cases, answers = source["cases"], oracle["cases"]
    if type(cases) is not list or type(answers) is not list:
        raise Rejected("invalid corpus rows")
    if len(cases) != 16 or len(answers) != len(cases):
        raise Rejected("unexpected corpus inventory")
    case_ids = set()
    for case in cases:
        fields(case, {"id", "split", "input"})
        if case["id"] in case_ids or case["id"] not in {f"P{i:02}" for i in range(1, 17)}:
            raise Rejected("invalid case identity")
        case_ids.add(case["id"])
        if case["split"] not in ("development", "heldout"):
            raise Rejected("invalid split")
        parse_input(case["input"])
    answer_ids = set()
    for answer in answers:
        fields(answer, {"id", "split", "verdicts", "required_citations", "primary_source", "rationale"})
        if answer["id"] in answer_ids or answer["id"] not in case_ids:
            raise Rejected("invalid oracle identity")
        answer_ids.add(answer["id"])
        case = next(item for item in cases if item["id"] == answer["id"])
        snapshot = parse_input(case["input"])
        sources = {item.id for item in snapshot.sources}
        claims = {item.id for item in snapshot.claims}
        if answer["split"] != case["split"] or set(answer["verdicts"]) != claims or set(answer["required_citations"]) != claims:
            raise Rejected("oracle mismatch")
        if answer["primary_source"] not in {item.id for item in snapshot.sources if item.role == "human"}:
            raise Rejected("invalid primary source")
        for target in claims:
            allowed = answer["verdicts"][target]
            if not allowed or not set(allowed) <= {"supported", "challenged", "inconclusive"} or not set(answer["required_citations"][target]) <= sources:
                raise Rejected("invalid oracle values")
    if [case["split"] for case in cases].count("heldout") != 8:
        raise Rejected("unexpected heldout count")
    return cases, {item["id"]: item for item in answers}


@dataclass(frozen=True)
class ModelConfig:
    node: str
    sdk: str
    provider: str
    model: str
    thinking: str


class LiveWorker:
    def __init__(self, config: ModelConfig, directory: Path):
        self.config = config
        self.directory = directory
        self.started = False

    async def review(self, snapshot):
        if self.started:
            raise Rejected("pilot participant cannot be rerun")
        self.started = True
        payload = canonical({"system": SYSTEM, "input": snapshot.wire()})
        write_json(self.directory / "request.json", {"system": SYSTEM, "input": snapshot.wire()})
        config = self.config
        process = await asyncio.create_subprocess_exec(config.node, str(HERE / "live.mjs"), "--sdk", config.sdk,
                    "--provider", config.provider, "--model", config.model, "--thinking", config.thinking,
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                    start_new_session=True)
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(payload), HARD_DEADLINE_SECONDS)
        except BaseException:
            if process.returncode is None:
                os.killpg(process.pid, signal.SIGKILL)
            await process.wait()
            write_json(self.directory / "bridge-failure.json", {"category": "hard-deadline-or-cancel", "exit": process.returncode})
            raise
        if len(stdout) > MAX_BRIDGE_BYTES or len(stderr) > MAX_BRIDGE_BYTES:
            raise Rejected("bridge byte bound")
        if process.returncode != 0:
            category = stderr.decode("utf-8", errors="replace").strip()
            known = {"arguments", "input-limit", "input-json", "input-shape", "sdk-pin", "model-unavailable", "not-authenticated", "deadline", "stream-limit", "output-limit", "tool-call", "runtime-error", "provider-error", "incomplete-response", "stream-protocol", "model-change"}
            write_json(self.directory / "bridge-failure.json", {"category": category if category in known else "bridge-error", "exit": process.returncode})
            raise Rejected(category if category in known else "bridge-error")
        result = fields(decode(stdout, MAX_BRIDGE_BYTES), {"text", "usage", "provider", "model", "thinking"})
        if (result["provider"], result["model"], result["thinking"]) != (config.provider, config.model, config.thinking) or type(result["text"]) is not str:
            raise Rejected("unexpected bridge selection")
        write_json(self.directory / "response.json", result)
        return result["text"].encode("utf-8")


def frozen_sources(cases_path: Path, oracle_path: Path):
    actual = {name: sha(HERE / name) for name in SOURCE_NAMES}
    if actual != dict(LOAD_SOURCE_BINDINGS):
        raise Rejected("source changed after module load")
    result = {"source/" + name: actual[name] for name in SOURCE_NAMES}
    result["corpus"] = sha(cases_path)
    result["oracle"] = sha(oracle_path)
    return result


def execution_identity():
    identity = HERE / "source-identity.json"
    if Path("/nix/store") not in HERE.parents or not identity.is_file():
        raise Rejected("evaluation requires immutable Nix source export")
    value = read_json(identity)
    for name, expected in value["files"].items():
        if sha(HERE / name) != expected:
            raise Rejected("frozen source mismatch")
    return value["commit"]


async def evaluate(args):
    head = execution_identity()
    if args.cases.resolve() != HERE / "fixtures/cases.json" or args.oracle.resolve() != HERE / "fixtures/oracle.json":
        raise Rejected("evaluation corpus must be in frozen export")
    cases, _ = corpus(args.cases, args.oracle)
    args.out.mkdir(parents=True, exist_ok=False)
    config = ModelConfig(args.node, args.sdk, args.provider, args.model, args.thinking)
    manifest = {"version": "steward-pilot-v1", "started": datetime.now(timezone.utc).isoformat(),
                "head": head,
                "source_sha256": frozen_sources(args.cases, args.oracle), "prompt_sha256": hashlib.sha256(SYSTEM.encode()).hexdigest(),
                "model": vars(config), "case_order": [item["id"] for item in cases],
                "planned_cases": len(cases), "no_private_histories": True,
                "limits": {"hard_deadline_seconds": HARD_DEADLINE_SECONDS, "bridge_stdout_bytes": MAX_BRIDGE_BYTES},
                "scope": "one isolated tool-less Agent per synthetic case; no native extension/UI/SDK enqueue or Human-benefit acceptance"}
    write_json(args.out / "manifest.json", manifest)
    attempts = []
    checkpoint_inventory(args.out, attempts)
    for case in cases:
        directory = args.out / case["id"]
        directory.mkdir()
        write_json(directory / "input.json", case["input"])
        store = SqliteStore(directory / "state.sqlite", "write")
        pilot = Pilot(store)
        pilot.initialize(parse_input(case["input"]))
        controller = Controller(pilot, LiveWorker(config, directory))
        write_json(directory / "admission.json", {"case": case["id"], "split": case["split"], "input_sha256": sha(directory / "input.json"), "meaning": "case review admission, not proof of provider submission"})
        start = time.monotonic()
        interrupted = False
        try:
            controller.request()
            await controller.wait_idle()
        except BaseException:
            interrupted = True
            raise
        finally:
            try:
                await controller.close()
            except asyncio.CancelledError:
                interrupted = True
            try:
                view = pilot.view()
                write_json(directory / "view.json", view)
                with (directory / "objectives.txt").open("x", encoding="utf-8") as stream:
                    stream.write(render(view))
                receipt = {"case": case["id"], "split": case["split"], "published": view["review"] is not None,
                           "status": "interrupted" if interrupted else "published" if view["review"] is not None else "failed",
                           "error": "interrupted" if interrupted else view["error"], "elapsed_seconds": time.monotonic() - start,
                           "artifacts": {path.name: sha(path) for path in sorted(directory.iterdir()) if path.is_file() and path.suffix in (".json", ".txt")}}
                write_json(directory / "attempt.json", receipt)
                attempts.append(receipt)
                checkpoint_inventory(args.out, attempts)
            finally:
                store.close()
        print(case["id"], "published" if receipt["published"] else "failed: " + str(receipt["error"]), flush=True)
        if receipt["error"] in ("not-authenticated", "model-unavailable", "sdk-pin"):
            break
    if frozen_sources(args.cases, args.oracle) != manifest["source_sha256"]:
        raise Rejected("source changed during participant run")


def checkpoint_inventory(directory: Path, attempts: list):
    temporary = directory / "attempts.next"
    write_json(temporary, attempts)
    temporary.replace(directory / "attempts.json")


def admitted_attempts(directory: Path, cases: list):
    attempts = []
    for case in cases:
        target = directory / case["id"]
        admission_path = target / "admission.json"
        if not admission_path.exists():
            if (target / "attempt.json").exists() or (target / "request.json").exists():
                raise Rejected("orphan attempt without admission")
            continue
        admission = read_json(admission_path)
        if admission["case"] != case["id"] or admission["split"] != case["split"] or admission["input_sha256"] != sha(target / "input.json") or read_json(target / "input.json") != case["input"]:
            raise Rejected("admission binding mismatch")
        terminal = target / "attempt.json"
        receipt = read_json(terminal) if terminal.exists() else {"case": case["id"], "split": case["split"], "status": "incomplete", "published": False, "error": "no terminal receipt; process/submission outcome unknown"}
        if receipt["case"] != case["id"] or receipt["split"] != case["split"]:
            raise Rejected("terminal receipt identity mismatch")
        attempts.append(receipt)
    projection = directory / "attempts.json"
    if projection.exists():
        for item in read_json(projection):
            if item not in attempts:
                raise Rejected("attempt inventory mismatch")
    return attempts


def score(args):
    cases, oracle = corpus(args.cases, args.oracle)
    manifest = read_json(args.out / "manifest.json")
    if frozen_sources(args.cases, args.oracle) != manifest["source_sha256"]:
        raise Rejected("scoring inputs differ from frozen source")
    attempts = admitted_attempts(args.out, cases)
    rows = []
    for case in cases:
        case_id = case["id"]
        directory = args.out / case_id
        receipt = next((item for item in attempts if item["case"] == case_id), None)
        if receipt is None:
            rows.append({"case": case_id, "split": case["split"], "status": "unattempted"})
            continue
        if receipt["status"] == "incomplete":
            rows.append({"case": case_id, "split": case["split"], "status": "incomplete", "error": receipt["error"]})
            continue
        for name, expected in receipt["artifacts"].items():
            if sha(directory / name) != expected:
                raise Rejected("artifact binding mismatch")
        view = read_json(directory / "view.json")
        if view["input"] != case["input"] or view["human_acceptance"] != "not-recorded":
            raise Rejected("primary records changed")
        if receipt["status"] != "published":
            rows.append({"case": case_id, "split": case["split"], "status": receipt["status"], "error": receipt["error"]})
            continue
        review = view["review"]
        expected = oracle[case_id]
        checks = []
        for assessment in review["assessments"]:
            target = assessment["claim"]["id"]
            checks.append({"claim": target, "verdict": assessment["verdict"],
                           "verdict_match": assessment["verdict"] in expected["verdicts"][target],
                           "required_citations_present": set(expected["required_citations"][target]) <= set(assessment["sources"])})
        primary = next(item for item in review["objectives"] if item["key"] == "primary")
        rows.append({"case": case_id, "split": case["split"], "status": "published", "checks": checks,
                     "primary_source_linked": expected["primary_source"] in primary["sources"],
                     "scope": "fixed verdict/citation/source-link controls, not entailment or Human-benefit proof"})
    result = {"version": "steward-score-v1", "manifest_sha256": sha(args.out / "manifest.json"), "attempts_sha256": sha(args.out / "attempts.json") if (args.out / "attempts.json").exists() else None,
              "attempt_definition": "case admissions, not wire requests; incomplete is not proof a process stopped",
              "rows": rows, "planned": len(cases), "attempted": len(attempts),
              "published": sum(row["status"] == "published" for row in rows),
              "verdict_checks": sum(len(row.get("checks", [])) for row in rows),
              "verdict_matches": sum(check["verdict_match"] for row in rows for check in row.get("checks", [])),
              "citation_matches": sum(check["required_citations_present"] for row in rows for check in row.get("checks", [])),
              "primary_source_links": sum(row.get("primary_source_linked", False) for row in rows)}
    write_json(args.out / "score.json", result)
    print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("validate-corpus", "evaluate", "score"):
        command = commands.add_parser(name)
        command.add_argument("--cases", type=Path, required=True)
        command.add_argument("--oracle", type=Path, required=True)
        if name != "validate-corpus": command.add_argument("--out", type=Path, required=True)
        if name == "evaluate":
            for flag in ("node", "sdk", "provider", "model", "thinking"):
                command.add_argument("--" + flag, required=True)
    command = commands.add_parser("view")
    command.add_argument("--database", type=Path, required=True)
    command.add_argument("--details", action="store_true")
    command.add_argument("--history", action="store_true")
    args = parser.parse_args()
    if args.command == "validate-corpus":
        cases, _ = corpus(args.cases, args.oracle)
        print(json.dumps({"cases": len(cases), "heldout": sum(case["split"] == "heldout" for case in cases), "claims": sum(len(case["input"]["claims"]) for case in cases)}))
    elif args.command == "evaluate": asyncio.run(evaluate(args))
    elif args.command == "score": score(args)
    else:
        if not args.database.is_file():
            raise Rejected("database does not exist")
        store = SqliteStore(args.database, "read")
        try:
            pilot = Pilot(store)
            print(json.dumps(pilot.history(), indent=2, ensure_ascii=False) if args.history else json.dumps(pilot.view(), indent=2, ensure_ascii=False) if args.details else render(pilot.view()), end="\n")
        finally: store.close()

if __name__ == "__main__":
    main()
