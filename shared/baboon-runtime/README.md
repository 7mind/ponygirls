# One compiled Baboon runtime

Pinned Baboon 0.0.200's eleven root Scala runtime sources are canonical here,
compiled only in `baboonRuntime` (Scala 2.13.18). Every generated domain project
uses a project dependency and excludes root `Baboon*.scala` from compilation.
`verifyBaboonRuntime` fails before domain compilation if emitted runtime files
have a different file set or bytes. This is not assembly duplicate selection.
The pinned generator also supports `--runtime without`; common runtime verification
can regenerate runtime-only output from the current Chronicle model.

Only current domain models/codecs are supported. This shared compiler runtime does
not add any historical domain codecs or wire compatibility requirement.

`contractCoassembly` compiles all three actual current domains and packages their
classes and canonical runtime into `target/contracts-coassembly.jar`. It rejects
all duplicate class names, verifies each domain is present and that every runtime
class comes only from `baboonRuntime`. This is a contract bundle/proof, not an
executable service or a substitute for application/native acceptance. App assemblies
also execute `verifySingleBaboonRuntime` over their actual compiled classpaths.

`test-build-guards.sh` exercises byte-mismatch and actual duplicate-compilation
negative controls with isolated fixtures / temporary in-process sbt settings, then
restores and checks normal coassembly. Requires the pinned Chronicle shell; retains
fresh logs under `target/baboon-validation/`. It never edits domain sources.
