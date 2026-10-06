// Protocol-speaking stand-in for a worker: after the handshake it sends one
// tool request whose arguments exceed the IPC payload cap, then a small one,
// and reports each response it receives on stderr.
interface Binding {
  rootEpoch: string;
  agentId: string;
  workerInstanceId: string;
}
let binding: Binding | null = null;
let seq = 0;
const envelope = (o: Record<string, unknown>): Record<string, unknown> => ({
  protocolVersion: 1,
  rootEpoch: binding!.rootEpoch,
  agentId: binding!.agentId,
  workerInstanceId: binding!.workerInstanceId,
  requestId: null,
  seq: seq++,
  type: "event",
  taskRunId: "t1",
  executionGeneration: 1,
  payload: null,
  ...o,
});
process.on("message", (m: Record<string, unknown>) => {
  if (!binding) {
    binding = m as unknown as Binding;
    process.send!(envelope({ operation: "ready", payload: {} }));
    process.send!(envelope({ type: "request", operation: "tool.execute", requestId: "big", payload: { tool: "write", args: { path: "big.txt", content: "x".repeat(300 * 1024) }, toolCallId: "c1", usage: null } }));
    process.send!(envelope({ type: "request", operation: "tool.execute", requestId: "small", payload: { tool: "write", args: { path: "small.txt", content: "x" }, toolCallId: "c2", usage: null } }));
    return;
  }
  if (m["type"] === "response") process.stderr.write(`response ${String(m["requestId"])} ${JSON.stringify(m["payload"])}\n`);
});
process.on("disconnect", () => process.exit(0));
