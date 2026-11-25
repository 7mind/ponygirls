{ lib }:
let
  flag = default: description: lib.mkOption { type = lib.types.bool; inherit default description; };
  options = {
    defaultEnabled = flag true "Default indexing preference when neither the user nor an administrator has set a choice.";
    allowOptIn = flag false "Allow users to explicitly opt in to indexing, independently of the server default and allowOptOut.";
    allowOptOut = flag false "Allow users to explicitly opt out of indexing, independently of the server default and allowOptIn.";
  };
  # Leave existing generated JSON unchanged when all three flags use their defaults.
  renderFlags = cfg: lib.filterAttrs (key: value: value != options.${key}.default)
    (lib.getAttrs (builtins.attrNames options) cfg);
in
{
  inherit options renderFlags;
  render = cfg:
    let flags = renderFlags cfg;
    in lib.optionalAttrs (flags != { }) { indexing = flags; };
}
