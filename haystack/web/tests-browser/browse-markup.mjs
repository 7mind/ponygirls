import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const vite = await createServer({ root, server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { Browse } = await vite.ssrLoadModule("/src/Browse.tsx");
  const html = renderToStaticMarkup(createElement(Browse, {
    initial: { query: "", project: "", archive: "hide", tag: "", sort: { field: "modified-at", direction: "desc" } },
    inbox: false, onOpen() {}, onAuthLost() {},
  }));
  assert.doesNotMatch(html, />Next<|>Back</, "cursor pagination must not be exposed as pages");
  assert.match(html, /aria-label="Sort by Modified"/);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /aria-label="Sort by Project"/);
  console.log("ok - browse initial markup exposes sortable columns without pagination");
} finally { await vite.close(); }
