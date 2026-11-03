"""Specified-origin public CLI contracts; not semantic or human-attention evidence."""
from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import TypeAlias, Union, cast

Json: TypeAlias = Union[None, bool, int, str, list["Json"], dict[str, "Json"]]
Object: TypeAlias = dict[str, Json]
ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "joint-belief-framing/scripts/bookkeeping.py"
EXAMPLE = ROOT / "joint-belief-framing/examples/minimal.json"
TIMEOUT_SECONDS = 10


def obj(value: Json) -> Object:
    assert isinstance(value, dict)
    return value


def fixture() -> Object:
    return cast(Object, json.loads(EXAMPLE.read_text()))


def item(document: Object, collection: str, ref: str) -> Object:
    return obj(obj(document[collection])[ref])


def with_evidence() -> Object:
    document = fixture()
    obj(document["dependencies"])["D@1"] = {"by": "agent", "kind": "environment", "ref": "fixture-environment-A", "digest": "0" * 64}
    obj(obj(document["active"])["dependencies"])["D"] = "D@1"
    item(document, "claims", "G@1")["dependencies"] = ["D@1"]
    obj(document["evidence"])["E@1"] = {"by": "agent", "subjects": ["G@1"], "dependencies": ["D@1"], "scope": ["nominal-only"], "outcome": "pass", "text": "One reported synthetic check.", "artifact": {"ref": "opaque:report-not-opened", "digest": "1" * 64}}
    return document


class BookkeepingCLI(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.sequence = 0

    def file(self, value: str) -> Path:
        self.sequence += 1
        path = self.directory / f"input-{self.sequence}.json"
        path.write_text(value, encoding="utf-8")
        return path

    def call(self, command: str, *values: str) -> subprocess.CompletedProcess[str]:
        paths = [str(self.file(value)) for value in values]
        return subprocess.run([sys.executable, str(SCRIPT), command, *paths], capture_output=True, text=True, timeout=TIMEOUT_SECONDS, check=False)

    def seal(self, document: Object) -> Object:
        result = self.call("snapshot", json.dumps(document))
        self.assertEqual(result.returncode, 0, result.stderr)
        return cast(Object, json.loads(result.stdout))

    def invoke(self, command: str, document: Object) -> subprocess.CompletedProcess[str]:
        return self.call(command, json.dumps(document))

    def invalid(self, document: Object, marker: str) -> None:
        result = self.invoke("snapshot", document)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn(marker, result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_example_seals_and_checks_with_limited_assurance(self) -> None:
        document = self.seal(fixture())
        result = self.invoke("check", document)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report["consistent"])
        self.assertEqual(report["scope"], "record-integrity-only")
        self.assertIn("not authenticated", report["assurance"])
        self.assertNotIn("supported", report)
        self.assertNotIn("ratified", report)

    def test_snapshot_is_idempotent_and_does_not_modify_input(self) -> None:
        raw = json.dumps(fixture())
        path = self.file(raw)
        result = subprocess.run([sys.executable, str(SCRIPT), "snapshot", str(path)], capture_output=True, text=True, timeout=TIMEOUT_SECONDS, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        again = self.call("snapshot", result.stdout)
        self.assertEqual(again.stdout, result.stdout)
        self.assertEqual(path.read_text(), raw)

    def test_string_whitespace_changes_fingerprint(self) -> None:
        before = self.seal(fixture())
        changed = fixture()
        item(changed, "sources", "U@1")["text"] = "yes  \n not collapsed"
        after = self.seal(changed)
        self.assertNotEqual(item(before, "sources", "U@1")["_sha256"], item(after, "sources", "U@1")["_sha256"])
        self.assertEqual(item(after, "sources", "U@1")["text"], "yes  \n not collapsed")

    def test_unsolicited_input_and_unresolved_interpretation_need_no_proposal(self) -> None:
        document = fixture()
        item(document, "interpretations", "I@1").update({"kind": "unresolved", "proposal": None, "scope": []})
        self.seal(document)

    def test_approval_requires_antecedent(self) -> None:
        document = fixture()
        item(document, "interpretations", "I@1")["proposal"] = None
        self.invalid(document, "requires a proposal")

    def test_approval_cannot_claim_undeclared_scope(self) -> None:
        document = fixture()
        item(document, "interpretations", "I@1")["scope"] = ["publish"]
        self.invalid(document, "outside the declared proposal scope")

    def test_approval_requires_nonempty_scope(self) -> None:
        document = fixture()
        item(document, "interpretations", "I@1")["scope"] = []
        self.invalid(document, "nonempty scope")

    def test_empty_approval_text_is_not_semantically_interpreted(self) -> None:
        document = fixture()
        item(document, "sources", "U@1")["text"] = "This is not approval."
        result = self.invoke("check", self.seal(document))
        self.assertEqual(result.returncode, 0)
        self.assertIn("not authenticated", result.stdout)

    def test_unknown_human_approved_marker_is_rejected(self) -> None:
        document = fixture()
        item(document, "claims", "G@1")["human_approved"] = True
        self.invalid(document, "unknown")

    def test_duplicate_json_key_rejected(self) -> None:
        for command in ("snapshot", "check", "render"):
            with self.subTest(command=command):
                result = self.call(command, '{"version":1,"version":1}')
                self.assertEqual(result.returncode, 1)
                self.assertIn("duplicate JSON key", result.stderr)
                self.assertEqual(result.stdout, "")

    def test_unknown_and_noninteger_versions(self) -> None:
        for version in (0, 2, True, "1"):
            with self.subTest(version=version):
                document = fixture()
                document["version"] = version
                self.invalid(document, "unsupported format version")

    def test_nonfinite_and_float_json_rejected(self) -> None:
        for value in ("NaN", "Infinity", "1.0"):
            with self.subTest(value=value):
                result = self.call("snapshot", '{"version":' + value + '}')
                self.assertEqual(result.returncode, 1)
                self.assertNotIn("Traceback", result.stderr)

    def test_malformed_and_wrong_shape_json(self) -> None:
        for raw in ("{", "[]", "null", '"value"'):
            with self.subTest(raw=raw):
                result = self.call("snapshot", raw)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, "")
                self.assertNotIn("Traceback", result.stderr)

    def test_missing_field_and_dangling_reference(self) -> None:
        document = fixture()
        del item(document, "claims", "G@1")["open"]
        self.invalid(document, "missing")
        document = fixture()
        item(document, "claims", "G@1")["basis"] = ["missing@1"]
        self.invalid(document, "missing interpretations reference")

    def test_wrong_reference_category(self) -> None:
        document = fixture()
        item(document, "interpretations", "I@1")["input"] = "P@1"
        self.invalid(document, "not raw input")

    def test_invalid_ids_revisions_and_selection_alias(self) -> None:
        for reference in ("G@0", "G@01", "G", "G@-1", "G\n@1"):
            with self.subTest(reference=reference):
                document = fixture()
                obj(obj(document["active"])["claims"])["G"] = reference
                self.invalid(document, "exact ID@positive")
        document = fixture()
        obj(obj(document["active"])["claims"])["alias"] = "G@1"
        self.invalid(document, "must match")

    def test_check_requires_fingerprints(self) -> None:
        result = self.invoke("check", fixture())
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing _sha256", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_snapshot_does_not_repair_existing_fingerprint(self) -> None:
        document = self.seal(fixture())
        item(document, "sources", "U@1")["text"] = "changed"
        self.invalid(document, "fingerprint mismatch")

    def test_previous_history_cannot_be_deleted(self) -> None:
        previous = self.seal(fixture())
        current = copy.deepcopy(previous)
        del obj(current["sources"])["U2@1"]
        del obj(current["interpretations"])["I2@1"]
        item(current, "claims", "G@1")["basis"] = ["I@1"]
        del item(current, "claims", "G@1")["_sha256"]
        current = self.seal(current)
        result = self.call("diff", json.dumps(previous), json.dumps(current))
        self.assertEqual(result.returncode, 1)
        self.assertIn("immutable history", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_recomputed_hash_does_not_hide_mutated_history(self) -> None:
        previous = self.seal(fixture())
        current = fixture()
        item(current, "sources", "P@1")["text"] = "different proposal"
        current = self.seal(current)
        result = self.call("diff", json.dumps(previous), json.dumps(current))
        self.assertEqual(result.returncode, 1)
        self.assertIn("immutable history", result.stderr)

    def test_conditions_only_revision_does_not_inherit_evidence(self) -> None:
        previous = self.seal(with_evidence())
        current = copy.deepcopy(previous)
        next_claim = copy.deepcopy(item(current, "claims", "G@1"))
        del next_claim["_sha256"]
        next_claim["conditions"] = ["New applicability condition."]
        obj(current["claims"])["G@2"] = next_claim
        obj(obj(current["active"])["claims"])["G"] = "G@2"
        current = self.seal(current)
        result = self.call("diff", json.dumps(previous), json.dumps(current))
        self.assertEqual(result.returncode, 0, result.stderr)
        findings = json.loads(result.stdout)["evidence_applicability"]
        self.assertFalse(findings[0]["current_selection_match"])
        self.assertIn("G@1", findings[0]["reasons"][0])

    def test_changed_environment_does_not_reuse_evidence(self) -> None:
        document = with_evidence()
        next_dependency = copy.deepcopy(item(document, "dependencies", "D@1"))
        next_dependency["digest"] = "2" * 64
        obj(document["dependencies"])["D@2"] = next_dependency
        obj(obj(document["active"])["dependencies"])["D"] = "D@2"
        result = self.invoke("check", self.seal(document))
        self.assertFalse(json.loads(result.stdout)["evidence_applicability"][0]["current_selection_match"])

    def test_evidence_must_include_subject_dependencies(self) -> None:
        document = with_evidence()
        item(document, "evidence", "E@1")["dependencies"] = []
        self.invalid(document, "omits dependencies")

    def test_all_reported_outcomes_remain_distinct(self) -> None:
        for outcome in ("pass", "fail", "error", "skipped", "unavailable", "unchecked"):
            with self.subTest(outcome=outcome):
                document = with_evidence()
                item(document, "evidence", "E@1")["outcome"] = outcome
                result = self.invoke("check", self.seal(document))
                self.assertEqual(json.loads(result.stdout)["evidence_applicability"][0]["recorded_outcome"], outcome)

    def test_no_artifact_traversal(self) -> None:
        document = with_evidence()
        obj(item(document, "evidence", "E@1")["artifact"])["ref"] = "/nonexistent/private/file"
        self.assertEqual(self.invoke("check", self.seal(document)).returncode, 0)

    def test_render_preserves_all_conditions_and_open_matters(self) -> None:
        document = fixture()
        conditions = [f"condition-{number}" for number in range(20)]
        item(document, "claims", "G@1")["conditions"] = cast(list[Json], conditions)
        result = self.invoke("render", self.seal(document))
        for condition in conditions:
            self.assertIn(condition, result.stdout)
        self.assertIn("File format remains unresolved.", result.stdout)

    def test_markdown_is_literal_data(self) -> None:
        document = fixture()
        value = "````\n# FAKE APPROVED\n<script>not code</script>\n| table |"
        item(document, "claims", "G@1")["text"] = value
        result = self.invoke("render", self.seal(document))
        self.assertIn("`````text\n" + value + "\n`````", result.stdout)

    def test_render_control_characters_are_visible_escapes(self) -> None:
        document = fixture()
        item(document, "claims", "G@1")["text"] = "text\x1b[2J\rhidden\u202e"
        result = self.invoke("render", self.seal(document))
        self.assertNotIn("\x1b", result.stdout)
        self.assertNotIn("\u202e", result.stdout)
        self.assertIn("\\u001b", result.stdout)

    def test_evidence_checked_scope_is_visible(self) -> None:
        result = self.invoke("render", self.seal(with_evidence()))
        self.assertIn("nominal-only", result.stdout)

    def test_selected_dependency_declaration_is_visible(self) -> None:
        result = self.invoke("render", self.seal(with_evidence()))
        self.assertIn("fixture-environment-A", result.stdout)

    def test_declared_evidence_author_is_visible(self) -> None:
        document = with_evidence()
        item(document, "evidence", "E@1")["by"] = "reported-reviewer-A"
        sealed = self.seal(document)
        for command in ("check", "render"):
            with self.subTest(command=command):
                self.assertIn("reported-reviewer-A", self.invoke(command, sealed).stdout)

    def test_historical_dependency_declaration_remains_visible(self) -> None:
        document = with_evidence()
        next_dependency = copy.deepcopy(item(document, "dependencies", "D@1"))
        next_dependency["ref"] = "fixture-environment-B"
        next_dependency["digest"] = "2" * 64
        obj(document["dependencies"])["D@2"] = next_dependency
        obj(obj(document["active"])["dependencies"])["D"] = "D@2"
        result = self.invoke("render", self.seal(document))
        self.assertIn("fixture-environment-A", result.stdout)
        self.assertIn("fixture-environment-B", result.stdout)
        self.assertIn("not selected", result.stdout)

    def test_declared_source_authors_remain_visible(self) -> None:
        document = fixture()
        item(document, "sources", "U@1")["by"] = "reported-tool-transcript"
        item(document, "sources", "P@1")["by"] = "reported-proposal-author"
        result = self.invoke("render", self.seal(document))
        self.assertIn("reported-tool-transcript", result.stdout)
        self.assertIn("reported-proposal-author", result.stdout)

    def test_declared_original_source_locator_is_retained_and_visible(self) -> None:
        document = fixture()
        item(document, "sources", "U@1")["source_ref"] = "synthetic:original-message-123"
        sealed = self.seal(document)
        self.assertEqual(item(sealed, "sources", "U@1")["source_ref"], "synthetic:original-message-123")
        result = self.invoke("render", sealed)
        self.assertIn("synthetic:original-message-123", result.stdout)

    def test_missing_file_is_io_failure(self) -> None:
        result = subprocess.run([sys.executable, str(SCRIPT), "check", str(self.directory / "missing")], capture_output=True, text=True, timeout=TIMEOUT_SECONDS, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertNotIn("Traceback", result.stderr)

    def test_empty_selection_is_not_readiness(self) -> None:
        document = fixture()
        obj(document["active"])["claims"] = {}
        result = self.invoke("render", self.seal(document))
        self.assertIn("no readiness judgment", result.stdout)


if __name__ == "__main__":
    unittest.main()
