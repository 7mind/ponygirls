# Locked npm dependencies of the Chronicle dashboard (the same fixed-output derivation as web.nix).
{ lib, fetchNpmDeps }:
fetchNpmDeps {
  name = "chronicle-web-npm-dependencies";
  src = lib.fileset.toSource {
    root = ../../../chronicle/web;
    fileset = lib.fileset.unions [ ../../../chronicle/web/package.json ../../../chronicle/web/package-lock.json ];
  };
  hash = (import ./hashes.nix).web;
}
