## Worktree workflow

For changes in a Git repository, always work in a dedicated Git worktree,
not the main checkout. Before editing, locate the main checkout and create
its `.worktrees/` directory. Ensure `/.worktrees/` is ignored in that
repository (prefer its shared Git `info/exclude` to avoid an unrelated
tracked change), and verify with `git check-ignore` before adding a
uniquely named task branch and worktree at
`.worktrees/wt-{reponame}-{problemslug}`. Use the main checkout's directory
name for `{reponame}` and a short, lowercase, hyphen-separated task name for
`{problemslug}`; disambiguate the slug if that path already exists.
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
After merging, verify the integrated result, then remove the task worktree
with `git worktree remove <path>` before declaring the task complete. Confirm
that its directory and `git worktree list` entry are gone. Remove only your
own task worktree, and only once all its changes are preserved; never force
removal of a dirty worktree. If cleanup fails, report the remaining path and
reason rather than silently leaving it behind. Do not push unless explicitly
requested.
