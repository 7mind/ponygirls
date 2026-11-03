# Future preservation / cleanup instructions — NOT executed

Parent owns ONLY this probe root `/tmp/cns.x8nktpy8`; f958's four VM temporary
roots are a different scope. Preserve this root until parent decides after final9
and noBuild gates. No archive/content interpretation/deletion was performed here.

Before any future fd-safe removal, parent must verify the reviewed creation
binding: uid1001, mode0700, dev64769, inode1178378; marker
`.owned-chronicle-probe` SHA256
702d723d0b06c912d097b6a5dd138dc8b9afbc56cef8a7da6df368f9fc2bee8c.
This identity was captured BEFORE leaf dispatch, not reconstructed afterward.
Re-read/hash only this known ownership marker at approval time; never use it or
postmaster.pid to grant process ownership or signal guessed PIDs.

Verify the immutable original owned-closure receipt/hash and its recorded
15:41:38.746132Z prospective subreaper/pidfd absence/live[]/kernelchildren[].
That is closure of the supervised descendant scope AT THAT INSTANT, not an
eternal whole-host absence claim. Parent must establish no later reuse/launch/
concurrent writers in this root. If ownership, identity, reuse or absence is
uncertain, STOP and preserve; do not use global PID scans/kills or protected peeks.

Only after explicit parent approval: use an opened `/tmp` directory fd, no-follow
root stat/open and a root fd; compare CURRENT dev/inode/UID/mode and exact marker
hash to the creation binding; ensure the path still names the same opened inode.
Use a symlink-attack-resistant fd-relative recursive removal ONLY of that exact
root name, without following child symlinks. Do not sweep cns.*, VM roots, reports
or worktrees. Record a NEW deletion receipt; preserve original fail-first runtime1,
module FAILED and owned closure as-is. No cleanup command is auto-armed here.
