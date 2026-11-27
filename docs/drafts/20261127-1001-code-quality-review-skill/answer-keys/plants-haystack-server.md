# Planted smells: answer key (not in any repository tree)

Base c5643c26, planted commit 04aa8cceee04c7bfee90036922793e6c0f21e003 on local
branch haystack-server-helpers. Paths under haystack/server/src/main/scala/haystack/.
Line numbers at the planted commit. Token and line deltas by measure.py v0.2
(default exclusions), planted minus base.

| Id | Kind (intended lens) | Site | Intended intervention | Planted delta |
|---|---|---|---|---|
| P1 | renamed copy of a helper (duplication or reinvention) | query/Parser.scala:130-134 `termPattern`, `termsOf`, its use in `text` | call `Text.extractWords` again and delete the copy | +3 lines, +71 tokens |
| P2 | unused public method (dead-weight) | domain/QualifiedId.scala:75-77 `decodeKeyOption` | delete | +2 lines, +31 tokens |
| P3 | pass-through class with one user (abstraction-fitness) | application/ItemService.scala:31-38 `ItemGateway`; http/Mcp.scala:14, 76, 83, 89 | delete the class, call `service` directly | +7 lines, +113 tokens |
| P4 | hand-rolled standard-library function (library-underuse) | query/Text.scala:30-40 `joinWords` | `mkString(" ")` | +10 lines, +62 tokens |
| P5 | one query written three times (under-generalization or duplication) | storage/PostgresItemRepository.scala:61-72 `typeValues`, `statusValues`, `importanceValues`, `values` | one parametrized query | +5 lines, +146 tokens |

Total planted: +27 lines, +423 tokens in haystack/server production code.

Scoring, fixed before the run:
- found: an admissible record of the arm cites the planted site (path, and a line range overlapping the planted
  lines) and proposes the intended intervention or an equivalent one.
- flagged otherwise: an admissible record cites the site with another intervention.
- overflow only: the plant is named in a reader's list of candidates not written up.
- missed: none of the above.
A plant found under a lens other than the intended one still counts as found; the lens is reported.
