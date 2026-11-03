# Actual static Manure build and Unicode verification

Build input: immutable Nix integration `521e9b005e3712751cb80e3160b905c69aa72a45`, incorporating application141/cf46. Native build command exited0; actual output is recorded in `outpaths`. No binary is committed here.

The parent compared the artifact's actual precompile canonical manifest byte-for-byte with `artifact-source.py` executed in the frozen141 validation worktree: identical. The actual service ELF then executed its pure `check-casefold` diagnostic and exited0 after evaluating every1,112,064 Unicode scalar against the pinned UCD16 oracle: `5f578437c5eaa594f59de533d294d0a0cfa0070ea0b41308000f745e96cd9136`.

`assembly-inputs.json` records the actual pre-native assembly hash, exact SQL resource bytes (including003_catalogue.sql), generated Scala UnicodeCaseFold class entries and source hash. The native recipe also compares canonical migration SQL with the runtime resource before assembly. These are build/resource/Unicode proofs, not full native HTTP/browser/recovery acceptance; that remains a separate required gate.

No production configuration, credentials, database, model or filesystem payload was accessed by the pure Unicode diagnostic.
