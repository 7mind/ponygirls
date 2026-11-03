#!/usr/bin/env python3
"""Cooperative record integrity and projection; not authority or semantic validation."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from types import MappingProxyType
from typing import Mapping, TypeAlias, Union, cast

Json: TypeAlias = Union[None, bool, int, str, list["Json"], dict[str, "Json"]]
Object: TypeAlias = dict[str, Json]
VERSION = 1
MAX_INPUT_BYTES = 4 * 1024 * 1024
REF_PATTERN = re.compile(r"([A-Za-z][A-Za-z0-9_-]{0,63})@([1-9][0-9]*)")
ID_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}")
DIGEST_PATTERN = re.compile(r"[0-9a-f]{64}")
ASSURANCE = (
    "Cooperative declarations only: authors and approval interpretations are not "
    "authenticated; meaning, goal satisfaction and external artifact bytes are not verified."
)


class RecordError(ValueError):
    pass


class Category(str, Enum):
    SOURCES = "sources"
    INTERPRETATIONS = "interpretations"
    CLAIMS = "claims"
    DEPENDENCIES = "dependencies"
    EVIDENCE = "evidence"


@dataclass(frozen=True, order=True)
class Revision:
    family: str
    number: int

    def __str__(self) -> str:
        return f"{self.family}@{self.number}"


@dataclass(frozen=True)
class Clause:
    identifier: str
    text: str


@dataclass(frozen=True)
class Source:
    by: str
    kind: str
    text: str
    source_ref: str
    scope: tuple[Clause, ...]


@dataclass(frozen=True)
class Interpretation:
    by: str
    input: Revision
    kind: str
    proposal: Revision | None
    scope: tuple[str, ...]
    text: str


@dataclass(frozen=True)
class Claim:
    by: str
    kind: str
    text: str
    conditions: tuple[str, ...]
    basis: tuple[Revision, ...]
    dependencies: tuple[Revision, ...]
    evidence_route: str
    open: tuple[str, ...]


@dataclass(frozen=True)
class Dependency:
    by: str
    kind: str
    ref: str
    digest: str


@dataclass(frozen=True)
class Artifact:
    ref: str
    digest: str


@dataclass(frozen=True)
class Evidence:
    by: str
    subjects: tuple[Revision, ...]
    dependencies: tuple[Revision, ...]
    scope: tuple[str, ...]
    outcome: str
    text: str
    artifact: Artifact | None


Payload: TypeAlias = Source | Interpretation | Claim | Dependency | Evidence


@dataclass(frozen=True)
class Entry:
    revision: Revision
    category: Category
    body: bytes
    digest: str
    payload: Payload


@dataclass(frozen=True)
class Document:
    entries: tuple[Entry, ...]
    index: Mapping[Revision, Entry]
    active_claims: tuple[Revision, ...]
    active_dependencies: tuple[Revision, ...]

    def get(self, revision: Revision, category: Category) -> Entry:
        entry = self.index.get(revision)
        if entry is None or entry.category != category:
            raise RecordError(f"{revision}: missing {category.value} reference")
        return entry


def object_value(value: Json) -> Object:
    if not isinstance(value, dict):
        raise RecordError("expected an object")
    return value


def text(value: Json) -> str:
    if not isinstance(value, str):
        raise RecordError("expected a string")
    return value


def fields(value: Object, required: str) -> None:
    expected = frozenset(required.split())
    if set(value) != expected:
        raise RecordError(f"fields differ: missing={sorted(expected - set(value))}, unknown={sorted(set(value) - expected)}")


def choice(value: Json, allowed: str) -> str:
    result = text(value)
    if result not in allowed.split():
        raise RecordError(f"invalid choice {result!r}; expected {allowed}")
    return result


def identifier(value: Json) -> str:
    result = text(value)
    if ID_PATTERN.fullmatch(result) is None:
        raise RecordError("invalid identifier (1–64 ASCII letters/digits/_/-, starting with a letter)")
    return result


def revision(value: Json) -> Revision:
    match = REF_PATTERN.fullmatch(text(value))
    if match is None:
        raise RecordError("expected an exact ID@positive-revision reference")
    return Revision(match[1], int(match[2]))


def strings(value: Json) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise RecordError("expected a string array")
    return tuple(text(item) for item in value)


def references(value: Json) -> tuple[Revision, ...]:
    result = tuple(revision(item) for item in strings(value))
    if len(result) != len(set(result)):
        raise RecordError("duplicate references")
    return result


def digest(value: Json) -> str:
    result = text(value)
    if DIGEST_PATTERN.fullmatch(result) is None:
        raise RecordError("expected a lowercase SHA-256 hex digest")
    return result


def canonical(value: Object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def unique_object(pairs: list[tuple[str, Json]]) -> Object:
    result: Object = {}
    for key, value in pairs:
        if key in result:
            raise RecordError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def invalid_number(value: str) -> Json:
    raise RecordError(f"unsupported JSON number {value}")


def decode(raw: str) -> Object:
    value = cast(Json, json.loads(raw, object_pairs_hook=unique_object, parse_constant=invalid_number, parse_float=invalid_number))
    return object_value(value)


def payload(category: Category, value: Object) -> Payload:
    if category == Category.SOURCES:
        kind = choice(value.get("kind"), "input proposal")
        fields(value, "by kind text source_ref scope" if kind == "proposal" else "by kind text source_ref")
        scope = object_value(value["scope"]) if kind == "proposal" else {}
        return Source(text(value["by"]), kind, text(value["text"]), text(value["source_ref"]), tuple(Clause(identifier(key), text(item)) for key, item in sorted(scope.items())))
    if category == Category.INTERPRETATIONS:
        fields(value, "by input kind proposal scope text")
        proposal = None if value["proposal"] is None else revision(value["proposal"])
        scope = tuple(identifier(item) for item in strings(value["scope"]))
        if len(scope) != len(set(scope)):
            raise RecordError("duplicate interpretation scope")
        return Interpretation(text(value["by"]), revision(value["input"]), choice(value["kind"], "instruction scoped_approval unresolved"), proposal, scope, text(value["text"]))
    if category == Category.CLAIMS:
        fields(value, "by kind text conditions basis dependencies evidence_route open")
        return Claim(text(value["by"]), choice(value["kind"], "goal assumption"), text(value["text"]), strings(value["conditions"]), references(value["basis"]), references(value["dependencies"]), text(value["evidence_route"]), strings(value["open"]))
    if category == Category.DEPENDENCIES:
        fields(value, "by kind ref digest")
        return Dependency(text(value["by"]), choice(value["kind"], "artifact check environment oracle"), text(value["ref"]), digest(value["digest"]))
    fields(value, "by subjects dependencies scope outcome text artifact")
    artifact = None
    if value["artifact"] is not None:
        raw_artifact = object_value(value["artifact"])
        fields(raw_artifact, "ref digest")
        artifact = Artifact(text(raw_artifact["ref"]), digest(raw_artifact["digest"]))
    outcome = choice(value["outcome"], "pass fail error skipped unavailable unchecked")
    if outcome in ("pass", "fail", "error") and artifact is None:
        raise RecordError("reported pass/fail/error requires a declared report artifact")
    subjects = references(value["subjects"])
    if not subjects:
        raise RecordError("evidence requires at least one subject")
    return Evidence(text(value["by"]), subjects, references(value["dependencies"]), strings(value["scope"]), outcome, text(value["text"]), artifact)


def load(raw: str, prepare: bool) -> Document:
    root = decode(raw)
    fields(root, "version sources interpretations claims dependencies evidence active")
    if type(root["version"]) is not int or root["version"] != VERSION:
        raise RecordError("unsupported format version; expected integer 1")
    entries: list[Entry] = []
    index: dict[Revision, Entry] = {}
    families: dict[str, Category] = {}
    for category in Category:
        for key, item in object_value(root[category.value]).items():
            ref = revision(key)
            if ref in index or (ref.family in families and families[ref.family] != category):
                raise RecordError(f"{ref}: duplicate reference or changed record category")
            value = object_value(item)
            body = {name: member for name, member in value.items() if name != "_sha256"}
            try:
                parsed = payload(category, body)
                body_bytes = canonical(body)
                actual_digest = hashlib.sha256(body_bytes).hexdigest()
                if "_sha256" in value:
                    if digest(value["_sha256"]) != actual_digest:
                        raise RecordError("fingerprint mismatch (snapshot will not repair it)")
                elif not prepare:
                    raise RecordError("missing _sha256; prepare with snapshot")
            except (RecordError, UnicodeError) as error:
                raise RecordError(f"{ref}: {error}") from error
            entry = Entry(ref, category, body_bytes, actual_digest, parsed)
            entries.append(entry)
            index[ref] = entry
            families[ref.family] = category
    active = object_value(root["active"])
    fields(active, "claims dependencies")

    def selection(category: Category) -> tuple[Revision, ...]:
        selected: list[Revision] = []
        for key, value in sorted(object_value(active[category.value]).items()):
            ref = revision(value)
            if identifier(key) != ref.family:
                raise RecordError("active selection key must match reference family")
            selected.append(ref)
        return tuple(selected)

    document = Document(tuple(sorted(entries, key=lambda item: (item.category.value, item.revision))), MappingProxyType(index), selection(Category.CLAIMS), selection(Category.DEPENDENCIES))
    validate_links(document)
    return document


def validate_links(document: Document) -> None:
    for ref in document.active_claims:
        document.get(ref, Category.CLAIMS)
    for ref in document.active_dependencies:
        document.get(ref, Category.DEPENDENCIES)
    for entry in document.entries:
        item = entry.payload
        if isinstance(item, Interpretation):
            source = document.get(item.input, Category.SOURCES).payload
            if not isinstance(source, Source) or source.kind != "input":
                raise RecordError(f"{entry.revision}: interpretation input is not raw input")
            if item.proposal is None:
                if item.scope or item.kind == "scoped_approval":
                    raise RecordError("claimed scoped approval requires a proposal and nonempty scope")
            else:
                proposal = document.get(item.proposal, Category.SOURCES).payload
                if not isinstance(proposal, Source) or proposal.kind != "proposal":
                    raise RecordError("interpretation antecedent is not a proposal")
                if not set(item.scope) <= {clause.identifier for clause in proposal.scope}:
                    raise RecordError("interpretation scope is outside the declared proposal scope")
                if item.kind == "scoped_approval" and not item.scope:
                    raise RecordError("claimed scoped approval requires nonempty scope")
        elif isinstance(item, Claim):
            for ref in item.basis:
                document.get(ref, Category.INTERPRETATIONS)
            for ref in item.dependencies:
                document.get(ref, Category.DEPENDENCIES)
        elif isinstance(item, Evidence):
            required: set[Revision] = set()
            for ref in item.subjects:
                subject = document.get(ref, Category.CLAIMS).payload
                if not isinstance(subject, Claim):
                    raise RecordError("invalid evidence subject")
                required.update(subject.dependencies)
            for ref in item.dependencies:
                document.get(ref, Category.DEPENDENCIES)
            if not required <= set(item.dependencies):
                raise RecordError("evidence omits dependencies declared by its subjects")


def encoded(document: Document) -> str:
    result: Object = {"version": VERSION}
    for category in Category:
        collection: Object = {}
        for entry in document.entries:
            if entry.category == category:
                body = decode(entry.body.decode("utf-8"))
                body["_sha256"] = entry.digest
                collection[str(entry.revision)] = body
        result[category.value] = collection
    result["active"] = {
        "claims": {ref.family: str(ref) for ref in document.active_claims},
        "dependencies": {ref.family: str(ref) for ref in document.active_dependencies},
    }
    return json.dumps(result, ensure_ascii=True, sort_keys=True, indent=2) + "\n"


def applicability(document: Document) -> list[Object]:
    findings: list[Object] = []
    for entry in document.entries:
        item = entry.payload
        if isinstance(item, Evidence):
            reasons = [f"subject {ref} not selected" for ref in item.subjects if ref not in document.active_claims]
            reasons.extend(f"dependency {ref} not selected" for ref in item.dependencies if ref not in document.active_dependencies)
            artifact: Json = None if item.artifact is None else {"ref": item.artifact.ref, "digest": item.artifact.digest}
            findings.append({"evidence": str(entry.revision), "declared_author": item.by, "recorded_outcome": item.outcome, "declared_scope": list(item.scope), "subjects": [str(ref) for ref in item.subjects], "dependencies": [str(ref) for ref in item.dependencies], "declared_artifact": artifact, "reported_text": item.text, "current_selection_match": not reasons, "reasons": cast(list[Json], reasons)})
    return findings


def check_result(document: Document) -> Object:
    return {"consistent": True, "scope": "record-integrity-only", "assurance": ASSURANCE, "evidence_applicability": cast(list[Json], applicability(document))}


def literal(value: str) -> str:
    visible = "".join(
        character if character in "\n\t" or unicodedata.category(character) not in ("Cc", "Cf", "Cs")
        else (f"\\u{ord(character):04x}" if ord(character) <= 0xFFFF else f"\\U{ord(character):08x}")
        for character in value
    )
    longest = max((len(run) for run in re.findall(r"`+", visible)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}text\n{visible}\n{fence}\n"


def render(document: Document) -> str:
    out = ["# Cooperative current record view\n", ASSURANCE + "\n"]
    for ref in document.active_claims:
        item = document.get(ref, Category.CLAIMS).payload
        if not isinstance(item, Claim):
            raise RecordError("invalid active claim")
        out.extend([f"## `{ref}` — {item.kind}\n", literal(item.text), "### Declared author\n", literal(item.by)])
        for heading, values in (("Conditions", item.conditions), ("Open matters", item.open)):
            out.append(f"### {heading}\n")
            out.extend(literal(value) for value in values)
            if not values:
                out.append("None declared; not a completeness claim.\n")
        out.extend(["### Planned evidence route\n", literal(item.evidence_route), "### Attributed basis references\n", ", ".join(f"`{basis}`" for basis in item.basis) or "None declared.", "\n### Dependency references\n", ", ".join(f"`{dependency}`" for dependency in item.dependencies) or "None declared."])
    if not document.active_claims:
        out.append("No active claims selected; no readiness judgment follows.\n")
    displayed_dependencies = set(document.active_dependencies)
    for ref in document.active_claims:
        claim = document.get(ref, Category.CLAIMS).payload
        if not isinstance(claim, Claim):
            raise RecordError("invalid active claim")
        displayed_dependencies.update(claim.dependencies)
    for entry in document.entries:
        if isinstance(entry.payload, Evidence):
            displayed_dependencies.update(entry.payload.dependencies)
    out.append("\n## Dependency declarations (bytes not verified)\n")
    for ref in sorted(displayed_dependencies):
        entry = document.get(ref, Category.DEPENDENCIES)
        state = "selected" if ref in document.active_dependencies else "not selected; referenced"
        out.extend([f"### `{ref}` — {state}\n", literal(json.dumps(decode(entry.body.decode("utf-8")), ensure_ascii=True, sort_keys=True, indent=2))])
    out.append("\n## Attributed interpretations (not authenticated approvals)\n")
    for entry in document.entries:
        item = entry.payload
        if isinstance(item, Interpretation):
            out.extend([f"### `{entry.revision}` — {item.kind}\n", literal(item.by), literal(item.text), f"Raw input: `{item.input}`; proposal: `{item.proposal}`; declared scope: {', '.join(item.scope) or '(none)'}\n"])
            source = document.get(item.input, Category.SOURCES).payload
            if not isinstance(source, Source):
                raise RecordError("invalid input source")
            out.extend(["Declared input author (not authenticated):\n", literal(source.by), "Declared input locator (not opened):\n", literal(source.source_ref)])
            if item.proposal is not None:
                proposal = document.get(item.proposal, Category.SOURCES).payload
                if not isinstance(proposal, Source):
                    raise RecordError("invalid proposal source")
                out.extend(["Declared proposal author (not authenticated):\n", literal(proposal.by), "Declared proposal locator (not opened):\n", literal(proposal.source_ref)])
                for clause in proposal.scope:
                    if clause.identifier in item.scope:
                        out.extend([f"Declared clause `{clause.identifier}`:\n", literal(clause.text)])
    out.append("\n## Recorded evidence (results and artifact digests not verified)\n")
    findings = applicability(document)
    for finding in findings:
        out.append(literal(json.dumps(finding, ensure_ascii=False, sort_keys=True)))
    if not findings:
        out.append("No recorded evidence. Outcomes remain unchecked by this tool.\n")
    return "\n".join(out) + "\n"


def compare(previous: Document, current: Document) -> Object:
    for entry in previous.entries:
        other = current.index.get(entry.revision)
        if other is None or other.category != entry.category or other.body != entry.body:
            raise RecordError(f"{entry.revision}: immutable history deleted or changed")
    added: list[Json] = [{"collection": entry.category.value, "ref": str(entry.revision)} for entry in current.entries if entry.revision not in previous.index]
    changes: list[Json] = []
    for category, before, after in ((Category.CLAIMS, previous.active_claims, current.active_claims), (Category.DEPENDENCIES, previous.active_dependencies, current.active_dependencies)):
        old = {ref.family: ref for ref in before}
        new = {ref.family: ref for ref in after}
        for family in sorted(set(old) | set(new)):
            if old.get(family) != new.get(family):
                old_ref = old.get(family)
                new_ref = new.get(family)
                changes.append({"collection": category.value, "id": family, "before": None if old_ref is None else str(old_ref), "after": None if new_ref is None else str(new_ref)})
    return {"consistent": True, "scope": "record-integrity-only", "assurance": ASSURANCE, "additions": added, "selection_changes": changes, "evidence_applicability": cast(list[Json], applicability(current))}


def read_input(path: str) -> str:
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise RecordError(f"input exceeds explicit {MAX_INPUT_BYTES}-byte limit; not truncated")
    return data.decode("utf-8")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for command in ("snapshot", "check", "render"):
        commands.add_parser(command).add_argument("input")
    diff = commands.add_parser("diff")
    diff.add_argument("previous")
    diff.add_argument("input")
    args = parser.parse_args(argv)
    try:
        document = load(read_input(args.input), args.command == "snapshot")
        if args.command == "snapshot":
            result = encoded(document)
        elif args.command == "render":
            result = render(document)
        else:
            report = compare(load(read_input(args.previous), False), document) if args.command == "diff" else check_result(document)
            result = json.dumps(report, ensure_ascii=True, sort_keys=True, indent=2) + "\n"
    except (RecordError, json.JSONDecodeError, UnicodeError, RecursionError, ValueError) as error:
        print(json.dumps({"consistent": False, "scope": "record-integrity-only", "error": str(error)}), file=sys.stderr)
        return 1
    except OSError as error:
        print(json.dumps({"consistent": False, "scope": "invocation-or-io", "error": str(error)}), file=sys.stderr)
        return 2
    sys.stdout.write(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
