"""Behavioral-Active / Blackbox-Atomic checks of the VM evidence guard.
No server mocks, network, VM, credentials or production state. These do not
substitute for the parent's actual native two-node VM execution.
"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from uuid import UUID, uuid4

from manure import current_protocol as cp

spec = importlib.util.spec_from_file_location("manure_vm_current_client", Path(__file__).with_name("manure-vm-current-client.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class CurrentReplyTests(unittest.TestCase):
    def test_current_version_is_correlated_and_closed(self):
        rid = uuid4()
        payload = cp.dumps(cp.ServerEnvelope(rid, cp.Result_Version(cp.VersionInfo("1.0.0", ["1.0.0"]))))
        self.assertIsInstance(probe.checked_reply(200, payload, rid, cp.Result_Version), cp.Result_Version)

    def test_status_failure_reports_only_status_variant_and_error_code(self):
        rid = uuid4()
        secret = "sensitive-fixture-body-never-log"
        payload = cp.dumps(cp.ServerEnvelope(rid, cp.Result_Error(cp.Failure(cp.ErrorCode.Forbidden, secret, None))))
        with self.assertRaises(AssertionError) as raised:
            probe.checked_reply(403, payload, rid, cp.Result_Identity)
        message = str(raised.exception)
        for field in ("expected=200", "actual=403", "result=Result_Error", "error=Forbidden"):
            self.assertIn(field, message)
        self.assertNotIn(secret, message)

    def test_status_failure_with_nonprotocol_body_never_logs_body(self):
        secret = "sensitive-nonprotocol-response"
        with self.assertRaises(AssertionError) as raised:
            probe.checked_reply(502, secret.encode(), uuid4(), cp.Result_Identity)
        self.assertIn("expected=200 actual=502 result=invalid-envelope error=none", str(raised.exception))
        self.assertNotIn(secret, str(raised.exception))

    def test_old_health_payload_is_not_a_current_response(self):
        with self.assertRaises(cp.ProtocolError):
            probe.checked_reply(200, b'{"ok":true}', uuid4(), cp.Result_Version)

    def test_wrong_correlation_never_passes(self):
        payload = cp.dumps(cp.ServerEnvelope(uuid4(), cp.Result_Version(cp.VersionInfo("1.0.0", ["1.0.0"]))))
        with self.assertRaises(AssertionError):
            probe.checked_reply(200, payload, uuid4(), cp.Result_Version)

    def test_pre_envelope_failure_requires_explicit_reserved_id_policy(self):
        rid = uuid4()
        payload = cp.dumps(cp.ServerEnvelope(UUID(int=0), cp.Result_Error(cp.Failure(cp.ErrorCode.TlsRequired, "tls required", None))))
        with self.assertRaises(AssertionError):
            probe.checked_reply(403, payload, rid, cp.Result_Error, 403, "TlsRequired")
        probe.checked_reply(403, payload, rid, cp.Result_Error, 403, "TlsRequired", True)

    def test_correct_status_with_wrong_current_error_rejected(self):
        rid = uuid4()
        payload = cp.dumps(cp.ServerEnvelope(rid, cp.Result_Error(cp.Failure(cp.ErrorCode.Forbidden, "forbidden", None))))
        with self.assertRaises(AssertionError):
            probe.checked_reply(403, payload, rid, cp.Result_Error, 403, "TlsRequired")

    def test_cookie_header_case_is_insensitive_and_attributes_mandatory(self):
        header = "__Host-manure=synthetic; Secure; HttpOnly; Path=/; SameSite=Strict"
        self.assertEqual(probe.cookie({"set-cookie": header}, "__Host-manure", "Strict"), "__Host-manure=synthetic")
        for omitted in ("; Secure", "; HttpOnly", "; Path=/", "; SameSite=Strict"):
            with self.subTest(omitted=omitted), self.assertRaises(AssertionError):
                probe.cookie({"Set-Cookie": header.replace(omitted, "")}, "__Host-manure", "Strict")
        with self.assertRaises(AssertionError):
            probe.cookie({"Set-Cookie": header + "; Domain=example.test"}, "__Host-manure", "Strict")


class ResumeObserverTests(unittest.TestCase):
    def setUp(self):
        root = Path(__file__).resolve().parents[2] / "debug/manure-vm-current"
        root.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(prefix="guard-", dir=root)
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.status = cp.UploadStatus("a" * 32, cp.ArtifactState.Uploading, 4,
            [cp.FileProgress("hm-big.bin", 12, 4, [cp.ByteRange(4, 8)])])
        self.status_file = self.root / "status.json"
        self.status_file.write_bytes(cp.dumps(self.status))
        self.log = self.root / "observer.jsonl"

    def record(self, offset, status="200", uri=None):
        return json.dumps({"uri": uri or "/api/current/artifacts/" + self.status.artifactId + "/chunks", "offset": str(offset), "status": status}) + "\n"

    def check(self, body, cursor=0):
        self.log.write_text(body)
        with contextlib.redirect_stdout(io.StringIO()):
            probe.check_resume(self.status_file, self.log, cursor)

    def test_exact_missing_multiset_includes_zero(self):
        self.assertEqual(probe.partial_status(self.status), {0, 8})
        self.check(self.record(0) + self.record(8))

    def test_same_count_but_acked_offset_reuploaded_rejected(self):
        with self.assertRaises(AssertionError):
            self.check(self.record(0) + self.record(4))

    def test_duplicate_missing_offset_cannot_replace_another(self):
        with self.assertRaises(AssertionError):
            self.check(self.record(0) + self.record(0))

    def test_omitted_chunk_and_extra_retransmission_both_rejected(self):
        for offsets in ([0], [0, 8, 4]):
            with self.subTest(offsets=offsets), self.assertRaises(AssertionError):
                self.check("".join(self.record(offset) for offset in offsets))

    def test_failure_or_499_in_the_resume_window_is_never_filtered(self):
        for status in ("499", "500", "409"):
            with self.subTest(status=status), self.assertRaises(AssertionError):
                self.check(self.record(0) + self.record(8, status))

    def test_wrong_artifact_and_unsafe_observer_fields_rejected(self):
        with self.assertRaises(AssertionError):
            self.check(self.record(0) + self.record(8, uri="/api/current/artifacts/" + "b" * 32 + "/chunks"))
        with self.assertRaises(AssertionError):
            self.check(self.record(0) + json.dumps({"uri": "ignored", "offset": "8", "status": "200", "args": "forbidden"}) + "\n")

    def test_only_explicit_byte_boundary_excludes_pre_drain_records(self):
        old = self.record(4, "499")
        body = old + self.record(0) + self.record(8)
        self.check(body, len(old.encode()))
        with self.assertRaises(AssertionError):
            self.check(body)
        with self.assertRaises(AssertionError):
            self.check(body, len(old.encode()) - 2)

    def test_empty_or_complete_baseline_cannot_claim_reuse(self):
        for received, ranges in ((0, []), (12, [cp.ByteRange(0, 12)])):
            status = cp.UploadStatus("a" * 32, cp.ArtifactState.Uploading, 4,
                [cp.FileProgress("hm-big.bin", 12, received, ranges)])
            with self.subTest(received=received), self.assertRaises(AssertionError):
                probe.partial_status(status)

    def test_duplicate_observer_keys_are_rejected(self):
        bad = self.record(8).replace('"status": "200"', '"status": "200", "status": "499"')
        with self.assertRaises(cp.ProtocolError):
            self.check(self.record(0) + bad)


if __name__ == "__main__":
    unittest.main(verbosity=2)
