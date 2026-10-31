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
for field in ("proxy", "crawl", "postgres"):
    assert normalize(current[field]) == normalize(baseline[field]), f"legacy {field} behavior changed"
for field in ("units", "timers", "haystackAuth", "manureConfig"):
    assert current[field] == baseline[field], f"legacy {field} binding changed"
assert haystack_auth == current["haystackAuth"], "rendered Haystack auth differs"
assert manure_config == current["manureConfig"], "rendered Manure config differs"
setup = current["setup"]
for fragment in ("set -euo pipefail", "umask 077", "[ ! -O", "--haystack-agent-file",
                 "--manure-agent-file", "passwd -apr1 -stdin", "static.htpasswd.tmp",
                 "/bin/mv -f", "www"):
    assert fragment in setup, f"legacy setup contract missing: {fragment}"
print("9 legacy renderer/identity comparisons and 10 setup invariants passed")
