# One compiled Baboon runtime

Pinned Baboon 0.0.198's eleven root Scala runtime sources are canonical here,
compiled only in `baboonRuntime` (Scala 2.13.18). Every generated domain project
uses a project dependency and excludes root `Baboon*.scala` from compilation.
`verifyBaboonRuntime` fails before domain compilation if emitted runtime files
have a different file set or bytes. This is not assembly duplicate selection.
The pinned generator also supports `--runtime without`; common runtime verification
can regenerate runtime-only output from the current Chronicle model.

Only current domain models/codecs are supported. This shared compiler runtime does
not add any historical domain codecs or wire compatibility requirement.
