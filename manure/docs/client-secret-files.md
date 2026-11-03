# Portable client credential-file boundary

`manure.client` readers are shared by the client constructor, CLI and MCP
configuration. External-password files use the token reader too. All configured
pairs are checked for ambiguity before any file validation/read; hardening does
not make a FIFO/missing file hide an ambiguous direct+file configuration.

## Supported references

References are trusted operator-configured paths to **regular files**. Managed
symlink references and symlinked parent directories (including agenix layouts)
remain supported: resolve the reference, inspect the resolved leaf, open that
leaf with no-follow/nonblocking flags and verify its descriptor is the same
regular inode before reading. Directories, pipes/FIFOs, devices, sockets,
dangling references and raced replacement leaves fail closed. There is no
process-substitution/FIFO contract in the existing client docs/tests; do not use
`<(...)` or a no-writer pipe as a credential source.

Reference I/O/type failures produce sanitized `missing-credentials`, without
values or reference paths. Files are never modified. There is no network I/O in
credential resolution.

## Byte limits and codecs

- Token/password: exactly43 canonical ASCII base64url characters, with at most
  one final LF. No CRLF, NUL, whitespace trimming, extra LF, non-ASCII or
  noncanonical padding bits. Maximum valid file size44 bytes; actual unbuffered
  reads consume at most45 bytes, including the one-over probe if a file grows
  after `fstat`. Oversize is an explicit `unauthorized` error, never truncation.
- URL reference: maximum65,536 **raw file bytes**, including surrounding
  whitespace/LF. This is a conservative reference-representation ceiling derived
  from the existing HTTP request-line ceiling mentioned in CONTRACT§7.7 and the
  historical stdlib HTTP server; it is deliberately larger than the current
  service's16,384-byte request-header admission. It is **not** a new4K/8K URL
  grammar limit. UTF-8, NUL rejection, one-LF/whitespace stripping and empty=unset
  semantics are unchanged within this bounded representation domain. Direct URL
  grammar is unchanged. Oversized files explicitly raise `invalid-url` before
  parsing; no oversized prefix is silently accepted. Actual reads consume at
  most65,537 bytes even under file growth.

Metadata size checks can reject oversized files without reading any content.
Descriptor checks and bounded reads remain mandatory even when metadata is
small; a resolved regular leaf can be replaced or grow between checks.

## Regression evidence (component scope)

`tests/test_client_secret_files.py` uses only owned synthetic regular files,
managed symlinks and FIFOs, with network entrypoints forbidden. Every potentially
blocking child has a two-second deadline and explicit kill/reap on timeout; its
environment is constructed afresh, without ambient client/model/PostgreSQL or
provider settings. It covers common readers, constructor, CLI, MCP, exact codecs,
URL over-limit errors, growth after `fstat`, stat/open FIFO substitution and
ambiguity-before-I/O.

Baseline `6f45b67b` ran8 methods and reported18 failures in28.386s with0 errors
and0 skips, including bounded no-writer FIFO reproductions. After hardening, the
same current tests plus credential-preflight/client transport/current codec and
inventory checks passed68 methods with0 failures/errors/skips. Evidence is kept
under the directory referenced by `/tmp/manure-client-secret-files-latest`.
A broader client/CLI-resume/MCP-hardening/markup/harness diagnostic then passed
161 declared methods, again0 failures/errors/skips; Python compilation and
complete inventory validation passed. These focused diagnostics are not full JVM/native/browser/PG release acceptance;
unresolved register gaps remain blocking.
