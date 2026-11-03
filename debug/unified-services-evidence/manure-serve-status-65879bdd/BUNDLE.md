# Manure serve exit-status correction

Actual a104 VM failed the unchanged M3 stop-state assertion: native Manure exited143 and systemd reported failure. The desired module assertion also failed before the correction; raw output stays private with its digest/size retained.

Parent reviewed/cherry-picked only worker `ce75ee0c` as `65879bdd`, verified all three file hashes against the report, and retained these byte-exact metadata copies. NixOS Manure serve and HM ivm-manure serve now explicitly recognize143; migration, fatal1/137/SIGKILL and unrelated units are unchanged. Worker computed complete canonical unit equivalence after removing the single new status field; Parent read that report rather than independently repeating the full evaluation.

Focused evaluation/build passed; thirty module assertion statements include nine new assertions. Separate direct controlled harness executions passed15+7 cases, zero failures/errors/skips. These are not actual fresh guest lifecycle or full VM results. Parent original-full driver build and unchanged runtime/M3 acceptance remain pending.

Pinned CE/JDK/Graal hook semantics and systemd exit classification explain the mismatch. Existing exact-source native/JVM335 runs independently passed four shutdown/drain cases; they did not record exit codes. Exit143 alone cannot prove every finalizer succeeded or arbitrary configuration fits systemd's stop budget. Haystack's separately tested signal handler returns0 and was not changed.
