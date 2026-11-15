// Behavioral-Active-Blackbox-GoodCommunication: selected production Main,
// synthetic web root and an owned disposable PostgreSQL database.
import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixture } from "./fixture.mjs";

it("fixed account assets serve same-size timestamp-preserving updates while hashed bundles retain 304", { timeout: 30000 }, async () => {
  const timestamp = new Date(1000);
  const f = await fixture({}, async (config, { dir }) => {
    config.webRoot = path.join(dir, "web");
    await mkdir(config.webRoot);
  });
  try {
    for (const name of ["account.js", "account.css"]) {
      const file = path.join(f.config.webRoot, name);
      await writeFile(file, "/* account v1 */\n");
      await utimes(file, timestamp, timestamp);
      const first = await f.call(`/${name}`, undefined, { method: "GET" });
      assert.equal(first.status, 200);
      assert.equal(await first.text(), "/* account v1 */\n");
      const etag = first.headers.get("etag");
      const modified = first.headers.get("last-modified");
      assert.ok(etag !== null && modified !== null, "the initial response supplies the old metadata validators");
      await writeFile(file, "/* account v2 */\n");
      await utimes(file, timestamp, timestamp);
      for (const headers of [{ "If-None-Match": etag }, { "If-Modified-Since": modified }, { "If-None-Match": etag, "If-Modified-Since": modified }]) {
        const current = await f.call(`/${name}`, undefined, { method: "GET", headers });
        assert.equal(current.status, 200, `${name} must not return metadata-only 304 after replacement`);
        assert.equal(await current.text(), "/* account v2 */\n");
        assert.equal(current.headers.get("cache-control"), "no-store");
      }
    }
    const name = "index-12345678.js";
    await writeFile(path.join(f.config.webRoot, name), "/* immutable */\n");
    const first = await f.call(`/${name}`, undefined, { method: "GET" });
    assert.equal(first.status, 200);
    await first.text();
    const etag = first.headers.get("etag");
    assert.ok(etag !== null);
    const cached = await f.call(`/${name}`, undefined, { method: "GET", headers: { "If-None-Match": etag } });
    assert.equal(cached.status, 304);
    assert.equal(await cached.text(), "");
    assert.equal(cached.headers.get("cache-control"), "public, max-age=31536000, immutable");
  } finally {
    await f.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});
