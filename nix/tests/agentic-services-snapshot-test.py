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
expected_proxy = normalize(baseline["proxy"])
# Deliberate current-codec replacement and native request-line privacy fix only;
# all other proxy identity/body/timeouts/Host bindings remain characterized.
assert expected_proxy.count("root @STORE@;") == 1
expected_proxy = expected_proxy.replace("root @STORE@;", "error_log /dev/null;\nroot @STORE@;", 1)
# Accounts design §6.6: the client address reaches the backends.
expected_proxy = expected_proxy.replace("proxy_set_header X-Forwarded-Proto $scheme;", "proxy_set_header X-Forwarded-Proto $scheme;\nproxy_set_header X-Forwarded-For $remote_addr;")
expected_proxy = expected_proxy.replace('{"error":{"code":"unavailable","message":"service unavailable"}}', json.dumps({"code":"unavailable","currentRevision":None,"message":"service unavailable","spans":[]},separators=(',',':'),sort_keys=True))
assert normalize(current["proxy"]) == expected_proxy, "unintended proxy behavior changed"
assert normalize(current["crawl"]) == normalize(baseline["crawl"]), "legacy crawler behavior changed"
assert current["units"] == sorted([n for n in baseline["units"] if n not in ("ivm-postgres", "ivm-haystack-database")] + ["ivm-haystack-migrate","ivm-manure-migrate"])
assert current["timers"] == baseline["timers"]
# Explicitly migrated connection/native asset fields; retain every other domain,
# network and credential identity binding byte-for-byte.
for user in current["haystackAuth"]["users"]:
    assert user["displayName"] == user["id"]
account_fields = ("enabled", "login", "passwordHashFile", "admin")
auth_without_accounts = {**current["haystackAuth"], "users": [{k:v for k,v in u.items() if k not in ("displayName", *account_fields)} for u in current["haystackAuth"]["users"]]}
assert auth_without_accounts == baseline["haystackAuth"]
assert {k:v for k,v in current["manureConfig"].items() if k not in ("database","migration_receipt_dir","embedding","native_mode","posix_library","dashboard_dir","unlock_shell_dir","viewer_dir","users")} == {k:v for k,v in baseline["manureConfig"].items() if k != "users"}
assert [{k:v for k,v in u.items() if k not in account_fields} for u in current["manureConfig"]["users"]] == baseline["manureConfig"]["users"]
for service, values in (("haystack", current["haystackAuth"]["users"]), ("manure", current["manureConfig"]["users"])):
    for user in values:
        assert user["enabled"] is True
        if user["id"] == "operator":
            assert user["admin"] is True
            assert user["login"] == "operator"
            assert user["passwordHashFile"] == f"/home/alice/.local/state/ivm-services/credentials/{service}-operator.pbkdf2"
        else:
            assert "login" not in user and "passwordHashFile" not in user and "admin" not in user
assert current["haystackConfig"]["database"]["jdbcUrl"] == "jdbc:postgresql://127.0.0.1:15434/haystack"
assert current["manureConfig"]["database"]["jdbcUrl"] == "jdbc:postgresql://127.0.0.1:15434/manure"
assert current["manureConfig"]["native_mode"] == "linked"
assert current["manureConfig"]["viewer_dir"].endswith("/share/manure/web/viewer")
assert current["haystackConfig"]["webRoot"].endswith("/share/haystack/web")
assert haystack_auth == current["haystackAuth"], "rendered Haystack auth differs"
assert manure_config == current["manureConfig"], "rendered Manure config differs"
setup = current["setup"]
for fragment in ("set -euo pipefail", "umask 077", "[ ! -O", "--haystack-agent-file",
                 "--manure-agent-file", "passwd -apr1 -stdin", "static.htpasswd.tmp",
                 "/bin/mv -f", "www"):
    assert fragment in setup, f"legacy setup contract missing: {fragment}"
print("Legacy renderer/identity comparisons, explicit account fields and setup invariants passed")
