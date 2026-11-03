# Actual native pre-build canonical SQL rejection

The Nix expression derives from immutable521's actual Manure native derivation and alters only a copied runtime SQL resource by appending one comment. The real canonical schema and repository files are unchanged.

The actual native build rejects this mismatch during buildPhase, before assembly or native compilation: `cmp` reports EOF on the shorter canonical file. The parent verified the canonical copied bytes equal frozen141 and the negative runtime copy equals those exact bytes plus the sole test comment.

The original supervisor exited1 because its validator incorrectly expected the word `differ` and both filenames. A prefix-length mismatch correctly emits EOF and only the shorter filename; `validation-result.json` explicitly adjudicates this verifier error. Original command/log/status are preserved, not relabeled as a successful build. The corrected verification exits0 and records one passing negative guard case. This is build-guard evidence, not application release acceptance.
