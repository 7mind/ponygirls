"""Step 2: outcome decisions, terminal transitions, record validation."""
import unittest

from support import sv

CODE0 = sv.ExitEvidence("code", 0, None)
CODE3 = sv.ExitEvidence("code", 3, None)
SIGTERM = sv.ExitEvidence("signal", None, "SIGTERM")


def decide(exit_evidence, **overrides):
    args = dict(shutdown=None, shutdown_detail=None, terminate_requested=False, output_failed=False,
                descendants_remaining=False, drain_timed_out=False, cleanup_confirmed=True)
    args.update(overrides)
    return sv.decide_outcome(exit_evidence, **args)


def record(**overrides):
    base = dict(id="bgt-1", seq=1, session_id="s", label="l", command="true", cwd="/", created_at="t",
                started_at="t", ended_at=None, activation="a1", state="running", phase="running", revision=2,
                exit=None, reason=None, reason_detail=None, log_path="tasks/bgt-1/terminal.log", log_bytes=0,
                notify=True, event=None, pid=10, pgid=10, interrupted_activation=None, clearing=False,
                cleanup_unconfirmed=False)
    base.update(overrides)
    return sv.TaskRecord(**base)


class OutcomeTest(unittest.TestCase):
    def test_successful_exit_completes(self):
        self.assertEqual(decide(CODE0), sv.Outcome("completed", "exit", None))

    def test_nonzero_exit_fails_with_code_retained(self):
        self.assertEqual(decide(CODE3), sv.Outcome("failed", "exit_nonzero", None))

    def test_signal_exit_fails(self):
        self.assertEqual(decide(SIGTERM), sv.Outcome("failed", "signaled", None))

    def test_explicit_termination_fails_even_when_the_handler_exits_zero(self):
        self.assertEqual(decide(CODE0, terminate_requested=True), sv.Outcome("failed", "terminated", None))

    def test_descendants_and_output_failures_are_never_completed(self):
        self.assertEqual(decide(CODE0, descendants_remaining=True).reason, "descendants_remaining")
        self.assertEqual(decide(CODE0, output_failed=True).reason, "output_failed")
        self.assertEqual(decide(CODE0, drain_timed_out=True).reason, "output_drain_timeout")

    def test_owner_loss_and_graceful_shutdown(self):
        self.assertEqual(decide(CODE0, shutdown="owner_lost"), sv.Outcome("dead", "owner_lost", None))
        self.assertEqual(decide(None, shutdown="graceful", shutdown_detail="reload"), sv.Outcome("failed", "session_shutdown", "reload"))

    def test_unconfirmed_cleanup_is_dead_without_inventing_exit(self):
        self.assertEqual(decide(None, shutdown="graceful", shutdown_detail="quit", cleanup_confirmed=False),
                         sv.Outcome("dead", "cleanup_unconfirmed", "quit"))

    def test_unknown_exit_evidence_cannot_complete(self):
        with self.assertRaises(AssertionError):
            decide(None)
        r = record()
        with self.assertRaises(AssertionError):
            sv.apply_terminal(r, sv.Outcome("completed", "exit", None), None, "t", 0, sv.NOTICE_PENDING)


class TransitionTest(unittest.TestCase):
    def test_terminal_outcome_and_event_id_are_immutable(self):
        r = record()
        sv.apply_terminal(r, decide(CODE3), CODE3, "end", 5, sv.NOTICE_PENDING)
        self.assertEqual((r.state, r.phase, r.exit, r.event.id), ("failed", None, CODE3, "bgt-1:3"))
        with self.assertRaises(AssertionError):
            sv.apply_terminal(r, decide(CODE0), CODE0, "end", 5, sv.NOTICE_PENDING)

    def test_recovery_marks_every_unfinished_phase_dead_and_keeps_evidence(self):
        for phase in sv.PHASES:
            r = record(phase=phase, exit=CODE0 if phase == "closing" else None)
            self.assertTrue(sv.reconcile_unfinished(r, "later"))
            self.assertEqual((r.state, r.reason, r.reason_detail, r.interrupted_activation), ("dead", "supervisor_lost", phase, "a1"))
            self.assertEqual(r.exit, CODE0 if phase == "closing" else None)
            self.assertEqual(r.event.status, sv.NOTICE_PENDING)

    def test_recovery_keeps_committed_terminal_outcomes(self):
        r = record()
        sv.apply_terminal(r, decide(CODE0), CODE0, "end", 0, sv.NOTICE_PENDING)
        before = r.to_json()
        self.assertFalse(sv.reconcile_unfinished(r, "later"))
        self.assertEqual(r.to_json(), before)

    def test_launch_failure_records_an_inline_notice(self):
        r = record(phase="starting", pid=None, pgid=None)
        sv.apply_terminal(r, sv.Outcome("failed", "launch_failed", "chdir failed"), None, "t", 0, sv.NOTICE_INLINE)
        self.assertEqual((r.state, r.reason, r.event.status), ("failed", "launch_failed", "inline"))


class RecordValidationTest(unittest.TestCase):
    def roundtrip(self, mutate):
        data = record().to_json()
        mutate(data)
        return sv.TaskRecord.from_json(data)

    def test_roundtrip(self):
        self.assertEqual(self.roundtrip(lambda d: None), record())

    def test_rejects_missing_fields_and_wrong_types(self):
        with self.assertRaises(ValueError):
            self.roundtrip(lambda d: d.pop("notify"))
        with self.assertRaises(ValueError):
            self.roundtrip(lambda d: d.update(notify="yes"))
        with self.assertRaises(ValueError):
            self.roundtrip(lambda d: d.update(seq=True))

    def test_rejects_forbidden_states(self):
        with self.assertRaises(ValueError):
            self.roundtrip(lambda d: d.update(state="completed", phase=None, reason="exit", event={"id": "x", "status": "pending"}))
        with self.assertRaises(ValueError):
            self.roundtrip(lambda d: d.update(state="failed", phase="running"))
        with self.assertRaises(ValueError):
            self.roundtrip(lambda d: d.update(phase="paused"))
        with self.assertRaises(ValueError):
            self.roundtrip(lambda d: d.update(clearing=True))

    def test_registry_schema_errors_are_explicit(self):
        with self.assertRaises(sv.DomainError) as cm:
            sv.Registry.from_json({"schema": "other", "version": 1}, "s")
        self.assertEqual(cm.exception.code, "UNSUPPORTED_SCHEMA")
        with self.assertRaises(sv.DomainError) as cm:
            sv.Registry.from_json({"schema": sv.REGISTRY_SCHEMA, "version": 1, "sessionId": "s", "nextSeq": 1, "revision": 0, "tasks": [{}]}, "s")
        self.assertEqual(cm.exception.code, "STORE_CORRUPT")
        with self.assertRaises(sv.DomainError) as cm:
            sv.Registry.from_json({"schema": sv.REGISTRY_SCHEMA, "version": 1, "sessionId": "other", "nextSeq": 1, "revision": 0, "tasks": []}, "s")
        self.assertEqual(cm.exception.code, "STORE_CORRUPT")


if __name__ == "__main__":
    unittest.main()
