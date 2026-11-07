"""Behavioral-Active Blackbox Group/real-SQLite contracts for one evolving graph."""
from pathlib import Path
import tempfile
import unittest

from profile import Rejected
from session_profile import Event, Graph, parse_graph
from session_pilot import SessionPilot
from store import MemoryStore, SqliteStore


def graph():
    return {"nodes": [{"id": "goal", "kind": "objective", "intent": "explicit", "state": "active", "priority": "primary", "text": "Reader can choose the correct response", "sources": ["E01"]},
                      {"id": "assumption", "kind": "constraint", "intent": "inferred", "state": "active", "priority": "none", "text": "Worker assumed speed was the target", "sources": ["E02"]}],
            "relations": [{"id": "r", "kind": "contributes_to", "state": "active", "source": "assumption", "target": "goal", "sources": ["E02"]}]}

EVENTS = (Event("E01", "human", "Help readers choose a correct response, not merely read faster."), Event("E02", "worker", "I assumed reducing reading time would fulfill the objective."))


class SessionContract(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.directory.cleanup()

    def pilots(self):
        for store in (MemoryStore(), SqliteStore(Path(self.directory.name) / "session.sqlite", "write")):
            pilot = SessionPilot(store)
            pilot.initialize("S01")
            try:
                yield pilot
            finally:
                store.close()

    def publication(self, pilot, checkpoint, value):
        ticket = pilot.begin(checkpoint)
        pilot.publish(ticket, value)
        pilot.drained(ticket)
        return ticket

    def test_initial_and_readonly_view(self):
        for pilot in self.pilots():
            before = pilot.store.read()
            view = pilot.view()
            self.assertEqual(view["graph"], {"nodes": [], "relations": []})
            self.assertEqual(view["coverage"], "unreviewed-or-failed-prefix")
            self.assertEqual(pilot.store.read(), before)

    def test_sources_immutable_and_duplicate_delivery_idempotent(self):
        for pilot in self.pilots():
            pilot.append(EVENTS)
            before = pilot.store.read()
            pilot.append(EVENTS)
            self.assertEqual(pilot.store.read(), before)
            with self.assertRaisesRegex(Rejected, "immutable"):
                pilot.append((Event("E01", "human", "Changed original source"),))
            self.assertEqual(pilot.store.read(), before)

    def test_automatic_reclassification_preserves_concept_and_source_history(self):
        for pilot in self.pilots():
            pilot.append(EVENTS)
            self.publication(pilot, "C01", graph())
            correction = Event("E03", "human", "Speed was your assumption, not a requirement; remove that supposed constraint.")
            pilot.append((correction,))
            ticket = pilot.begin("C02")
            self.assertEqual(ticket.snapshot.previous, parse_graph(graph(), EVENTS, Graph((), ())))
            revised = graph()
            revised["nodes"][1].update(kind="statement", intent="none", state="superseded", text="Retracted worker assumption, never a Human constraint", sources=["E02", "E03"])
            revised["relations"][0].update(state="withdrawn", sources=["E03"])
            pilot.publish(ticket, revised)
            pilot.drained(ticket)
            self.assertEqual(pilot.view()["graph"], revised)
            self.assertEqual(pilot.view()["events"][0]["text"], EVENTS[0].text)
            self.assertEqual(pilot.history()[0]["graph"], graph())
            self.assertEqual(len(pilot.history()), 2)

    def test_forgotten_node_or_edge_rejected_atomically(self):
        for pilot in self.pilots():
            pilot.append(EVENTS)
            self.publication(pilot, "C01", graph())
            for index, kind in enumerate(("nodes", "relations")):
                ticket = pilot.begin(f"C{index+2:02}")
                bad = graph()
                bad[kind] = []
                before = pilot.store.read()
                with self.assertRaises(Rejected):
                    pilot.publish(ticket, bad)
                self.assertEqual(pilot.store.read(), before)
                pilot.fail(ticket, "invalid-retention")
                pilot.drained(ticket)
            self.assertEqual(len(pilot.history()), 1)

    def test_future_and_forged_human_tag_rejected(self):
        for pilot in self.pilots():
            pilot.append(EVENTS)
            for index, mode in enumerate(("future", "authority", "tag")):
                ticket = pilot.begin(f"C{index+1:02}")
                value = graph()
                if mode == "future": value["nodes"][0]["sources"] = ["E99"]
                if mode == "authority": value["human_acceptance"] = True
                if mode == "tag": value["nodes"][1]["intent"] = "explicit"
                with self.assertRaises(Rejected): pilot.publish(ticket, value)
                pilot.fail(ticket, "invalid")
                pilot.drained(ticket)
            self.assertEqual(pilot.history(), [])

    def test_changed_source_fences_old_model_return(self):
        for pilot in self.pilots():
            pilot.append(EVENTS)
            ticket = pilot.begin("C01")
            pilot.append((Event("E03", "human", "New clarification"),))
            with self.assertRaisesRegex(Rejected, "stale"):
                pilot.publish(ticket, graph())
            self.assertEqual(pilot.history(), [])
            pilot.fail(ticket, "stale")
            pilot.drained(ticket)
            self.assertEqual(pilot.view()["coverage"], "unreviewed-or-failed-prefix")
            self.publication(pilot, "C02", graph())
            self.assertEqual(pilot.view()["last_valid_through"], 3)

    def test_one_lease_and_no_checkpoint_rescue(self):
        for pilot in self.pilots():
            pilot.append(EVENTS)
            ticket = pilot.begin("C01")
            with self.assertRaises(Rejected): pilot.begin("C02")
            with self.assertRaises(Rejected): pilot.drained(ticket)
            pilot.fail(ticket, "provider-error")
            with self.assertRaises(Rejected): pilot.begin("C02")
            pilot.drained(ticket)
            with self.assertRaises(Rejected): pilot.begin("C01")
            self.assertEqual(pilot.view()["attempts"][0]["outcome"], "failed")

    def test_invalid_checkpoint_retains_prior_graph_without_claiming_current_coverage(self):
        for pilot in self.pilots():
            pilot.append(EVENTS)
            self.publication(pilot, "C01", graph())
            pilot.append((Event("E03", "tool", "New contradicting observation"),))
            ticket = pilot.begin("C02")
            pilot.fail(ticket, "invalid-response")
            pilot.drained(ticket)
            self.assertEqual(pilot.view()["graph"], graph())
            self.assertEqual(pilot.view()["last_valid_through"], 2)
            self.assertEqual(pilot.view()["current_prefix"], 3)
            self.assertEqual(pilot.view()["coverage"], "unreviewed-or-failed-prefix")
            later = pilot.begin("C03")
            self.assertEqual(later.snapshot.previous.wire(), graph())
            pilot.fail(later, "stop")
            pilot.drained(later)


class SqliteSessionTests(unittest.TestCase):
    def test_restart_between_checkpoints_keeps_graph_not_a_new_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.sqlite"
            store = SqliteStore(path, "write")
            pilot = SessionPilot(store)
            pilot.initialize("S01")
            pilot.append(EVENTS)
            ticket = pilot.begin("C01")
            pilot.publish(ticket, graph())
            pilot.drained(ticket)
            store.close()
            store = SqliteStore(path, "write")
            pilot = SessionPilot(store)
            pilot.append((Event("E03", "human", "Clarify the target"),))
            next_ticket = pilot.begin("C02")
            self.assertEqual(next_ticket.snapshot.previous.wire(), graph())
            self.assertEqual(len(next_ticket.snapshot.events), 3)
            pilot.fail(next_ticket, "stop")
            pilot.drained(next_ticket)
            store.close()

    def test_inflight_restart_is_not_permission_to_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "session.sqlite"
            store = SqliteStore(path, "write")
            pilot = SessionPilot(store)
            pilot.initialize("S01")
            pilot.append(EVENTS)
            pilot.begin("C01")
            store.close()
            store = SqliteStore(path, "write")
            pilot = SessionPilot(store)
            with self.assertRaisesRegex(Rejected, "busy"):
                pilot.begin("C02")
            self.assertTrue(pilot.view()["inflight_marker"])
            store.close()

if __name__ == "__main__":
    unittest.main()
