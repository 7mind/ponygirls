// BA: token codec + static config validation (no PG, always runs).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  generateToken,
  hashToken,
  isCanonicalToken,
  matchDigest,
  readDigestFile,
  readTokenFile,
  TokenFault,
} from "../src/auth/tokens.js";
import { loadAuth } from "../src/auth/config.js";

describe("token codec", () => {
  it("generates 43-char base64url tokens that hash stably", () => {
    const t = generateToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hashToken(t), createHash("sha256").update(t, "ascii").digest("hex"));
    assert.throws(() => hashToken("short"), TokenFault);
  });
  it("matches digests in constant-time style without early exit", () => {
    const t = generateToken();
    const h = hashToken(t);
    assert.equal(matchDigest(h, [generateTokenDigest(), h]), h);
    assert.equal(matchDigest(h, [generateTokenDigest()]), null);
  });
  it("accepts exact bytes or one final LF; rejects everything else", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-tok-"));
    const good = generateToken();
    const cases: Array<[string, string | null]> = [
      [good, good],
      [good + "\n", good],
      [good + "\n\n", null],
      ["", null],
      [good.slice(0, 42), null],
      [good + " ", null],
      ["a\n" + good, null],
      [good.slice(0, 10) + "\n" + good.slice(10), null],
      [good + "\r\n", null],
    ];
    let i = 0;
    for (const [content, want] of cases) {
      const file = path.join(dir, `c${i++}`);
      await writeFile(file, content);
      if (want === null) {
        await assert.rejects(readTokenFile(file), TokenFault, JSON.stringify(content).slice(0, 50));
      } else {
        assert.equal(await readTokenFile(file), want);
      }
    }
    await assert.rejects(readTokenFile(path.join(dir, "missing")), TokenFault);
    await writeFile(path.join(dir, "nul"), good + "\0");
    await assert.rejects(readTokenFile(path.join(dir, "nul")), TokenFault);
  });
  it("validates digest files strictly", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-dig-"));
    const good = "a".repeat(64);
    await writeFile(path.join(dir, "ok"), good + "\n");
    assert.equal(await readDigestFile(path.join(dir, "ok")), good);
    await writeFile(path.join(dir, "upper"), "A".repeat(64));
    await assert.rejects(readDigestFile(path.join(dir, "upper")), TokenFault);
    await writeFile(path.join(dir, "short"), "abc");
    await assert.rejects(readDigestFile(path.join(dir, "short")), TokenFault);
    // C2: raw high-bit alias 0xE6->'f' rejected; two-LF rejected; exact + one LF accepted.
    const { writeFile: _wfb } = await import("node:fs/promises");
    const alias = Buffer.from("f".repeat(64), "ascii");
    alias[0] = 0xe6;
    await _wfb(path.join(dir, "alias"), alias);
    await assert.rejects(readDigestFile(path.join(dir, "alias")), TokenFault);
    await _wfb(path.join(dir, "alias-lf"), Buffer.concat([alias, Buffer.from("\n")]));
    await assert.rejects(readDigestFile(path.join(dir, "alias-lf")), TokenFault);
    await _wfb(path.join(dir, "two-lf"), "a".repeat(64) + "\n\n");
    await assert.rejects(readDigestFile(path.join(dir, "two-lf")), TokenFault);
  });
  // regression: issue7 — non-canonical base64url must be rejected on every boundary.
  it("rejects non-canonical pad-bit aliases on file, hash, and auth boundaries", async () => {
    const malformed = "A".repeat(42) + "B";
    // Proves non-canonical: decodes to 32 bytes whose re-encode differs.
    const decoded = Buffer.from(malformed, "base64url");
    assert.equal(decoded.length, 32);
    assert.equal(decoded.toString("base64url"), "A".repeat(43));
    assert.equal(isCanonicalToken(malformed), false);
    assert.equal(isCanonicalToken("A".repeat(43)), true);
    assert.equal(isCanonicalToken(generateToken()), true);
    assert.throws(() => hashToken(malformed), TokenFault);
    // No credential bytes in the fault.
    try {
      hashToken(malformed);
      assert.fail("expected TokenFault");
    } catch (e) {
      assert.ok(e instanceof TokenFault);
      assert.ok(!(e as Error).message.includes(malformed));
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-noncanon-"));
    await writeFile(path.join(dir, "bad"), malformed + "\n");
    await assert.rejects(readTokenFile(path.join(dir, "bad")), TokenFault);
    await writeFile(path.join(dir, "bad-nolf"), malformed);
    await assert.rejects(readTokenFile(path.join(dir, "bad-nolf")), TokenFault);
    // Direct credential with terminator is rejected (no terminator on the wire).
    assert.throws(() => hashToken(malformed + "\n"), TokenFault);
  });
  // regression: Node ascii decoding strips high bits, so raw bytes need byte-level checks.
  it("rejects raw-byte aliases, controls, and terminal-LF direct presentations", async () => {
    const { writeFile: writeRaw } = await import("node:fs/promises");
    const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-raw-"));
    const good = generateToken();
    // Canonical positive: exact bytes and one final LF only.
    await writeRaw(path.join(dir, "exact"), good);
    assert.equal(await readTokenFile(path.join(dir, "exact")), good);
    await writeRaw(path.join(dir, "lf"), good + "\n");
    assert.equal(await readTokenFile(path.join(dir, "lf")), good);
    // High-bit alias: first byte 0xC1 decodes via ascii to 'A' but must be rejected.
    const alias = Buffer.from(good, "ascii");
    alias[0] = 0xc1;
    await writeRaw(path.join(dir, "alias"), alias);
    await assert.rejects(readTokenFile(path.join(dir, "alias")), TokenFault);
    // High-bit trailing byte.
    const alias2 = Buffer.from(good, "ascii");
    alias2[42] = 0x80;
    await writeRaw(path.join(dir, "alias2"), alias2);
    await assert.rejects(readTokenFile(path.join(dir, "alias2")), TokenFault);
    // Control byte (0x01) and DEL (0x7f) rejected without leaking bytes.
    const ctrl = Buffer.from(good, "ascii");
    ctrl[5] = 0x01;
    await writeRaw(path.join(dir, "ctrl"), ctrl);
    await assert.rejects(readTokenFile(path.join(dir, "ctrl")), TokenFault);
    const del = Buffer.from(good, "ascii");
    del[5] = 0x7f;
    await writeRaw(path.join(dir, "del"), del);
    await assert.rejects(readTokenFile(path.join(dir, "del")), TokenFault);
    // Direct presentations with LF/space rejected.
    assert.throws(() => hashToken(good + "\n"), TokenFault);
    assert.throws(() => hashToken(good + " "), TokenFault);
    assert.equal(isCanonicalToken(good + "\n"), false);
  });
});

function generateTokenDigest(): string {
  return hashToken(generateToken());
}

describe("static config", () => {
  async function setup(users: Array<{ id: string; type: "human" | "agent"; tokenIds: string[] }>): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-cfg-"));
    const cfgs = [];
    for (const u of users) {
      const tokens = [];
      for (const tid of u.tokenIds) {
        const digest = createHash("sha256").update(generateToken(), "ascii").digest("hex");
        const file = path.join(dir, `${u.id}-${tid}.sha`);
        await writeFile(file, digest + "\n");
        tokens.push({ id: tid, hashFile: file });
      }
      cfgs.push({ id: u.id, type: u.type, displayName: u.id, tokens });
    }
    return JSON.stringify(cfgs);
  }

  it("loads valid configs and authenticates by digest", async () => {
    const raw = await setup([{ id: "alice", type: "human", tokenIds: ["b"] }]);
    const cfgs = JSON.parse(raw) as Array<{ id: string; type: "human"; displayName: string; tokens: Array<{ id: string; hashFile: string }> }>;
    const auth = await loadAuth({
      activityProjectId: "a",
      users: cfgs,
      cookieSecure: false,
      allowedHosts: ["127.0.0.1"],
      allowedOrigins: [],
    });
    assert.equal(auth.activityProjectId, "a");
  });

  it("fails closed on every inconsistency", async () => {
    const mk = async (users: Array<{ id: string; type: string; tokenIds: string[] }>, extra?: object) => {
      const raw = await setup(users as Array<{ id: string; type: "human" | "agent"; tokenIds: string[] }>);
      const cfgs = JSON.parse(raw) as never;
      return loadAuth({
        activityProjectId: "a",
        users: cfgs,
        cookieSecure: false,
        allowedHosts: [],
        allowedOrigins: [],
        ...extra,
      });
    };
    await assert.rejects(mk([{ id: "a", type: "human", tokenIds: ["t"] }, { id: "a", type: "agent", tokenIds: ["u"] }]), /duplicate user/);
    await assert.rejects(mk([{ id: "a", type: "human", tokenIds: ["t", "t"] }]), /duplicate token/);
    await assert.rejects(mk([{ id: "a", type: "robot", tokenIds: ["t"] }]), /invalid type/);
    await assert.rejects(mk([{ id: "a", type: "human", tokenIds: [] }]), /no tokens/);
    await assert.rejects(mk([]), /at least one user/);
    await assert.rejects(
      loadAuth({ activityProjectId: "", users: [], cookieSecure: false, allowedHosts: [], allowedOrigins: [] }),
      /activityProjectId/,
    );
  });

  it("rejects a digest assigned to two identities", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-dup-"));
    const digest = createHash("sha256").update(generateToken(), "ascii").digest("hex");
    const f1 = path.join(dir, "1.sha");
    const f2 = path.join(dir, "2.sha");
    await writeFile(f1, digest);
    await writeFile(f2, digest);
    await assert.rejects(
      loadAuth({
        activityProjectId: "a",
        users: [
          { id: "a", type: "human", displayName: "a", tokens: [{ id: "t", hashFile: f1 }] },
          { id: "b", type: "agent", displayName: "b", tokens: [{ id: "u", hashFile: f2 }] },
        ],
        cookieSecure: false,
        allowedHosts: [],
        allowedOrigins: [],
      }),
      /assigned twice/,
    );
  });
  // regression: bad presentations return null (401), never throw (500).
  it("returns null for non-canonical and malformed presentations", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "haystack-authnull-"));
    const good = generateToken();
    const digest = createHash("sha256").update(good, "ascii").digest("hex");
    const file = path.join(dir, "good.sha");
    await writeFile(file, digest + "\n");
    const auth = await loadAuth({
      activityProjectId: "a",
      users: [{ id: "alice", type: "human", displayName: "alice", tokens: [{ id: "t", hashFile: file }] }],
      cookieSecure: false,
      allowedHosts: [],
      allowedOrigins: [],
    });
    // Positive still authenticates.
    assert.ok(auth.authenticate(good));
    // Non-canonical alias, short, terminator, empty, and high-bit alias all null.
    assert.equal(auth.authenticate("A".repeat(42) + "B"), null);
    assert.equal(auth.authenticate("short"), null);
    assert.equal(auth.authenticate(good + "\n"), null);
    assert.equal(auth.authenticate(""), null);
    assert.equal(auth.authenticate("A".repeat(43).slice(0, 42) + "\u00c1"), null);
    // Unknown canonical token also null (not throw).
    assert.equal(auth.authenticate(generateToken()), null);
  });
});
