import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const vite = await createServer({ root, server: { middlewareMode: true, watch: null }, appType: "custom" });
try {
  const { Login } = await vite.ssrLoadModule("/src/Login.tsx");
  const login = renderToStaticMarkup(createElement(Login));
  assert.match(login, /<main[^>]*data-account-auth=""/, "sign-in is rendered by the common account module into its mount");
  assert.doesNotMatch(login, /\bToken\b|name="token"/, "API credentials are not browser sessions");
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(index, /href="\/account\.css"/);
  assert.match(index, /src="\/account\.js"/);
  const { Browse } = await vite.ssrLoadModule("/src/Browse.tsx");
  const { LiveProvider } = await vite.ssrLoadModule("/src/Live.tsx");
  const html = renderToStaticMarkup(createElement(LiveProvider, { onAuthLost() {} }, createElement(Browse, {
    initial: { query: "", sort: { field: "modified-at", direction: "desc" }, migrationError: null },
    preset: "browse", userId: "op", activityProjectId: "agent-activity", onOpen() {}, onAuthLost() {},
  })));
  assert.doesNotMatch(html, />Next<|>Back</, "cursor pagination must not be exposed as pages");
  assert.match(html, /aria-label="Sort by Modified"/);
  assert.match(html, /aria-sort="descending"/);
  assert.match(html, /aria-label="Sort by Project"/);
  assert.doesNotMatch(html, /Project scope|Tag filter|All projects|tag name \(exact\)|type="(?:radio|checkbox)"|<select|Insert filter|query-presets/, "all filtering belongs in the expression, not secondary controls or presets");
  assert.equal((html.match(/role="combobox"/g) ?? []).length, 1, "only the query editor has a completion combobox");
  assert.match(html, /Clear search expression/);
  assert.match(html, /Query syntax/);
  console.log("ok - browse initial markup exposes one expression, secondary help and sortable columns without pagination");
} finally { await vite.close(); }
