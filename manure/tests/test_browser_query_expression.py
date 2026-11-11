"""Behavioral acceptance for query edits against the owned native target."""
import unittest

import browser_fixtures as bf


class QueryExpressionBrowserTests(unittest.TestCase):
    def test_submitted_route_preserves_a_newer_draft(self):
        fix = bf.start_server(suffix_mode="separate")
        self.addCleanup(fix.close)
        rows = bf.run_steps([
            {"op": "addInitScript", "fn": """() => {
              const add = window.addEventListener.bind(window);
              window.__holdRoute = false; window.__releaseRoute = null;
              window.addEventListener = (name, listener, options) => add(name, name === 'hashchange' ? event => {
                if (window.__holdRoute) window.__releaseRoute = () => listener(event); else listener(event);
              } : listener, options);
            }"""},
            {"op": "goto", "url": fix.api_base + "/"},
            {"op": "waitForEval", "fn": "() => !document.querySelector('#login-section').hidden"},
            {"op": "fill", "selector": "#token-input", "value": fix.identity.token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status", "contains": "shown"},
            {"op": "eval", "fn": "() => { window.__holdRoute = true; return true; }"},
            {"op": "fill", "selector": "#filter-text", "value": "submitted"},
            {"op": "click", "selector": "#search-submit"},
            {"op": "waitForEval", "fn": "() => window.__releaseRoute !== null"},
            {"op": "fill", "selector": "#filter-text", "value": "newer draft"},
            {"op": "eval", "fn": "() => { window.__holdRoute = false; window.__releaseRoute(); return {query:document.querySelector('#filter-text').value,status:document.querySelector('#draft-status').textContent}; }"},
        ])
        self.assertTrue(all(row["ok"] for row in rows), [row for row in rows if not row["ok"]])
        result = [row["value"] for row in rows if row["op"] == "eval"][-1]
        self.assertEqual(result["query"], "newer draft")
        self.assertIn("Draft changed", result["status"])

    def test_maximum_text_sort_preserves_applied_query_and_remains_usable(self):
        fix = bf.start_server(suffix_mode="separate")
        self.addCleanup(fix.close)
        rows = bf.run_steps([
            {"op": "addInitScript", "fn": "() => { window.__queryErrors=[]; addEventListener('error',event=>window.__queryErrors.push(event.message)); }"},
            {"op": "goto", "url": fix.api_base + "/"},
            {"op": "waitForEval", "fn": "() => !document.querySelector('#login-section').hidden"},
            {"op": "fill", "selector": "#token-input", "value": fix.identity.token},
            {"op": "click", "selector": "#login-form button[type=submit]"},
            {"op": "waitForText", "selector": "#list-status", "contains": "shown"},
            {"op": "fill", "selector": "#filter-text", "value": "a" * 4096},
            {"op": "click", "selector": "#search-submit"},
            {"op": "waitForEval", "fn": "() => new URLSearchParams(location.hash.split('?')[1]).get('query')?.length === 4096 && !document.querySelector('[data-sort=name]').disabled"},
            {"op": "eval", "fn": "() => { window.__beforeSort=location.hash; return true; }"},
            {"op": "click", "selector": "[data-sort=name]"},
            {"op": "waitForEval", "fn": "() => new URLSearchParams(location.hash.split('?')[1]).get('query')?.startsWith('sort:name ') && !document.querySelector('[data-sort=name]').disabled"},
            {"op": "eval", "fn": "() => ({errors:window.__queryErrors,unchanged:location.hash===window.__beforeSort,query:document.querySelector('#filter-text').value,status:document.querySelector('#draft-status').textContent})"},
            {"op": "fill", "selector": "#filter-text", "value": "after-sort"},
            {"op": "click", "selector": "#search-submit"},
            {"op": "waitForEval", "fn": "() => new URLSearchParams(location.hash.split('?')[1]).get('query') === 'after-sort'"},
            {"op": "eval", "fn": "() => ({errors:window.__queryErrors,query:document.querySelector('#filter-text').value,sort:document.querySelector('#sort-summary').textContent})"},
        ])
        self.assertTrue(all(row["ok"] for row in rows), [row for row in rows if not row["ok"]])
        values = [row["value"] for row in rows if row["op"] == "eval"]
        self.assertEqual(values[1]["errors"], [])
        self.assertFalse(values[1]["unchanged"])
        self.assertEqual(values[1]["query"], "sort:name direction:asc " + "a" * 4096)
        self.assertIn("Draft matches applied", values[1]["status"])
        self.assertEqual(values[2]["errors"], [])
        self.assertEqual(values[2]["query"], "after-sort")
        self.assertIn("Created", values[2]["sort"])
