# llm-contexts — the global context fragments (CLAUDE.md / AGENTS.md memory and
# the Pi operating manual). Split out of the former llm-prompts package (skills
# now live in ../llm-skills).
#
#   general-context.nix base global context shared by every agent
#   pi-context.md       Pi's repo-agnostic operating manual, appended INSIDE
#                       Pi's system prompt (~/.pi/agent/APPEND_SYSTEM.md)
#   pi-context-cq.md    legacy cq command/subagent instructions. Not installed;
#                       cq4 is not wired yet.
{
  lib,
  stdenvNoCC,
}:
let
  generalContext = import ./general-context.nix;
  preamble = generalContext.preamble;
  sectionOrderStep = 100;
  sections = builtins.listToAttrs (lib.imap1 (index: section: {
    inherit (section) name;
    value = {
      inherit (section) heading fragments;
      order = index * sectionOrderStep;
      text = if section.fragments == [ ] then section.text else
        section.heading + lib.concatMapStrings (fragment: fragment.text) section.fragments;
    };
  }) generalContext.sections);
  general = lib.concatStringsSep "\n" (
    [ preamble ] ++ map (section: sections.${section.name}.text) generalContext.sections
  );
  pi = builtins.readFile ./pi-context.md;

  package = stdenvNoCC.mkDerivation {
    name = "llm-contexts";
    src = ./.;
    generalText = general;
    passAsFile = [ "generalText" ];
    dontConfigure = true;
    dontBuild = true;
    installPhase = ''
      mkdir -p $out
      cp "$generalTextPath" $out/general-context.md
      cp pi-context.md $out/
    '';
    meta = with lib; {
      description = "LLM agent global context fragments (general + Pi operating manual)";
      license = [ licenses.mit ];
      maintainers = with maintainers; [ pshirshov ];
    };
  };
in
{
  # Inline-string fragments (never store paths), mirroring the skills contract.
  inherit general pi package preamble sections;
}
