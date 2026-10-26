# Model transport deadline regression

## Pinned source

http4s Ember 0.23.38 distinguishes header receive timeout (`withTimeout`) from
active connection idle timeout (`withIdleConnectionTime`, reset on each read/write).
The latter defaults independently to 60 seconds:

- [EmberClientBuilder.scala](https://github.com/http4s/http4s/blob/v0.23.38/ember-client/shared/src/main/scala/org/http4s/ember/client/EmberClientBuilder.scala), methods and Defaults
- [Defaults.scala](https://github.com/http4s/http4s/blob/v0.23.38/ember-core/shared/src/main/scala/org/http4s/ember/core/Defaults.scala), `IdleTimeout`

The production builder is now shared through `ModelHttp.client(config)`. Both
transport limits use the finite maximum annotation/embedding configured deadline;
`ModelHttp.post` still applies each endpoint's own whole-request timeout, including
body consumption. No request policy, inference identity, public protocol, retry,
streaming mode or fallback changed.

## Fail-first evidence (2026-10-26)

First extract the previous inline production builder unchanged (header timeout
only). `ModelTransportTest` uses that factory, real loopback TCP and an Ember server
with an explicit 120-second idle timeout. Annotation timeout is 100 seconds and
embedding timeout is 1 second. No fake HTTP client or injected idle setting is used.

Command, from `chronicle/` with the pinned sbt launcher:

```bash
./scripts/sbt.sh 'testOnly chronicle.ModelTransportTest'
```

Before adding the idle setting, both a 65-second header delay and a 65-second gap
between response body chunks failed with the same exception/origin:

```text
java.util.concurrent.TimeoutException: 60 seconds
  at timeout @ org.http4s.ember.core.Util$.timeoutMaybe(Util.scala:106)
Failed: Total 4, Failed 2, Errors 0, Passed 2
```

The other two tests already passed: a shorter embedding deadline returns
`model-timeout`, and whole-request timeout bounds a continuously progressing body.
These tests deliberately exercise real transport semantics; in-process request
serialization tests cannot detect a socket-idle default.

## After correction

Adding `withIdleConnectionTime(transportTimeout(config))` made all four transport
tests pass unchanged. Full isolated PostgreSQL suite:

```bash
POSTGRES_HOME=/path/to/pinned-postgresql-with-pgvector ./scripts/test-postgres.sh
./scripts/sbt.sh assembly
```

Observed: 120 tests passed, zero failed/ignored (312 seconds); assembly passed.
The two long-delay checks take about 140 seconds together. The test suite timeout
is explicitly 180 seconds per test. No production DB, model endpoint, credentials,
GPU runtime or deployed service was accessed for this verification. Native build
and deployed-service behavior require separate verification.
