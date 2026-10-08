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
});
