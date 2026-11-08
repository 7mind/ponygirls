// A local scripted OpenAI-compatible chat/completions SSE provider for
// deterministic SDK tests. Fixture names only: no real provider identity,
// endpoint or credential appears here; the server binds loopback only.
//
// Script turn shapes:
//   { type: "text", text: "..." }                       plain text, finish "stop"
//   { type: "text", text: "...", finish: "length" }     text with a non-stop finish
//   { type: "tool", name: "write", args: {...} }        a tool call, finish "tool_calls"
//   { type: "hang" }                                    accept the request, never respond
//   { type: "http-error", status: 500 }                 non-streaming HTTP failure

import { createServer } from "node:http";

/**
 * @param {string} res
 * @param {unknown} payload
 */
function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function chunkBody(delta, finishReason) {
  return {
    id: "chatcmpl-rites-fixture",
    object: "chat.completion.chunk",
    created: 1_700_000_000,
    model: "rites-fixture-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function usageBody() {
  return {
    id: "chatcmpl-rites-fixture",
    object: "chat.completion.chunk",
    choices: [],
    usage: { prompt_tokens: 16, completion_tokens: 8, total_tokens: 24 },
  };
}

function respondWithTurn(res, turn) {
  if (turn.type === "hang") {
    return;
  }
  if (turn.type === "http-error") {
    res.writeHead(turn.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "synthetic scripted failure", type: "synthetic" } }));
    return;
  }
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  if (turn.type === "tool") {
    sse(res, {
      id: "chatcmpl-rites-fixture",
      object: "chat.completion.chunk",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_rites_fixture",
                type: "function",
                function: { name: turn.name, arguments: JSON.stringify(turn.args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
    sse(res, chunkBody({}, "tool_calls"));
  } else {
    sse(res, chunkBody({ role: "assistant", content: turn.text }, null));
    sse(res, chunkBody({}, turn.finish === undefined ? "stop" : turn.finish));
  }
  sse(res, usageBody());
  res.write("data: [DONE]\n\n");
  res.end();
}

/**
 * Start the scripted provider on 127.0.0.1 with an ephemeral port. Each
 * request consumes the next script turn; after the script is exhausted the
 * final turn repeats.
 *
 * @param {ReadonlyArray<Record<string, unknown>>} script
 */
export async function startScriptedProvider(script) {
  if (script.length === 0) {
    throw new Error("scripted provider requires at least one turn");
  }
  const requests = [];
  let index = 0;
  let server;
  const started = new Promise(resolve => {
    server = createServer((req, res) => {
      const chunks = [];
      req.on("data", chunk => {
        chunks.push(chunk);
      });
      req.on("end", () => {
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          body = undefined;
        }
        requests.push({ url: req.url === undefined ? "" : req.url, authorization: req.headers.authorization, body });
        const turn = script[Math.min(index, script.length - 1)];
        index = Math.min(index + 1, script.length - 1);
        respondWithTurn(res, turn);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve(undefined);
    });
  });
  await started;
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/v1`;
  return {
    url,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close(error => {
          if (error === undefined) {
            resolve(undefined);
          } else {
            reject(error);
          }
        });
      }),
  };
}
