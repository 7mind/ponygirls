# Optional explicit profile, no ambient credentials/models or automatic failover.
{ lib, extraOptions ? { } }:
let inherit (lib) mkOption types;
in mkOption {
  default = null;
  type = types.nullOr (types.submodule { options = {
    operationUrl = mkOption { type = types.str; description = "Full embedding operation URL, including /v1/embeddings if required."; };
    model = mkOption { type = types.str; };
    revision = mkOption { type = types.str; description = "Operator-pinned immutable revision; changes require explicit rebuild/cutover."; };
    dimensions = mkOption { type = types.ints.between 1 4000; };
    sendDimensions = mkOption { type = types.bool; };
    documentPrefix = mkOption { type = types.str; };
    queryPrefix = mkOption { type = types.str; };
    normalization = mkOption { type = types.enum [ "cosine" ]; };
    credentialFile = mkOption { type = types.str; description = "Explicit runtime file. Empty regular file means no Authorization; absent/unreadable is an error."; };
    deadlineMs = mkOption { type = types.ints.between 1 3600000; };
    maxResponseBytes = mkOption { type = types.ints.positive; };
    maxBatch = mkOption { type = types.ints.positive; };
    maxInputBytes = mkOption { type = types.ints.positive; };
    maxRequestBytes = mkOption { type = types.ints.positive; };
  } // extraOptions; });
}
