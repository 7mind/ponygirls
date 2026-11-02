# Lossless JSON boundary

`ponygirls.losslessjson.LosslessJson` is a dependency-free Scala 3 module.
It parses raw JSON into an immutable, closed, validated `Value` tree. It is
foundation code for a future Haystack port, not a document validator or service.
No API, database, deployment or legacy replay compatibility is implemented.

```scala
import ponygirls.losslessjson.LosslessJson.*
val limits = Limits(1024 * 1024, 64, 4096, 999999)
val result: Either[Error, Value] = parse("{\"n\":9007199254740993}", limits)
val encoded: Either[Error, String] = result.map(encode)
```

## Admitted domain

- All JSON value kinds, including arbitrary root values, empty keys/values,
  prototype-named keys, and arbitrary-size numeric coefficients within bounds.
- Unicode scalar strings/keys except U+0000. No normalization; composed and
  decomposed text remain distinct. Other controls must be JSON-escaped.
- Strict UTF-8 for `parseUtf8`; malformed/overlong sequences, encoded surrogates
  and out-of-range codepoints fail. Java `String` input rejects unpaired UTF-16
  surrogates too. Paired escaped surrogates are decoded normally.
- Strict JSON grammar. Duplicate keys are rejected **after escape decoding**,
  including raw-vs-escaped astral keys. No comments, trailing commas, BOM,
  non-JSON whitespace, NaN or Infinity.
- Original **number tokens** survive, including `-0`, `0.10`, exponent signs,
  letter case and leading exponent zeros. Whitespace, object source order and
  string escape spelling are not part of the lossless representation.

`parse` and `parseUtf8` require explicit `Limits`; there are no implicit/default
arguments or mutable process-wide configuration. `StandardLimits` is an opt-in
immutable value. All four bounds are inclusive:

| Bound | StandardLimits | Permitted configuration |
|---|---:|---:|
| Complete source UTF-8 bytes (whitespace included) | 1048576 | 1..16777216 |
| Nested containers, including empty containers | 64 | 0..128 |
| Number token characters (sign/punctuation/exponent included) | 4096 | 1..65536 |
| Absolute explicit exponent | 999999 | 0..999999 |

A scalar root has depth 0; `[]` has depth 1; `[{}]` has depth 2. Rejection
happens before descending into an over-depth container. Number bounds reject,
never round. Byte checks precede parsing/UTF-8 decode; Java strings are counted
without allocating a UTF-8 copy. Input APIs are bounded in-memory values, not
streaming readers. Callers must also bound transport reads before allocating
an entire body. Invalid limit configuration throws `IllegalArgumentException`;
invalid input returns `Left(Error)`. Error codes are `syntax`, `unicode`,
`duplicate-key`, `byte-limit`, `depth-limit`, `number-limit`, `exponent-limit`.
Offsets are zero-based UTF-16 source positions (0 for whole-input byte/UTF-8
failures). Errors do not interpolate payloads.

## Inspection, encoding and comparison

`Null`, `Bool.value`, `Str.value`, `Arr.values`, `Obj.fields` and `Number.lexeme`
expose typed values. `Obj.fields` retains source order; constructors are private
and there is no unchecked `copy`/factory. Use pattern matching on value types.
Object/array equality is not defined as mathematical/structural equality; compare
encoded text when spelling-sensitive deterministic equality is intended.

`encode` / `encodeUtf8` use scheme **`lossless-json-v1`**:

- Object keys recursively sorted by UTF-16 code-unit lexical order; no special
  integer-property reordering. Array order remains intact.
- Number tokens unchanged; numbers with different spellings encode differently.
- No insignificant whitespace. Quote and backslash escaped; slash literal.
  Controls use `\b`, `\f`, `\n`, `\r`, `\t` or lowercase `\u00xx`; all other
  Unicode scalars (including astral characters) are emitted literally.
- `sha256(value)` returns lowercase hex SHA-256 of UTF-8 bytes
  `lossless-json-v1\n` followed by `encode(value)`. This is a versioned content
  fingerprint, **not** a Haystack operation/replay digest or RFC 8785 JCS.

`Number.compare` provides exact mathematical -1/0/1 comparisons, treating all
zeros (including negative/exponent forms) as equal. It compares significant
digits and decimal positions without `Double`, decimal-context rounding, or
allocating exponent-sized powers/zero strings. Runtime/memory follow token
length rather than exponent magnitude.

## Integration seam and remaining work

Keep arbitrary JSON as validated text across a Baboon `str` boundary, then
parse with explicit service limits. Chronicle already uses opaque string seams
such as `McpToolDefinition.inputSchemaJson` and trace JSON parts; this module
neither changes nor adopts its existing Circe codecs. Parsing with Circe first
would already discard duplicate keys and potentially source-token fidelity.
There is deliberately no automatic `io.circe.Json` conversion or generated codec.

This domain is **not** a promise that PostgreSQL JSONB supports every admitted
number (e.g. `1e999999`). A future storage adapter must define and validate its
projection representation rather than round/narrow authoritative text. Haystack
shape/leaf limits, query/pointer semantics, storage, service operation envelopes,
Baboon integration, and native runtime acceptance remain separate work.

## Tests

MUnit 1.3.6, Scala 3.9.0. Tests are specified-origin Behavioral-Active /
Blackbox-Atomic: only public boundary behavior, no mocks/external systems. The
dual-tests adapter pattern is not applicable until a real external adapter is
introduced. Root build command after integration: `sbt losslessJson/test` in the
pinned Chronicle shell. This module has no production dependencies beyond JDK.
