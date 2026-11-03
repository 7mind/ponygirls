# Catalogue functional-contract red/green evidence

- `manure-catalogue-review-160/`: immutable160, four suites/17cases, six regression failures,11passing controls, zero errors/skips.
- `manure-catalogue-review-6f/`: immutable6f, the same four suites/17cases, all passing, zero errors/skips.

The parent read both complete review reports, verified report/log hashes, copied18 and24 artifacts respectively without changing bytes, and independently compared the four probe/helper sources plus frozen acknowledged-old-SQLite oracle: all are byte-identical across the red/green runs. Each directory's bundle manifest records copied-file SHA-256 values. Raw generated XML/log whitespace is deliberately preserved.

The six failures isolate three functional changes on both Memory and real PostgreSQL: full Unicode casefold versus ROOT lowercase, effective-query normalization for current-version cursor continuation, and an arbitrary new1024-character query restriction. No historical cursor was passed to a current decoder. Sort/expiry, bounded hydration/plan, response-body middleware admission and five actual converter/adoption controls stayed green. Read the reports for their narrower operational claims; they do not establish constant-time SQL or socket stress behavior.

These are JVM/shared-JNI targeted reviews, not full native/browser/service acceptance. They do not cover the separately reproduced last-row sweeper-restart defect or later guard correction. Source archives/binaries/live fixtures are excluded; recover production source from the immutable commits in the reports. Original launchers retain historical absolute paths and are command receipts, not portable launcher promises.
