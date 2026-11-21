# Repair cases — operator only

These are three historical **functional** bugs, not generated error rows or claims about upstream CI runs. `prepare` executes a local CI-style test shard against each broken parent. A second historical read contains actual code from a different file in that parent. The experiment controls the conversation around these observations; it does not replay an upstream agent trajectory. The grades cover the specified behaviors, not maintainability or the entire upstream projects.

## Reproduce offline

Requirements: Linux with working unprivileged bubblewrap user, PID and network namespaces, `bwrap`, `nix-store`, and a Nix CPython installation with its local runtime closure. No `pip`, pytest installation, model credentials, upstream worktree, package build, or network needed. The frozen log formatting used x86_64-linux CPython 3.14.10 (`bya4ansy58az5133kryqp2cvrxbnz8qy-python3-3.14.10`), bubblewrap 0.13.1. If unavailable, the tool does **not** execute code on the host. An incompatible interpreter/report format cannot silently replace the frozen fixture.

From the repo root, with `CACHE` naming the archive directory and `NEW_DIR` not yet existing:

```sh
D=scripts/experiments/log-preview-repair
python3 "$D/cases.py" prepare "$CACHE" "$NEW_DIR"
sha256sum "$NEW_DIR/cases.json"
# 7169a0b0b9e73f34d51897212d2733dcb7f56fc700a0e1e3689abb1a03afe668

# Grade a saved answer. No dependency on a previous run's writable checkout.
python3 "$D/cases.py" grade "$CACHE" case-a "$ANSWER_FILE"
```

The one-line JSON grade receipt has `caseId`, `outcome` (`pass`, `fail`, `invalid`, `unknown`) and a short `reason`. Inspect it, not the exit code: all four grade outcomes are data. `prepare` exits nonzero on error. A missing/unreadable answer or reference, isolation failure, missing completion receipt or resource exhaustion is **not** a wrong answer. A definite failure in one verified phase remains a non-solve even if another phase is incomplete; `incompletePhases` identifies that distinction. Counts are methods/parameter rows, not individual assertions; unittest reports a separate error for each failing subtest. On complete runs grades include the SHA-256 of the resulting target bytes.

`ANSWER_FILE` must be a regular UTF-8 JSON file (maximum **64 KiB on disk**, independent of the per-string limit). The only schema is `{"edits":[{"old":"…","new":"…"}]}`. 1–8 sequential replacements on the single fixed target, each `old` nonblank, matching exactly once in the then-current text, each UTF-8 string ≤4096 bytes, no NUL, no duplicate/extra keys, no no-op edit or net no-op. There is no shell, Markdown extraction, eval of a submitted command, caller-selected destination, or test-file edit. Keep saved answers local. Verify each diff is an actual functional repair before counting a solve.

## Provenance and staging

[`archives.json`](archives.json) is the six-object allowlist: public GitHub repository, full commit, codeload URL, compressed byte count and SHA-256. Original commit metadata (GitHub REST `GET /repos/{repo}/commits/{fixed}`; first parent) and archive bytes were observed **2026-11-21 11:47:28 UTC**. To provision a cache manually, download each exact listed URL **as binary**, save to `CACHE/<id>-<kind>.tgz`, and check its byte count and SHA-256 against the manifest. For example, with values copied from a manifest row: `curl --fail --location --output "$CACHE/$id-$kind.tgz" "$url"`; `sha256sum "$CACHE/$id-$kind.tgz"`. The tool never downloads anything. Do not reuse a tag, loosely unpacked local checkout, or trust the cache's own digest list. Do not commit the archives, prep dir, or saved answers.

| ID | Repository: broken parent → fix | Allowed target | Second read (contiguous, 1-based, inclusive) |
|---|---|---|---|
| case-a | pytoolz/toolz: `55ce42dc` → `d2eba0374` | `toolz/itertoolz.py` | `toolz/functoolz.py`, lines 1–650 |
| case-b | more-itertools/more-itertools: `08dca284` → `c62921476` | `more_itertools/more.py` | `more_itertools/recipes.py`, lines 1–550 |
| case-c | python-semver/python-semver: `f3c71381` → `9f6894daa` | `src/semver/version.py` | `src/semver/_deprecated.py`, whole file (411 lines) |

Only after verifying each complete compressed archive in memory does the tool read selected regular members. It stages production `.py` files from the one package, the upstream license, and only selected test modules; there is no tar extraction into a worktree. `grade` needs *only* its case's two archives (the fixed archive provides public tests, **not fixed code**). Preserve the upstream notices (toolz BSD, more-itertools MIT, python-semver BSD); `prepare` writes their verbatim license files under `NEW_DIR/operator/`.

## Test evidence and delivery boundary

* `case-a`: all functions in upstream `toolz/tests/test_itertoolz.py`, unmodified, including `test_interpose_empty`; a stdlib unittest adapter invokes the pytest-style functions. Parent 50/51 pass, one `StopIteration` error. Four independent streaming/edge methods: 3/4 pass on parent.
* `case-b`: three complete adjacent upstream unittest classes from `tests/test_more.py` (`GroupByTransformTests`, `NumericRangeTests`, `CountCycleTests`); the equality and hashing regressions use the actual upstream subtests. Parent 30/32 pass; two methods with nine `OverflowError` subtest errors. Four independent edge methods: 1/4 passes on parent.
* `case-c`: complete upstream `tests/test_format.py` and `tests/test_index.py`, unmodified. The controlled stdlib adapter expands `pytest.mark.parametrize` in the original row order and maps `pytest.raises(E, match=...)` to unittest's exception contexts. It does not emulate the general pytest framework. Parent 58/62 pass with four `AttributeError`s. Four independent edge methods: 1/4 passes on parent.

For every case `prepare` captures and stores the full real parent shard output **before** running the additional edge checks or loading fixed code. It recognizes the specific intended RED method(s), exception type(s) and counts; an import/syntax crash is not a reproduced regression. With exactly those tests, the whole fixed reference must be green; changing **only** the target via the same `grade` + answer-file path on a fresh parent must also pass (55/55, 36/36, 66/66) and produce the same target digest. It then re-runs the pristine parent to verify RED again and require the same normalized log. This does not compare patch style/text when grading model answers.

`NEW_DIR/cases.json` is the only runner input: an array with exactly `id`, `targetPath`, `task`, `logText`, `nonLogText`, `sourceText`. Only the pre-repair source is present; expose `sourceText` through the runner's bounded source reader, not as a bulk message. `logText` is the entire verbose unittest output of the selected public shard, not a filtered excerpt of its failures: no added summary, offsets or diagnosis. Normalization only removes terminal styling and sandbox/interpreter path prefixes and replaces elapsed time with `<elapsed>`. The operator directory contains literal reports, hashes, notices and control receipts. **Never provide** that directory, the cache, this document, the tests/evaluator, or gold references to a model.

## Isolation and interpretation

Every import of upstream code (including trusted controls) runs in a fresh `bwrap --unshare-all --clearenv --new-session --die-with-parent` sandbox, with mandatory user/PID/network isolation, further user namespaces disabled, no capabilities, nonroot uid, no `/proc`, empty home, no real checkout, and only the plain interpreter's queried Nix closure (not the whole store). The package, tests, driver and root are read-only; `/tmp` is a fresh size-limited 2 MiB tmpfs. The evaluator directory is not on the application's import path. The edge module is mounted **only** in its own phase. The stdlib-only pytest bridge is available only during the semver public shard, not as a production dependency.

Limits are hard ceilings (stricter inherited limits remain): 6 CPU seconds, 384 MiB address space, 512 KiB per regular file, 64 fds, no cores, no further processes/threads once the driver starts, 12 s outer wall timeout and 192 KiB combined output cap checked **while reading**. Every phase gets a new staged tree and sandbox. Host code parses strings/counts/digests, never imports a patched module or executes a model command; stdout from model code is never returned as a grade receipt. Missing isolation or incomplete accounting cannot pass. The grader checks both the test runner's exit status and complete method/subtest accounting with the expected nonzero counts, no skips, errors, failures or expected failures for a pass. Like other in-process Python test runners this is **not** a proof against cheating/tampering by the tested interpreter; human diff inspection for disabling tests, harness dependencies or other non-solutions is necessary.
