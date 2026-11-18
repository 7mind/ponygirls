import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { TurnRelay } from "../executor/turn-relay.ts";

for (const revoked of [false, true]) {
  test(`relay reasserts delegation authority after body preparation (revoked=${revoked})`, async () => {
    let entries = 0;
    const upstream = http.createServer(async (request, response) => { for await (const _chunk of request) {} entries++; response.writeHead(200, { "content-type": "text/event-stream" }); response.end(); });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const relay = new TurnRelay(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`);
    let allowed = true;
    let assertions = 0;
    relay.beginTurn(undefined, undefined, [], () => { assertions++; if (!allowed) throw new Error("delegation revoked before relay entry"); });
    try {
      const url = await relay.start();
      let request!: http.ClientRequest;
      const response = new Promise<number | undefined>((resolve, reject) => {
        request = http.request(`${url}/v1/messages`, { method: "POST" }, async (reply) => { for await (const _chunk of reply) {} resolve(reply.statusCode); });
        request.once("error", reject);
      });
      request.write('{"messages":');
      await new Promise((resolve) => setImmediate(resolve));
      if (revoked) allowed = false;
      request.end("[]}");
      assert.equal(await response, revoked ? 502 : 200);
      await relay.settled();
      assert.equal(assertions, 1);
      assert.equal(entries, revoked ? 0 : 1);
      if (revoked) assert.match(relay.failure!, /delegation revoked/);
    } finally {
      await relay.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
}
