"""Provider-free OpenAI-compatible chat-completions endpoint for packaged Pi tests.

Echo protocol: a user message "SPAWN <json>" makes the model call bg_task with
the flat <json> arguments; a "[bg-task]" completion notice gets "ack notice"; a tool
result gets "spawned"; anything else gets "ok". Every request is appended to
the JSONL log given as argv[2]. The chosen port is printed on stdout.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = sys.argv[2]


def text_of(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return ""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        messages = body.get("messages", [])
        last = messages[-1] if messages else {}
        with open(LOG, "a") as f:
            f.write(json.dumps({"tools": [t["function"]["name"] for t in body.get("tools", [])],
                                "roles": [m.get("role") for m in messages], "last": text_of(last)[:2000]}) + "\n")
        if last.get("role") == "user" and text_of(last).startswith("SPAWN "):
            request = json.loads(text_of(last)[len("SPAWN "):])
            delta = {"role": "assistant", "tool_calls": [{"index": 0, "id": f"call_{len(messages)}", "type": "function",
                                                          "function": {"name": "bg_task", "arguments": json.dumps(request)}}]}
            finish = "tool_calls"
        else:
            if last.get("role") == "tool":
                reply = "spawned"
            elif "[bg-task]" in text_of(last):
                reply = "ack notice"
            else:
                reply = "ok"
            delta = {"role": "assistant", "content": reply}
            finish = "stop"
        chunks = [
            {"id": "c", "object": "chat.completion.chunk", "model": "scripted", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
            {"id": "c", "object": "chat.completion.chunk", "model": "scripted", "choices": [{"index": 0, "delta": {}, "finish_reason": finish}]},
            {"id": "c", "object": "chat.completion.chunk", "model": "scripted", "choices": [],
             "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}},
        ]
        payload = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
        data = payload.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


server = ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), Handler)
print(server.server_address[1], flush=True)
server.serve_forever()
