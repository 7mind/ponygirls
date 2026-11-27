# Patches of the cross-service run

The six changes that the cross-service run of 27 Nov 2026 confirmed by spike
(design note, section 13). Each is the staged diff of one spike against base
commit `bb9e490a48f88c87a65e1f8773e1bafb02eca581`, as taken from the spiker's
work tree. They were tested on the JVM suites only, on a heavily loaded host.

| File | Change | Net production effect |
|---|---|---|
| `1-duplication_xsvc_1.patch` | Secret primitives of the three servers delegate to the shared `Secrets` | 10 lines, 264 tokens |
| `2-duplication_xsvc_2.patch` | The start-stage wrapper of the three `Main` files moves to shared service-runtime | 6 lines, 211 tokens |
| `3-reinvention_xsvc_4.patch` | Chronicle's `StaticTokens` reads through the shared bounded secret-file reader | 2 lines, 49 tokens |
| `4-under-generalization_xsvc_2.patch` | Signup and enrollment value types with their defaults, shared | 3 lines, 48 tokens (tests 18 tokens more) |
| `5-reinvention_xsvc_5.patch` | Static-root containment check of chronicle and haystack, shared | 1 line more, 28 tokens fewer |
| `6-under-generalization_xsvc_1.patch` | Five part-upload routes of chronicle's `Http` through one typed helper | 7 lines, 17 tokens |

Decision Q223: apply 1 to 4, one commit each, with `scripts/verify all`. The
haystack and manure parts of patch 1 were already on main when it was
decided (Q203), so only its chronicle part remained. Patch 4 was dropped
afterwards (Q225): another session's account refactor reached main first and
owns that code. Patches 4, 5 and 6 are kept as a record and are not applied.
