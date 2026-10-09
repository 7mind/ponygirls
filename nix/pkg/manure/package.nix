# manure file & directory hosting service (CONTRACT.md frozen v0.2.0).
#
# Python >=3.12, stdlib-only runtime. Ships the dashboard + unlock shells
# and the agent SKILL per CONTRACT.md §11 (this file owns the Nix
# copy/install mapping: repo `manure/web/*` sources are copied into the
# Python package as `manure/manure/web/` at build time; the SKILL is
# installed as documentation output).
#
# Pre-implementation tolerance: server/client/web/skill sources land from
# their owning agents later. The web-tree copy and the SKILL install are
# guarded so this derivation still evaluates/builds from the skeleton;
# the M2 gate (packaged service starts on defaults and serves both
# shells) is enforced by the browser/VM checks, which fail once the
# implementation is present but the shells do not serve.
{ lib, python3 }:
let
  py = python3.pkgs;

  # Frozen metadata triple: this file + pyproject.toml +
  # manure/__init__.py must agree (CONTRACT.md §0). Fail-closed at eval.
  version = "0.2.0";
  pyprojectText = builtins.readFile ../../../manure/pyproject.toml;
  initText = builtins.readFile ../../../manure/manure/__init__.py;
in
assert lib.hasInfix ''version = "${version}"'' pyprojectText;
assert lib.hasInfix ''__version__ = "${version}"'' initText;
assert lib.versionAtLeast python3.version "3.12";
py.buildPythonPackage {
  pname = "manure";
  inherit version;
  pyproject = true;

  src = lib.cleanSourceWith {
    src = ../../../manure;
    filter =
      path: type:
      let
        base = baseNameOf path;
      in
      base != "__pycache__" && base != "node_modules" && base != "dist" && base != ".pytest_cache";
  };

  build-system = with py; [ setuptools ];

  # Zero runtime dependencies (CONTRACT.md §2: dependencies = []).
  dependencies = [ ];

  # §11 copy rule (Nix-owned): the unpacked src root holds the
  # UI-owned `web/{dashboard,unlock}/` sources next to the `manure/`
  # package dir; every packaged install copies that tree into the
  # Python package as `manure/web/`, which the server's resolution
  # order consults after an explicit config value. setuptools then
  # ships it via the contract-owned `package-data = manure/web/**/*`
  # rule. Missing sources fail the build (release checks must never
  # silently ship a shell-less package).
  preBuild = ''
    for shell in dashboard unlock; do
      if [ ! -d "web/$shell" ]; then
        echo "manure: missing web/$shell sources (§11 copy rule)" >&2
        exit 1
      fi
    done
    mkdir -p manure/web
    cp -r web/dashboard web/unlock manure/web/
  '';

  # The client-owned SKILL.md rides along as documentation output when it
  # exists; never a runtime import.
  postInstall = ''
    if [ -f "skill/SKILL.md" ]; then
      mkdir -p "$out/share/manure"
      cp "skill/SKILL.md" "$out/share/manure/SKILL.md"
    fi
  '';

  # Test suites are owned by the server/client/UI agents and run via
  # `python -m unittest discover` plus the flake browser/SDK checks, not
  # as part of this build.
  doCheck = false;

  pythonImportsCheck = [
    "manure"
    # Synced implementation modules (read-only dependencies of this
    # package): server + client trees. Missing modules fail the build
    # (release gates never accept a partial package).
    "manure.server"
    "manure.auth"
    "manure.domain"
    "manure.storage"
    "manure.client"
    "manure.cli"
    "manure.mcp"
  ];

  meta = {
    description = "Human/agent file and directory hosting (artifacts.7mind.io)";
    license = lib.licenses.mit;
    mainProgram = "manure-server";
  };
}
