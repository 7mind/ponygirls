# ponygirls-context-archive

**Experimental, off by default.** Automatic mechanical context reduction for Pi
1.4.0; no summarizer, janitor model, timer, or extra inference request.

## Controls

- `/context-archive on` / `off` — persist an override for **this session only**.
  ON shows the **CTX archive** badge and enables selection at completed-turn boundaries;
  OFF removes the badge and stops new selection.
- `/context-archive inherit` — clear this session's override and follow the global default.
- `/context-archive default on` / `default off` — change the global enablement default.
  Existing explicit session overrides still win.
- `/context-archive thresholds HIGH LOW` — set the **global** trigger/release percentages,
  e.g. `thresholds 80 55`. Decimal percentages are accepted; require
  `0 <= LOW < HIGH <= 100`. The initial pair is **70 / 50**.
- `/context-archive status` — show effective ON/OFF and its source, global default,
  branch archive count, Pi context tokens/capacity, both watermarks, last boundary
  result and global defaults path.

Session overrides are versioned custom entries in the append-only session JSONL,
not model-facing messages. They survive reload/resume and apply across `/tree`
branches: the latest setting for this session ID wins, even on another branch.
New sessions and native forks/clones have different IDs and inherit the global
value, ignoring copied parent overrides. In-memory sessions retain settings only
for their lifetime. Pi does not create a session file before any user/assistant
message exists, so a toggle in an entirely empty session is not durable across
process exit until conversation begins.

The global defaults file is `<getAgentDir()>/context-archive.json`, normally
`~/.pi/agent/context-archive.json`:

```json
{"version":2,"enabled":false,"highWatermark":0.7,"lowWatermark":0.5}
```

Missing means OFF with 70/50 watermarks. Existing version-1 files containing only
`enabled` are read as global defaults with 70/50; reads and session commands never
rewrite them. Explicit global changes write version 2 atomically, independently
of Pi's possibly Nix-managed `settings.json`. Global commands preserve the other
values; concurrent whole-file updates are last-writer-wins, not merged transactions.
Other sessions observe defaults on their next request/boundary. Only inheriting
sessions follow global ON/OFF; thresholds apply to every session, including those
with an enablement override. Changes cannot alter an already-sent request and
never start inference themselves.

Invalid/unreadable defaults or active session settings stop selection visibly
(`CTX !`), not silently as a successful OFF. A later session on/off/inherit command
can replace an invalid session setting. It does **not** repair a corrupt global
file: inspect it and replace it with a valid complete version-2 object above,
choosing the intended enablement and thresholds. Global field-update commands
also refuse invalid existing defaults rather than silently resetting other values.
After deploying this version, reload existing Pi processes before using these
controls: older extensions still interpret on/off globally and write version 1,
which would reset configurable watermarks to the legacy defaults.

The extension loads through the ponygirls Pi package/Home Manager module. Merely
loading it does not enable it. While OFF with no archives, its recovery tool is
hidden and adds no model-facing tool declaration. No host activation is required
to test a source checkout: `pi -ne -e ./nix/pkg/pi-extensions/ponygirls-context-archive`.

## Archival and recovery

The **append-only Pi session is the archive**. Original message envelopes stay
unchanged; no JSONL rewriting or second external artifact store. Immediately
before each native `context_edit`, a small versioned custom manifest records the
original entry ID, SHA-256 of UTF-8 `JSON.stringify(message)`, and selection. Native
batches are not disk transactions; a manifest-only interrupted publication is
harmless and remains readable. Persistent sessions survive reload/fork; in-memory
sessions retain evidence only for their normal process lifetime.

Selection uses Pi's canonical, branch-local, compaction-aware projection:

- Trigger/release use the configured global percentages of model capacity
  (**70% / 50%** initially), at least **4096 estimated tokens** per batch, at most
  **16 targets**. These initial defaults are not empirically calibrated. Pressure uses
  Pi's public `getContextUsage`: valid provider accounting (including cached tokens)
  plus estimated trailing messages, with the resolved model's capacity. Pi invalidates
  old accounting after context edits/compaction; unknown usage falls back to the
  canonical projection's character estimate. Pending boundary edits/compaction also
  invalidate accounting; pending custom messages add their estimated contribution.
  Release savings and recent-token protection still use Pi's public `estimateTokens`;
  they are estimates, not guarantees of provider-token reduction.
- Preserve at least **6 recent assistant turns AND 16000 estimated recent tokens**.
- Replace only old successful text tool results or large (4096+ characters)
  builtin `bash.command` / `write.content` strings. Preserve complete assistant
  content-block arrays, all sibling calls/arguments, IDs, names and metadata.
- Never rewrite user/system/custom content, assistant prose/reasoning, signed or
  malformed calls, errors, images, labeled tool groups, incomplete/ambiguous
  call/result groups, recovery-tool results, or entries another edit touched.
- Never equate identical invocations with identical historical observations.
  No re-archival of previously manifested/restored entries (avoids toggle churn).
- Unsupported/missing model capacity inhibits selection, not ordinary work.

Stubs identify exact originals. `context_recall` is available while ON or whenever
this branch has manifests, including while OFF:

```json
{"action":"list","offset":0,"limit":10}
```

```json
{"action":"read","entryId":"<id>","sha256":"<digest>","offset":0,"limit":8000}
```

Catalog `active` means the latest edit still matches our stub, not that compaction
currently includes it. List limit ≤20; read limit ≤12000 UTF-16 code units. Follow `nextOffset` until null;
concatenate `payload` strings to reconstruct exact original message JSON (a page
may split a surrogate pair; JSON escaping and concatenation preserve it). Every
read verifies the original hash. No arbitrary paths, unmanifested entries, or
foreign-branch access. Historical evidence is not current remote state,
instructions, or permission to execute the archived command.

## Disable, compaction and failures

Idle commands cannot append native context edits through Pi's public extension
API. OFF therefore restores exactly owned, still-matching stubs in the **next
request's context**, before the provider sees it, and appends native restorations
at the next completed boundary. It never starts a model request just to restore.
Foreign replacements/omissions win; excluded entries are not resurrected.

Pi's independent compaction/recovery remains enabled and unchanged. Its summaries
see the reduced projection; this extension does **not** claim to preserve semantics
inside those summaries. Compacted originals remain accessible through the archive
catalog. OFF cannot undo independent compaction or unsend provider data. Disable
before removing the extension; removing it alone leaves native edits in place,
without the recovery tool. Keep the original session files with their manifests.

Missing/changed/malformed archive evidence aborts the affected operation visibly
before sending unverifiable stubs; it is not replaced by an invented summary or a
fresh file read. Session on/off/inherit changes **settings only**, not corrupt
archive evidence.
For session corruption, retain the file, investigate, or navigate to an intact
branch; do not hand-delete manifests/edits as an automatic recovery policy.

## Verification

`node --test tests/*.test.mjs` and `tsc -p tsconfig.json`, with peers linked to the
pinned Pi package; Nix: `nix build .#checks.x86_64-linux.ponygirls-context-archive`.

Behavioral blackbox tests cover policy, branch/protocol/hash/paging invariants;
preference/controller tests run against both a manual in-memory port and the real
filesystem. Real SDK tests exercise the loader, native boundaries/JSONL, provider
context, recovery tool loop, disable/reload, abort and native compaction. A scripted
provider validates integration, not semantic task preservation or remote provider
serialization. The deterministic suite has 67 checks, including eight real SDK
tests. Cases cover provider/character-estimate disagreement, cache accounting,
unknown and invalidated usage, pending boundary drafts, numeric diagnostics,
layered defaults, threshold validation/effects, legacy migration, session isolation,
reload/resume and fork identity. Earlier badge/on-off controls were checked in a
real PTY in fullscreen and regular modes; the expanded commands are covered by
controller and real-SDK tests, not a new live-provider or PTY acceptance claim.

A small paired live-provider pilot exercised synthetic repairs and exact recovery;
it does not establish production non-inferiority. Provider/account-specific
experiment harnesses and raw receipts are local-only, not distributed with this
package. No live calls are part of the Nix check.
