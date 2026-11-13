#!/usr/bin/env python3
"""Specified CLI contracts: recording tests plus --real bubblewrap acceptance."""
import json
import os
import shlex
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent
REAL = "--real" in sys.argv
if REAL:
    sys.argv.remove("--real")


class CowboyRideTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="yolo-cowboy-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.project = self.root / "project"
        self.bin = self.root / "bin"
        for path in (self.home, self.project, self.bin):
            path.mkdir()
        self.env = dict(os.environ)
        self.env.update(
            HOME=str(self.home),
            PATH=f"{self.bin}:{os.environ['PATH']}",
            YOLO_LLM_SANDBOX=str(self.bin / "llm-sandbox"),
            YOLO_SANDBOX_ENTRYPOINT=shutil.which("true"),
            YOLO_NIX_LD=shutil.which("true"),
            YOLO_JQ=shutil.which("jq"),
            YOLO_TASKSET=shutil.which("false"),
            YOLO_CUSTOM_PROMPT=str(ROOT / "custom-prompt.sh"),
            COWBOY_INHERITED="host-value",
        )
        # A real inherited socket must not start the sandbox clipboard broker.
        import socket
        sock = socket.socket(socket.AF_UNIX)
        sock.bind(str(self.root / "tmux.sock"))
        self.addCleanup(sock.close)
        self.env["TMUX"] = f"{self.root}/tmux.sock,123,0"
        self.env["YOLO_CLIPBOARD_PROXY"] = shutil.which("false")
        for key in ("SMIND_SANDBOXED", "SMIND_EXCHANGE_DIR", "CLAUDE_CODE_SANDBOXED",
                    "SMIND_CODEGRAPH_DISABLED"):
            self.env.pop(key, None)
        self.profile = self.home / ".config/yolo/work"
        self.credentials = {
            "pi": "agent/auth.json", "claude": ".credentials.json", "codex": "auth.json"
        }
        for agent, leaf in self.credentials.items():
            self.put(self.home / f".{agent}" / leaf, f"host-{agent}")
            self.put(self.profile / agent / "home" / leaf, f"work-{agent}")
        self.executable("llm-sandbox", f"#!{shutil.which('bash')}\nexec bash {shlex.quote(str(ROOT / 'llm-sandbox.sh'))} \"$@\"\n")
        if not REAL:
            self.executable("bwrap", f"#!{sys.executable}\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n")

    def put(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def executable(self, name, content):
        path = self.bin / name
        self.put(path, content)
        path.chmod(0o755)

    def launch(self, *args, cwd=None):
        return subprocess.run(
            ["bash", str(ROOT / "yolo.sh"), "--cowboy-ride", *args],
            env=self.env, cwd=cwd or self.project, text=True, capture_output=True, timeout=20,
        )

    def recorded(self, *args):
        result = self.launch(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_contract(self):
        if REAL:
            self.check_runtime()
        else:
            self.check_recording()

    def check_recording(self):
        for agent, leaf in self.credentials.items():
            with self.subTest(agent=agent):
                args = self.recorded("--auth-override", f"{agent}:work", agent, "argument with spaces")
                self.assertEqual(args[:3], ["--dev-bind", "/", "/"])
                src = str(self.profile / agent / "home" / leaf)
                dst = str(self.home / f".{agent}" / leaf)
                self.assertIn(["--bind", src, dst], [args[i:i+3] for i in range(len(args))])
                for flag in ("--unshare-all", "--clearenv", "--proc", "--tmpfs", "--die-with-parent"):
                    self.assertNotIn(flag, args)
                self.assertNotIn(str(self.profile / "pi/home"), args)
                self.assertEqual(args[-1], "argument with spaces")
        args = self.recorded("--profile", "work", "cmd", "true")
        for agent in self.credentials:
            self.assertIn(str(self.profile / agent / "home"), args)
        self.put(self.home / ".config/yolo/other/pi/home/agent/auth.json", "other-pi")
        args = self.recorded("--profile", "work", "--auth-override", "pi:other", "pi")
        self.assertLess(args.index(str(self.profile / "pi/home")),
                        args.index(str(self.home / ".config/yolo/other/pi/home/agent/auth.json")))
        args = self.recorded("--env", "EXPLICIT=value=with=equals", "--ro", str(self.project), "cmd", "true")
        self.assertIn(["--setenv", "EXPLICIT", "value=with=equals"],
                      [args[i:i+3] for i in range(len(args))])
        self.assertIn(["--ro-bind", str(self.project), str(self.project)],
                      [args[i:i+3] for i in range(len(args))])
        result = self.launch("cmd", "true", cwd=self.home)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_no_sandbox_integration(self):
        marker = self.root / "hook-ran"
        hook = [{"command": f"touch {marker}", "tags": [], "targets": ["*"]}]
        self.env.update(
            YOLO_PREHOOKS_JSON=json.dumps(hook),
            YOLO_SANDBOX_HOOKS_JSON=json.dumps(hook),
            YOLO_SECRET_VARS="UNWANTED=/does/not/exist",
            YOLO_SESSION_VARS="COWBOY_INHERITED=overwritten",
            YOLO_EXTRA_RO_PATHS=str(self.project),
            YOLO_PROMPT_JSON=json.dumps([{"target": "pi", "tags": [], "prompt": "sandbox-only-prompt"}]),
        )
        if REAL:
            self.executable("pi", f"#!{sys.executable}\nimport os\nassert os.environ['COWBOY_INHERITED'] == 'host-value'\n")
        result = self.launch("pi")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists())
        self.assertNotIn("sandbox-only-prompt", result.stdout)
        self.assertNotIn("not readable", result.stderr)
        if not REAL:
            self.assertNotIn("--ro-bind", json.loads(result.stdout))

    def test_inherited_agent_home_cannot_bypass_selection(self):
        homes = {"pi": ("PI_CODING_AGENT_DIR", ".pi/agent"),
                 "claude": ("CLAUDE_CONFIG_DIR", ".claude"),
                 "codex": ("CODEX_HOME", ".codex")}
        for key, _ in homes.values():
            self.env[key] = str(self.root / "unrelated-home")
        if REAL:
            self.executable("pi", f"#!{sys.executable}\nimport os,pathlib\na = pathlib.Path(os.environ['PI_CODING_AGENT_DIR'])\nassert (a / 'auth.json').read_text() == 'work-pi'\n")
            for flags in (("--auth-override", "pi:work"), ("--profile", "work")):
                result = self.launch(*flags, "pi")
                self.assertEqual(result.returncode, 0, result.stderr)
        else:
            for agent, (key, leaf) in homes.items():
                args = self.recorded("--auth-override", f"{agent}:work", agent)
                self.assertIn(["--setenv", key, str(self.home / leaf)],
                              [args[i:i+3] for i in range(len(args))])
            args = self.recorded("--profile", "work", "pi")
            for key, leaf in homes.values():
                self.assertIn(["--setenv", key, str(self.home / leaf)],
                              [args[i:i+3] for i in range(len(args))])

    def test_outer_sandbox_marker_is_preserved(self):
        self.env["SMIND_SANDBOXED"] = "1"
        self.env["SMIND_EXCHANGE_DIR"] = str(self.root / "outer-exchange")
        if REAL:
            result = self.launch("cmd", sys.executable, "-c",
                                 "import os; assert os.environ['SMIND_SANDBOXED'] == '1'; "
                                 "assert os.environ['SMIND_EXCHANGE_DIR'].endswith('/outer-exchange')")
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            args = self.recorded("cmd", "true")
            self.assertNotIn("--unsetenv", args)

    def test_invalid_credentials_fail_closed(self):
        for spec in ("pi:missing", "pi:../work", "unknown:work"):
            with self.subTest(spec=spec):
                result = self.launch("--auth-override", spec, "cmd", "true")
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stdout, "")

    def check_runtime(self):
        # Observable host access, namespace/environment preservation, live auth
        # refresh, and independent session writes through both composition paths.
        probe = self.root / "probe.py"
        self.put(probe, '''import json, os, pathlib
h = pathlib.Path.home()
a = h / '.pi/agent'
assert (a / 'auth.json').read_text() == os.environ['EXPECTED_AUTH']
(a / 'auth.json').write_text('refreshed')
(a / 'sessions').mkdir(exist_ok=True)
(a / 'sessions/cowboy').write_text('session')
pathlib.Path(os.environ['HOST_WRITE']).write_text('host-write')
assert os.environ['COWBOY_INHERITED'] == 'host-value'
assert os.environ['TMUX'] == os.environ['EXPECTED_TMUX']
for key in ('SMIND_SANDBOXED', 'SMIND_EXCHANGE_DIR', 'CLAUDE_CODE_SANDBOXED', 'SMIND_CODEGRAPH_DISABLED'):
    assert key not in os.environ, key
for ns, identity in json.loads(os.environ['EXPECTED_NS']).items():
    assert os.readlink('/proc/self/ns/' + ns) == identity, ns
''')
        self.env.update(
            HOST_WRITE=str(self.root / "outside-project"),
            EXPECTED_TMUX=self.env["TMUX"],
            EXPECTED_NS=json.dumps({ns: os.readlink(f"/proc/self/ns/{ns}")
                                    for ns in ("pid", "net", "ipc", "uts", "cgroup")}),
        )
        self.env["EXPECTED_AUTH"] = "work-pi"
        result = self.launch("--auth-override", "pi:work", "cmd", sys.executable, str(probe))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.profile / "pi/home/agent/auth.json").read_text(), "refreshed")
        self.assertEqual((self.home / ".pi/agent/auth.json").read_text(), "host-pi")
        self.assertTrue((self.home / ".pi/agent/sessions/cowboy").exists())
        self.env["EXPECTED_AUTH"] = "refreshed"
        result = self.launch("--profile", "work", "cmd", sys.executable, str(probe))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.profile / "pi/home/agent/sessions/cowboy").exists())
        self.assertEqual((self.root / "outside-project").read_text(), "host-write")
        self.put(self.home / ".config/yolo/other/pi/home/agent/auth.json", "other-pi")
        self.env["EXPECTED_AUTH"] = "other-pi"
        result = self.launch("--profile", "work", "--auth-override", "pi:other", "cmd", sys.executable, str(probe))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.home / ".config/yolo/other/pi/home/agent/auth.json").read_text(), "refreshed")


if __name__ == "__main__":
    unittest.main()
