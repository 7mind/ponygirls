## Worktree workflow

For changes in a Git repository, always work in a dedicated Git worktree,
not the main checkout. Before editing, locate the main checkout and create
its `.worktrees/` directory. Ensure `/.worktrees/` is ignored in that
repository (prefer its shared Git `info/exclude` to avoid an unrelated
tracked change), and verify with `git check-ignore` before adding a
uniquely named task branch and worktree under `.worktrees/`.
If already in a dedicated task worktree, reuse it; give concurrent writers
separate worktrees. Read-only inspection does not require a new worktree.
Outside a Git repository, do not initialize one solely for this policy.

Preserve existing staged, unstaged, and untracked changes in every checkout;
never reset, clean, stash, or commit unrelated work. A new worktree starts
from a commit and does not contain the main checkout's uncommitted changes.
If the task depends on those changes, ask how to incorporate them rather
than silently omitting or copying them.

After completing and verifying the feature, commit only the task changes
according to the commit policy and merge the task branch back into the
original main checkout. Check its current branch and working tree first;
do not switch its branch, overwrite user changes, or resolve ambiguous
conflicts without asking. If commits are forbidden or integration cannot
be performed safely, leave the worktree intact and report what remains.
Verify the integrated result, then remove only the task worktree once all
its changes are preserved. Do not push unless explicitly requested.
