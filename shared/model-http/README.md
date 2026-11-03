# Bounded model HTTP

`ponygirls.retrieval.EmbeddingEndpoint(operationUrl,model,revision,dimensions,sendDimensions,documentPrefix,queryPrefix,normalization,credentialFile,deadline,maxResponseBytes,maxBatch,maxInputBytes,maxRequestBytes)`.

`EmbeddingClient.resource(config,maxConcurrent,maxQueued,telemetry)` or
`EmbeddingClient.make(http4sClient,config,maxConcurrent,maxQueued,telemetry)`.
`documents(List[String]): IO[List[List[Double]]]`, `query(String): IO[List[Double]]`.

No endpoint means construct no client and declare lexical-only; no automatic model fallback. Credentials come only from the explicit absolute file, read at call time; no environment lookup. Trusted operator references may be managed symlinks (e.g. agenix): resolve each time, require a regular resolved leaf and open NOFOLLOW. Actual bytes are bounded to 16385 with strict UTF8 decoding, not a metadata-size precheck. Empty regular files deliberately mean no Authorization. Containing/resolved directories and operators must not race replacement with special files; this is not the untrusted payload-path confinement boundary. Queue+running admission, cancellation and whole-call deadlines are bounded. `EmbeddingTelemetry` receives only purpose/outcome, never text/URLs/credentials. Response indexes/cardinality/order/dimensions/finite nonzero float-representability are validated. No model calls in ordinary source writes.

`JsonHttp` is the reusable bounded transport, also composed with Chronicle's existing request admission and accounting. `EmbeddingCodec` is the common request/response implementation. Neither owns Chronicle annotation prompts.
