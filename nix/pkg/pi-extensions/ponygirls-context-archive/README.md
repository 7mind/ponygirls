# ponygirls-context-archive

**Experimental, off by default.** Automatic mechanical context reduction for Pi
1.4.0; no summarizer, janitor model, timer, or extra inference request.

## Controls

- `/context-archive on` — persist enablement, show the **CTX archive** editor-border
  badge, and enable automatic selection at completed-turn boundaries.
- `/context-archive off` — persist disablement, remove the badge, stop new selection.
- `/context-archive status` — show policy status, branch archive count, Pi's current
  context token count/capacity, numeric archive trigger, last boundary result and preference path.

The agent-global preference is `<getAgentDir()>/context-archive.json`, normally
`~/.pi/agent/context-archive.json`: `{"version":1,"enabled":false}`. Missing means
OFF. Commands atomically replace this independent writable file, not Pi's possibly
Nix-managed `settings.json`. Other processes observe changes on their next request
or boundary. Invalid/unreadable preferences stop selection visibly (`CTX !`), not
silently as a successful OFF. An explicit on/off command can repair preferences.

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

- Trigger at **70%** of model capacity, release toward **50%**, at least
  **4096 estimated tokens** per batch, at most **16 targets**. These are conservative
  initial policy constants, not empirically calibrated thresholds. Pressure uses
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
fresh file read. On/off repairs **preferences only**, not corrupt session evidence.
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
serialization. The deterministic suite has 47 checks, including six real SDK
tests. Regression cases cover provider/character-estimate disagreement, cache accounting,
unknown and invalidated usage, pending boundary drafts, and numeric diagnostics. Real-PTY controls were also checked in fullscreen and regular modes.

A small paired live-provider pilot exercised synthetic repairs and exact recovery;
it does not establish production non-inferiority. Provider/account-specific
experiment harnesses and raw receipts are local-only, not distributed with this
package. No live calls are part of the Nix check.
