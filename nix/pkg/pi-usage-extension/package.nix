{ lib
, stdenvNoCC
, fetchFromGitHub
, jq
}:

# /usage — usage statistics dashboard for Pi sessions, as a Pi LOCAL package
# (https://pi.dev/packages/@tmustier/pi-usage-extension).
#
# Source pin: the tmustier/pi-extensions monorepo at the commit tagged
# usage-extension/v0.9.5 (also main HEAD at fetch time), NOT
# `npm:@tmustier/pi-usage-extension@0.9.5` (an npm spec can only pin to a
# version, not a commit) and NOT `git:github.com/tmustier/pi-extensions@<sha>`
# (the monorepo root manifest declares 13 extensions + 3 skills — arcade
# games, pi-ralph-wiggum, session-recap, … — so a git install would load them
# all unless every one is excluded with resource filters, and clones the whole
# monorepo to use one extension). This derivation installs ONLY the
# usage-extension/ package directory, whose own manifest declares just
# index.ts.
#
# Pi loads local packages in place and never installs or modifies them, so
# nothing is written to ~/.pi/agent/npm. Import surface at this pin (the build
# fails on any new bare import): index/data/graph/export.ts import exactly the
# host-aliased peers @earendil-works/pi-coding-agent and
# @earendil-works/pi-tui (declared in peerDependencies with a "*" range per
# Pi's packaging contract) plus node:* builtins and relative ./ modules. The
# declared devDependencies are never installed for local packages.
stdenvNoCC.mkDerivation rec {
  pname = "pi-usage-extension";
  version = "0.9.5";

  src = fetchFromGitHub {
    owner = "tmustier";
    repo = "pi-extensions";
    # tag usage-extension/v0.9.5
    rev = "4a63a2ebd3683d86597e226c7ff778ea4837dd73";
    hash = "sha256-CnU01tMeRf42wC5Rune0ANl9bv0mLM5iOCGUgX7W8D4=";
  };

  nativeBuildInputs = [ jq ];

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p $out
    cp -r usage-extension/. $out
    chmod -R u+w $out

    # Fail fast if a pin bump changes the manifest shape this packaging assumes.
    jq -e '.pi.extensions == ["index.ts"]' $out/package.json > /dev/null
    jq -e '.dependencies == null' $out/package.json > /dev/null
    jq -e '.peerDependencies == {"@earendil-works/pi-coding-agent": "*", "@earendil-works/pi-tui": "*"}' $out/package.json > /dev/null

    # Fail fast if a pin bump widens the import surface beyond Pi's host module
    # aliases and node builtins: any other bare specifier would have to be
    # vendored under $out/node_modules (see the derivation header).
    unexpected="$(grep -RhoE 'from "[^"]+"' --include='*.ts' $out \
      | sed -e 's/^from "//' -e 's/"$//' \
      | grep -vE '^(\./|\.\./|node:|@earendil-works/pi-coding-agent$|@earendil-works/pi-tui$)' \
      || true)"
    if [ -n "$unexpected" ]; then
      echo "unexpected bare imports in usage-extension:" >&2
      echo "$unexpected" >&2
      exit 1
    fi

    runHook postInstall
  '';

  meta = {
    description = "/usage statistics dashboard for Pi sessions (tmustier/pi-extensions @ usage-extension/v0.9.5, commit-pinned)";
    homepage = "https://github.com/tmustier/pi-extensions/tree/main/usage-extension";
    license = lib.licenses.mit;
  };
}
