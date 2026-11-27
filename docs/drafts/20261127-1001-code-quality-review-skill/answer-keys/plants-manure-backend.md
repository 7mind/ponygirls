# Planted smells, held-out run: answer key (not in any repository tree)

Base 031b0c2b (manure/backend unchanged since e44b2924), planted commit
03f3b2a7b8900964802fd3ec2f399ab8fa6da420 on local branch manure-backend-helpers.
Paths under manure/backend/src/. Line numbers at the planted commit. Deltas by measure.py v0.2.

| Id | Kind (intended lens) | Site | Intended intervention | Planted delta |
|---|---|---|---|---|
| P1 | renamed copy of a helper (reinvention or duplication) | main/scala/manure/RootIdentity.scala:12 and 15-16 `RootVolume.fingerprint` | call `SecretCodec.sha256` (Auth.scala:18-19) again and delete the copy | +2 lines, +53 tokens |
| P2 | unused public method (dead-weight) | main/scala/manure/Domain.scala:145 `remainingSeconds` | delete | +1 line, +21 tokens |
| P3 | pass-through class with one user (abstraction-fitness) | main/scala/manure/Catalogue.scala:105-108 `CatalogueReader`; main/scala/manure/Http.scala:34 and 321 | delete the class, call `catalogue.list` directly | +3 lines, +55 tokens |
| P4 | hand-rolled standard-library function (library-underuse) | main/scala/manure/Payloads.scala:155-162 `listsFile`, used at 165 | `a.manifest.exists(...)` | +8 lines, +49 tokens |
| P5 | one validator written three times (under-generalization or duplication) | main/scala/manure/Domain.scala:172-179 `tagText`, `hostnameText`, `projectPathText`, used at 183-185 | one function with the limit as a parameter | +6 lines, +139 tokens |
| P6 | unused helper in test support (dead-weight on the test partition) | test/scala/manure/BackendFixture.scala:83 `memory` | delete | +1 line, +21 tokens (test) |

Total planted: +20 lines, +317 tokens of production code; +1 line, +21 tokens of test code.

Scoring, fixed before the run (same as the first wave):
- found: an admissible record cites the planted site (path, and lines overlapping the planted ones) and proposes the
  intended intervention or an equivalent one.
- flagged otherwise: an admissible record cites the site with another intervention.
- overflow only: the plant is named only in a reader's list of candidates not written up.
- missed: none of the above.
A plant found under another lens than intended counts as found; the lens is reported.
