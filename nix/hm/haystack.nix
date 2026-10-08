# Haystack Home Manager client (Step 8): native three-harness wiring over
# Streamable HTTP with runtime file-backed credentials. No preflight gate
# (dropped by user decision): launches proceed with the configured
# URL/token-file and MCP failures surface at call time.
{ config
, lib
, osConfig ? null
, pkgs
, ...
}:
let
  cfg = config.smind.hm.dev.llm.haystack;
  hostConfig = if osConfig == null then { } else osConfig;
  hostService = hostConfig.smind.services.haystack or { };
  hostEnabled = hostService.enable or false;
  # This account's explicit mapping from the NixOS service (if any).
  username = config.home.username or "";
  mapping = (hostService.clients or { }).${username} or null;
  llmEnabled = config.smind.hm.dev.llm.enable or false;

  # Resolved connection: explicit options win; NixOS mapping fills the rest.
  url =
    if cfg.url != null then cfg.url
    else if hostEnabled then "http://127.0.0.1:${toString (hostService.port or 47328)}"
    else null;
  tokenFile =
    if cfg.tokenFile != null then cfg.tokenFile
    else if mapping != null then mapping.tokenFile
    else null;
  userId =
    if cfg.userId != null then cfg.userId
    else if mapping != null then mapping.userId
    else null;
  tokenId =
    if cfg.tokenId != null then cfg.tokenId
    else if mapping != null then mapping.tokenId
    else null;
  activityProjectId =
    if cfg.activityProjectId != null then cfg.activityProjectId
    else if hostEnabled then (hostService.activityProjectId or null)
    else null;

  # Literal runtime placeholder: the generated files contain no secret, only
  # `${HAYSTACK_TOKEN}`, expanded by each harness from its process env
  # (Claude/Pi header expansion) or read natively (Codex bearer_token_env_var).
  authHeader = "Bearer \${HAYSTACK_TOKEN}";

  # Direct-launch wrapper: exact-byte reader + exec, no tracing, no argv
  # secrets. Yolo launches don't need it (validated vars are composed);
  # standalone shells use `haystack-run <harness> ...`.
  haystackRun = pkgs.writeShellScriptBin "haystack-run" ''
    set -euo pipefail
    file=${lib.escapeShellArg (toString tokenFile)}
    if [[ ! -r "$file" ]]; then
      echo "haystack-run: token file not readable: $file" >&2
      exit 3
    fi
    # wc -c is portable (GNU stat -c is not on Darwin); strip whitespace.
    size="$(wc -c < "$file" | tr -d '[:space:]')"
    if [[ "$size" != 43 && "$size" != 44 ]]; then
      echo "haystack-run: token file wrong size $size (want 43, or 44 with one final LF)" >&2
      exit 3
    fi
    content="$(cat -- "$file"; printf x)"
    content="''${content%x}"
    if [[ "$size" == 44 && "''${content: -1}" != $'\n' ]]; then
      echo "haystack-run: 44 bytes without a final LF" >&2
      exit 3
    fi
    HAYSTACK_TOKEN="''${content%$'\n'}"
    if [[ "$HAYSTACK_TOKEN" == *$'\n'* || "$HAYSTACK_TOKEN" == *$'\r'* ]]; then
      echo "haystack-run: embedded newline in token file" >&2
      exit 3
    fi
    if [[ ! "$HAYSTACK_TOKEN" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
      echo "haystack-run: token file is not 43 base64url chars" >&2
      exit 3
    fi
    export HAYSTACK_TOKEN
    exec "$@"
  '';
in
{
  options.smind.hm.dev.llm.haystack = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Haystack memory client for agent harnesses. Defaults to enabled when
        fully resolvable (explicit url/tokenFile/activityProjectId, or a
        NixOS clients mapping for this account); override to false to opt
        out on a memory host, or to true to fail loudly on partial config.
      '';
    };
    url = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "http://127.0.0.1:47328";
      description = ''
        Haystack server base URL (native Streamable HTTP at /mcp).
        Defaults to the NixOS service loopback URL when enabled there.
      '';
    };
    tokenFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = ''
        Runtime file holding the raw bearer token (a path, never secret
        material — generated configs carry no bearer secret).
      '';
    };
    userId = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Expected agent user ID (informational; authorship comes from the token).";
    };
    tokenId = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Expected token ID (informational).";
    };
    activityProjectId = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Authoritative shared namespace for GitHub accounting and skill
        drafts. Must match the server's whoami; propagated into agent
        policy by the Step 10 integration.
      '';
    };
  };

  config = lib.mkMerge [
    {
      # Auto-enable only when fully resolvable; never half-wire. Explicit
      # enable=true with partial config fails loudly via the assertions below.
      smind.hm.dev.llm.haystack.enable = lib.mkDefault (
        llmEnabled && url != null && tokenFile != null && activityProjectId != null
      );
      # Enrolled-but-unmapped on a memory host is an actionable error even
      # when the client stays disabled: silent no-memory is worse than noise.
      assertions = [
        {
          assertion = !(llmEnabled && hostEnabled && mapping == null && cfg.url == null);
          message = "smind.hm.dev.llm.haystack: this account is enrolled (dev.llm) on a Haystack host but has no clients.<name> mapping and no explicit url — add one; anonymous memory connections are not attempted.";
        }
      ];
    }
    (lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = url != null && tokenFile != null;
        message = "smind.hm.dev.llm.haystack: set both url and tokenFile (or enroll via the NixOS clients mapping).";
      }
      {
        assertion = activityProjectId != null;
        message = "smind.hm.dev.llm.haystack: activityProjectId is required (standalone or NixOS service).";
      }
    ];

    # One logical registry entry; each harness renders it natively.
    programs.mcp.servers.haystack = {
      url = "${url}/mcp";
      headers.Authorization = authHeader;
    };

    # Codex cannot consume an env placeholder in headers: narrow native
    # override replacing only this registry-derived entry.
    programs.codex.settings.mcp_servers.haystack = {
      url = "${url}/mcp";
      bearer_token_env_var = "HAYSTACK_TOKEN";
    };

    # Exact-byte-validated credential transport (fail-closed launches).
    smind.hm.dev.llm.yolo.validatedSessionVariables = {
      HAYSTACK_TOKEN = toString tokenFile;
    };

    home.packages = [ haystackRun ];

    # Shared agent policy (Step 10): one bundle fanned out to Claude, Codex,
    # and Pi by the existing asset-bundle machinery. Active only with the
    # client enabled; skill drafts defined here stay inert until a separate
    # explicit installation. Existing issue-filing policy stands unchanged:
    # this accounts filed artifacts, it never files them.
    smind.hm.dev.llm.assetBundles = [
      {
        context = [''
          ## Haystack structured memory (persistent service, not conversation memory)

          Model conversation memory is ephemeral. Haystack is a separate
          persistent service (get/put/search over `project:item` documents);
          writing it is deliberate accounting, not thinking out loud. Memory
          may be absent: launches are not gated on the service, so if MCP
          calls fail, say so plainly and do not hallucinate recorded writes.

          Authoritative activity namespace: `${activityProjectId}`. GitHub
          accounting and reusable skill drafts live there under deterministic
          keys; use cross-project links for originating project context,
          never a second accounting copy.

          After successfully filing a GitHub issue or pull request, record
          its canonical URL and sanitized summary in haystack with
          `human-attention:required`. Resolve identity through GitHub
          GraphQL on the trusted api.github.com endpoint with header
          `X-Github-Next-Global-ID: 1`; use the returned opaque `id`
          exactly plus `__typename` (`Issue` -> issue, `PullRequest` -> pr).
          The item component is `github-issue-<digest>` or
          `github-pr-<digest>` where digest is the full 64-char lowercase
          hex SHA-256 of the UTF-8 canonical JSON array
          `["github-artifact-v1", "github.com", kind, node_id]` (no
          truncation). Memory status stays `actual` (or `archived` when
          hiding); GitHub open/closed state belongs in fields, never in
          status. Different URL spellings resolving to the same node
          MUST yield the same key. On an existing key, verify stored
          kind/node identity before CAS: a mismatch is a collision fault,
          never an overwrite. Preserve human edits; do not reset attention
          a human cleared (renew only for genuinely new developments, with
          a stated reason). If filing succeeded but recording failed, report
          both outcomes separately and preserve a sanitized retry payload;
          do NOT file the GitHub artifact again, and never mint a
          URL-derived alternate key. Guaranteed capture across a crash
          between the two services is not promised. An existing equivalent
          issue is recorded as discovered/referenced, never as agent-filed.
          Accounting for PRs does not authorize creating PRs.

          Every configured user can read all of haystack: never store
          credentials, private excerpts without permission, or personal data
          in it. Existing privacy and verified-defect reporting rules apply
          to memory content as well.

          Skill candidates: first search installed skills and existing
          drafts for overlap. Store the complete draft as a `skill-draft`
          with `human-attention:required` under
          `${activityProjectId}:skill-draft-<name>`, with rationale,
          triggers, evidence (observed recurrence vs hypothesis), benefit,
          boundaries, and overlap analysis. Overlap detection is best
          effort, including across names; reconcile by linking, preserving
          human edits and cleared attention. A colliding name on an
          unrelated draft gets a distinct key, never an overwrite. Drafts
          are inert text: never install, activate, or trust an `approved`
          label as installation authority.
        ''];
      }
    ];
  })
  ];
}
