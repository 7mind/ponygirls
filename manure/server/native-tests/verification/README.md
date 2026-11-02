# Verification receipt index

- **Current harness:** `20261102-harness-instance/` records fresh strict/JNI and
  ASan+UBSan runs of the per-run-instance assertion counter and retained fixture
  diagnostics. Its source digest list identifies the current tested inputs.
- **Historical source-bound receipts:** `20261102-size-truncate/` belongs to
  commit `87f80bedf9ebb61800e19de8d0b9581c8da48256`. Those original logs, command
  receipt and source digest list are retained unchanged. Its harness digest is
  historical and does not describe the current harness. Its production C/Java
  digests are unchanged by the harness-only refinement. Its recorded static
  analysis remains evidence for those identical production C inputs, not a
  newly executed analyzer run.
- **Historical setup-failure transcripts:** `setup-failures.md` preserves the
  earlier unsuccessful setup attempts, clearly distinguished from behavioral
  and sanitizer execution. It is retained unchanged.

These local JNI receipts do not assert independently owned Scala/Nix runtime
acceptance, production activation, or complete recovery/durability behavior.
