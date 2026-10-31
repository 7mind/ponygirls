# Pure constructor for the declarative subagents-policy.json content.
#
# nix/hm/pi.nix renders the result with pkgs.formats.json; the
# `subagents-policy-shape` flake check asserts it stays complete against
# every field the extension's loadPolicy reads (maxDepth, nesting, repos,
# allowedModels, allowedTools, worktreeRoot, gateBypassAllowed,
# gateMaxRoundsCeiling, workspaceRoots, workspaceOwnerCheckoutAllowed,
# maxRunnable, maxResidentWorkers, maxOpenAgents), so a
# managed file can never half-clobber a hand-maintained partial one.
# Defaults here mirror the extension's deny-by-default policy.
{ allowAllModels
, allowedModels
, allowedTools
, worktreeRoot
, maxDepth
, nesting
, repos
, gateBypassAllowed
, gateMaxRoundsCeiling
, workspaceRoots
, workspaceOwnerCheckoutAllowed
, maxRunnable
, maxResidentWorkers
, maxOpenAgents
}:
{
  maxDepth = maxDepth;
  nesting = nesting;
  repos = map
    (r: {
      repoId = r.repoId;
      checkoutPath = r.checkoutPath;
      # The extension defaults absent readRoots to [checkoutPath]; an
      # explicit empty list means literally no roots there, so only the
      # hm-level empty default is rewritten.
      readRoots = if r.readRoots == [ ] then [ r.checkoutPath ] else r.readRoots;
      allowWriters = r.allowWriters;
    })
    repos;
  allowedModels =
    if allowAllModels then
      null
    else
      map (m: { provider = m.provider; id = m.id; }) allowedModels;
  allowedTools = allowedTools;
  worktreeRoot = worktreeRoot;
  gateBypassAllowed = gateBypassAllowed;
  gateMaxRoundsCeiling = gateMaxRoundsCeiling;
  workspaceRoots = workspaceRoots;
  workspaceOwnerCheckoutAllowed = workspaceOwnerCheckoutAllowed;
  maxRunnable = maxRunnable;
  maxResidentWorkers = maxResidentWorkers;
  maxOpenAgents = maxOpenAgents;
}
