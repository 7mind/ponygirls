"""Specified Blackbox-Group renderer compatibility, no host/network access."""
import json
from pathlib import Path
import re
import sys


def normalize(text):
    text = re.sub(r"/nix/store/[a-z0-9]{32}-[^ ;\n]+", "@STORE@", text)
    return "\n".join(line.strip() for line in text.splitlines()
                     if line.strip() and not line.strip().startswith("#"))


baseline, current, haystack_auth, manure_config = (json.loads(Path(path).read_text()) for path in sys.argv[1:])
for field in ("proxy", "crawl"):
    assert normalize(current[field]) == normalize(baseline[field]), f"legacy {field} behavior changed"
assert current["units"] == [n for n in baseline["units"] if n not in ("ivm-postgres", "ivm-haystack-database")]
assert current["timers"] == baseline["timers"]
# Explicitly migrated connection/native asset fields; retain every other domain,
# network and credential identity binding byte-for-byte.
for user in current["haystackAuth"]["users"]:
    assert user["displayName"] == user["id"]
auth_without_display = {**current["haystackAuth"], "users": [{k:v for k,v in u.items() if k != "displayName"} for u in current["haystackAuth"]["users"]]}
assert auth_without_display == baseline["haystackAuth"]
assert {k:v for k,v in current["manureConfig"].items() if k not in ("database","migration_receipt_dir","native_mode","posix_library","dashboard_dir","unlock_shell_dir")} == baseline["manureConfig"]
assert current["haystackConfig"]["database"]["jdbcUrl"] == "jdbc:postgresql://127.0.0.1:15434/haystack"
assert current["manureConfig"]["database"]["jdbcUrl"] == "jdbc:postgresql://127.0.0.1:15434/manure"
assert current["manureConfig"]["native_mode"] == "linked"
assert current["haystackConfig"]["webRoot"].endswith("/share/haystack/web")
assert haystack_auth == current["haystackAuth"], "rendered Haystack auth differs"
assert manure_config == current["manureConfig"], "rendered Manure config differs"
setup = current["setup"]
for fragment in ("set -euo pipefail", "umask 077", "[ ! -O", "--haystack-agent-file",
                 "--manure-agent-file", "passwd -apr1 -stdin", "static.htpasswd.tmp",
                 "/bin/mv -f", "www"):
    assert fragment in setup, f"legacy setup contract missing: {fragment}"
print("9 legacy renderer/identity comparisons and 10 setup invariants passed")
