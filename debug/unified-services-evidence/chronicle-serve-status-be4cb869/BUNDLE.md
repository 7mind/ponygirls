# Chronicle NixOS serve status correction

Actual source658 native probe returned normal143 after owned SIGTERM; pinned systemd262 rejected it under the original empty success set. Original expected-failure1 and owned-closure receipts are preserved separately in `chronicle-native-shutdown-red-65879bdd/`, not rewritten green.

Parent reviewed/cherry-picked only worker6631672d as be4cb869 and verified both source hashes. The only service change is NixOS Chronicle serve SuccessExitStatus143; migration/fatal1/137/SIGKILL, all other units, commands/dependencies/hardening and provider are unchanged. Focused desired module assertion failed before the correction, then34 module assertions and22 controlled harness cases passed. New policy recognizes the actual recorded143. This is not new live-manager or active-finalizer acceptance.

Worker's frozen canonical comparison removes the single new line to recover the entire original unit. HM inputs are identical; retaining the original658 provenance in a pure comparison gives the exact already-executed c7z8/h2jl derivation/output. A default new source stamp alone would change the derivation: no new HM execution or relabeling of the658 receipt is claimed. Manure's full VM derivation/driver/baseScript and native artifacts are unchanged. Parent read the reports rather than independently repeating every canonical evaluation.

Final applicable NixOS9 and three-repository checks remain separately required. No application/native rebuild, pin update, push or activation occurred.
