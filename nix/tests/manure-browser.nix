# Full current browser inventory is part of the SAME source/artifact-bound
# service-owned full target derivation. Reusing it does not rerun/duplicate the
# expensive browser suite and cannot pass before that entire suite passes.
{ nativeCheck }: nativeCheck
