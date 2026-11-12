# Ontology Pi sidecar

An explicitly enabled Pi extension that captures newly finalized transcript text, waits for bounded ontology coverage, and adds a qualified, request-local capsule. It does not authenticate transcript authors as Humans, attest tool execution, or grant execution permission.

## Load explicitly

Build `nix build .#ontology-worker`. The package root is `result/share/ontology/worker`:

```bash
pi -e /absolute/ontology-worker-output/share/ontology/worker --ontology-config /absolute/worker.json
```

No settings or active Pi installation are changed by building the package. The combined `ontology` package exposes the standalone extension through its `worker` passthru. The installed extension contains compiled code, generated codecs and its own runtime dependencies; it borrows Pi's host APIs rather than bundling another Pi runtime.

For source development, use the pinned backend shell, provision `npm ci --ignore-scripts --legacy-peer-deps`, and supply an explicit installed SDK root:

```bash
ONTOLOGY_PI_SDK_ROOT=/absolute/pi/lib/node_modules/pi-monorepo npm test
```

The local package manifest points to compiled `.cache/worker/src/extension.js`; compile before loading it. Controlled SDK tests have exercised Pi 1.5.0 and 1.5.2. Test commands never use a configured personal model: the SDK fixtures use isolated settings, synthetic credentials and owned loopback providers.

## Explicit configuration

All fields are required. This is an illustrative configuration, not production sizing or credentials:

```json
{
  "version": 1,
  "captureAuthorization": "current-session-from-attachment",
  "http": {
    "origin": "https://ontology.example",
    "deadlineMs": 5000,
    "maxRequestBytes": 1048576,
    "maxResponseBytes": 1048576
  },
  "coordinator": {
    "scope": "example",
    "workContext": "example-work",
    "workerActorId": "example-worker",
    "collectorActorId": "example-collector",
    "collectorNamespace": "example-collector-credential",
    "boundaryDeadlineMs": 15000,
    "pollEveryMs": 100,
    "maxNewEntries": 100,
    "maxTrackedEntries": 10000,
    "maxCaptureTextBytes": 65536,
    "maxCapsuleBytes": 1048576
  },
  "workerTokenFile": "/run/credentials/ontology-worker.token",
  "collectorTokenFile": "/run/credentials/ontology-collector.token"
}
```

The service must explicitly grant the selected scope. The worker identity must be an Agent with Read; the collector must be a Collector with Capture. The source namespace is the collector **credential ID**, not its actor ID. Semantic `workContext` must be configured on the service. Credentials are independently checked; failure never substitutes one identity for the other. Keep token files private. Reads are bounded and reject nonregular files; token encoding is base64url text with at most one trailing newline.

This extension does not automatically expose mutation tools. The service's `/mcp` endpoint supplies `graph_find`, `graph_read` and `graph_apply` separately, under an explicitly configured Agent credential and its actual capabilities. Collector configuration is not permission to mutate the graph or issue Human judgments.

## Capture and lifecycle contract

- Loading the flag is explicit authorization to send eligible **new entries in this attached session** to the configured service. Text selection is not secret detection: do not enable it for a session whose text is not authorized for that service and its configured curator.
- The current native branch at attachment is the exclusion boundary. Resume, fork, reload and tree reattachment do not silently backfill old/copied history or scan session directories.
- Finalized native user, assistant and tool-result entries are eligible. Text block order and reported assistant stop reason/tool error state are retained. System instructions, thinking, signatures, images, tool-call arguments, arbitrary tool details, summaries, custom messages and sidecar bookkeeping are excluded and omissions are explicit.
- A user-role message remains an unauthenticated contributor report. Generic captures use `Observation.None`; tool text never becomes a Service/HostCapture observation. The service supports separately authorized host-observation producers, but this sidecar integrates no privileged file/execution observer. A HostCapture token in the same worker process would not create an independent trust boundary.
- The per-request barrier reads finalized `SessionManager` entries, not streaming `message_end` callbacks. Two consecutive `context_with_system` handlers preserve the ordinary system/tool patches and observe the exact owned capsule slot.
- Delivery receipts report an **ExtensionContext observation**. Their whole-boundary JSON digest is not raw conversation upload, provider-wire attestation, model use, physical Human exposure or execution authority. Later handlers, aborts or provider conversion can still change the final request.
- Exposure metadata is associated with actual assistant/tool-result entry IDs from that request; unrelated incoming user messages do not inherit the previous receipt.
- Service failure, capacity exhaustion, stale context or timeout returns ordinary context without a cached capsule. A sanitized status is shown in UI modes or written to stderr in headless modes.

Exact uncertain requests are retained and retried only while the attachment remains alive. There is **no durable client operation journal**. Shutdown, reload, branch reattachment or process loss makes previous pending replay unavailable; the service may nevertheless have committed those requests. No replacement identity is reconstructed from historical text. This limit is disclosed on attachment. Abort and timeout bound local waiting/admission, not remote rollback or physical revocation.

Capsule baselines advance only after a matching, current boundary observation. The server's bounded baseline ancestry can eventually reject further preparation; the extension degrades visibly rather than silently resetting history. A deliberate fresh attachment starts a new reported epoch and no baseline.

## Evidence

The worker tests include pure correspondence controls, paired dummy/loopback transport checks, and isolated real Pi SDK sessions. `PackagedWorkerAcceptance` additionally exercises the installed extension and JVM server with owned PostgreSQL, Native RDF and controlled models, comparing finalized native entries, durable Sources, per-request exposure links and retained capsules. These are engineering acceptance checks, not semantic-quality or Human-study results.
