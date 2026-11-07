# Vendored search hub

`src/` was copied from the previously packaged pi-search-hub output, based on
ronnieops/pi-search-hub commit `6dd5188` (Nix source hash
`sha256-3LcRegB1PkMjM9xEhZPk98h/2NrE0gFkgw0PaNMIwl0=`).
It includes the former empty-reader-content, always-include-tier, and
source-provenance patches and the host-package manifest correction.
Upstream declares MIT in package.json; its CREDITS.md is retained.

This is now maintained directly here, not updated by applying a patch stack.
The upstream README and release notes describe the imported baseline; see the
repository README for local behavior and validation.
