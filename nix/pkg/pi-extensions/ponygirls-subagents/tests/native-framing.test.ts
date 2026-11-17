import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { NativeFrameServer, NativeRpcClient, NATIVE_CHUNK_BYTES, NATIVE_LOGICAL_BYTES } from "../src/native-framing.ts";
import { MAX_PAYLOAD_BYTES } from "../src/protocol.ts";

for (const text of ["hello", "🦄漢字".repeat(80_000), "data:image/png;base64," + "A".repeat(1024 * 1024)]) {
  test(`BA native canonical round trip preserves ${Buffer.byteLength(text)} UTF-8 bytes within envelope limits`, async () => {
    const server = new NativeFrameServer<string>(async (value) => value, (owner) => owner);
    let chunks = 0;
    const roundTrip = async (frame: unknown): Promise<unknown> => {
      assert.ok(Buffer.byteLength(JSON.stringify(frame)) < MAX_PAYLOAD_BYTES);
      const reply = await server.handle(frame, "generation1");
      assert.ok(Buffer.byteLength(JSON.stringify(reply)) < MAX_PAYLOAD_BYTES);
      chunks++;
      return reply;
    };
    assert.deepEqual(await new NativeRpcClient().call(roundTrip, { text }), { text });
    assert.ok(chunks >= Math.ceil(Buffer.byteLength(text) / NATIVE_CHUNK_BYTES));
  });
}

test("BA malformed canonical JSON errors never disclose transferred content", async () => {
  const bytes = Buffer.from("private-prompt-auth-sentinel");
  const server = new NativeFrameServer<string>(async () => assert.fail("must not invoke"), (owner) => owner);
  const reply = await server.handle({ kind: "upload", chunk: { id: "0", type: "canonical-json-v1", index: 0, length: bytes.length, digest: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64") } }, "owner") as { ok: boolean; error: string };
  assert.equal(reply.ok, false);
  assert.equal(reply.error.includes("private"), false);
});

test("BA native framing denies oversize before invoking inference", async () => {
  let invocations = 0;
  const server = new NativeFrameServer<string>(async () => { invocations++; return {}; }, (owner) => owner);
  await assert.rejects(new NativeRpcClient().call((frame) => server.handle(frame, "owner"), { text: "a".repeat(NATIVE_LOGICAL_BYTES) }), /PAYLOAD_TOO_LARGE/);
  assert.equal(invocations, 0);
});

for (const defect of ["duplicate", "index", "digest", "scope", "retired"] as const) {
  test(`BA native framing rejects ${defect} frames without replay`, async () => {
    let invocations = 0;
    const server = new NativeFrameServer<string>(async (value) => { invocations++; return value; }, (owner) => owner);
    let saved: unknown;
    let owner = "first";
    const client = new NativeRpcClient();
    const reply = await client.call(async (frame) => {
      if (saved === undefined) saved = structuredClone(frame);
      return server.handle(frame, owner);
    }, { text: "a".repeat(NATIVE_CHUNK_BYTES * 2) });
    assert.ok(reply);
    assert.equal(invocations, 1);
    if (defect === "duplicate") {
      assert.equal((await server.handle(saved, owner) as { ok: boolean }).ok, false);
    } else if (defect === "retired") {
      server.retire();
      await assert.rejects(client.call((frame) => server.handle(frame, owner), {}), /retired/);
    } else {
      let frames = 0;
      await assert.rejects(client.call(async (frame) => {
        const modified = structuredClone(frame) as { chunk: { index: number; digest: string } };
        if (frames++ === 1) {
          if (defect === "index") modified.chunk.index++;
          if (defect === "digest") modified.chunk.digest = "0".repeat(64);
          if (defect === "scope") owner = "second";
        }
        return server.handle(modified, owner);
      }, { text: "b".repeat(NATIVE_CHUNK_BYTES * 2) }), /INVALID/);
    }
    assert.equal(invocations, 1);
  });
}
