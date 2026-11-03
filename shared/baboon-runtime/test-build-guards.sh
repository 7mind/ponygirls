#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${SBT_LAUNCH_JAR:?use pinned chronicle development shell}"
mkdir -p target/baboon-validation
report=$(mktemp -d "$PWD/target/baboon-validation/$(date -u +%Y%m%dT%H%M%SZ).XXXXXX")
echo "Baboon guard receipt: $report"
sha256sum build.sbt shared/baboon-runtime/src/main/scala/Baboon*.scala > "$report/source.sha256"
git rev-parse HEAD > "$report/git-head"
fixture="$report/mismatch"
mkdir -p "$fixture/.build" "$fixture/scala"
cp shared/baboon-runtime/src/main/scala/Baboon*.scala "$fixture/scala/"
printf '\n// deliberate fixture byte mismatch\n' >> "$fixture/scala/BaboonTools.scala"
printf 'package fixture\nfinal class CurrentDomain\n' > "$fixture/scala/CurrentDomain.scala"
# No service/generator input is edited. Override this verification-only project base
# in the sbt process to check an isolated fixture with the full runtime file set.
if bash scripts/backend-sbt.sh "set haystackContracts / baseDirectory := file(\"$fixture/.build\")" 'haystackContracts/verifyBaboonRuntime' > "$report/mismatch.log" 2>&1; then
  echo 'FAIL byte-different runtime was accepted' >&2
  exit 1
fi
grep -q 'Baboon runtime differs:' "$report/mismatch.log"
# Compiling duplicate roots used to be silently deduplicated at assembly. This
# temporary in-process setting deliberately restores that bad source arrangement.
# Always restore normal incremental output before exit, including on test failure.
restore() {
  local original=$?
  trap - EXIT
  set +e
  bash scripts/backend-sbt.sh 'chronicleServer/verifySingleBaboonRuntime' contractCoassembly > "$report/restored.log" 2>&1
  local restored=$?
  if [[ "$original" != 0 ]]; then exit "$original"; fi
  exit "$restored"
}
trap restore EXIT
if bash scripts/backend-sbt.sh 'set contracts / Compile / unmanagedSources := (contracts / Compile / unmanagedSourceDirectories).value.flatMap(d => (d ** "*.scala").get)' 'chronicleServer/verifySingleBaboonRuntime' > "$report/duplicate.log" 2>&1; then
  echo 'FAIL duplicate compiled runtime was accepted' >&2
  exit 1
fi
grep -q 'duplicate compiled Baboon runtime class:' "$report/duplicate.log"
echo 'PASS byte mismatch and duplicate compiled runtime rejected; restoring normal coassembly'
