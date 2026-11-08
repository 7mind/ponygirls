import unittest

from profile import Rejected
from run import read_json, sha, write_json
from session_report import bind, render
from session_run import score_result
import test_session_runner as controls


class SessionReportTests(unittest.TestCase):
    def setUp(self):
        self.controls = controls.SessionRunnerTests("runTest")
        self.controls.setUp()
        self.addCleanup(self.controls.tearDown)
        self.controls.run_session("none")
        directory = self.controls.out
        write_json(directory / "score.json",score_result(self.controls.args))
        write_json(directory / "semantic-review.json",{"score_sha256":sha(directory / "score.json"), "attempts_sha256":sha(directory / "attempts.json"), "manifest_sha256":sha(directory / "manifest.json"), "scope":"scripted presentation controls, not semantic quality", "text":"<script>forged()</script>"})
        bind(directory)

    def render(self):
        return render(self.controls.out,self.controls.session_path,self.controls.oracle_path)

    def test_all_checkpoints_visible_and_untrusted_text_escaped(self):
        document = self.render()
        self.assertEqual(document.count('<article id="C'),12)
        self.assertIn('C12 · published',document)
        self.assertIn('Scripted mechanics-only objective',document)
        self.assertIn('&lt;script&gt;forged()&lt;/script&gt;',document)
        self.assertNotIn('<script>',document)
        self.assertIn('not Human ratification or execution authority',document)
        self.assertIn('not Human gold or independent-family certification',document)

    def test_post_binding_graph_mutation_is_rejected(self):
        path = self.controls.out / "C01/view.json"
        value = read_json(path)
        value["graph"]["nodes"][0]["text"] = "forged"
        self.controls.change(path,value)
        with self.assertRaisesRegex(Rejected,"artifact binding"):
            self.render()

    def test_refreshed_receipts_and_presentation_cannot_override_original_model_graph(self):
        directory = self.controls.out
        path = directory / "C01/view.json"
        value = read_json(path)
        value["graph"]["nodes"][0]["text"] = "forged"
        self.controls.change(path,value)
        self.controls.refresh_checkpoint_receipt("C01")
        bindings_path = directory / "presentation-bindings.json"
        bindings = read_json(bindings_path)
        bindings["files"] = {name:sha(directory/name) for name in bindings["files"]}
        self.controls.change(bindings_path,bindings)
        with self.assertRaisesRegex(Rejected,"original model return"):
            self.render()

if __name__ == "__main__":unittest.main()
