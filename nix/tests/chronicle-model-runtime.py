"""Behavioral effectual/local-filesystem tests; no hub, GPU, or credentials required."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler, HTTPServer

spec = importlib.util.spec_from_file_location("runtime", sys.argv.pop(1))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
emitted_config = json.loads(Path(sys.argv.pop(1)).read_text()) if len(sys.argv) > 1 else None
emitted_embedding_config = json.loads(Path(sys.argv.pop(1)).read_text()) if len(sys.argv) > 1 else None


class WeightsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.inputs = self.root / "inputs"
        self.inputs.mkdir()
        contents = {"config.json": b"{}", "tokenizer_config.json": b"{}", "tokenizer.json": b"{}", "model.safetensors": b"synthetic weights"}
        self.spec = {"repository": "test/public", "revision": "a" * 40, "files": {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()}}
        for name, data in contents.items():
            (self.inputs / name).write_bytes(data)
        self.downloads = []

    def fetch(self, name):
        self.downloads.append(name)
        return self.inputs / name

    def test_verified_atomic_publication_and_idempotent_restart(self):
        target = runtime.provision(self.root / "weights", self.spec, self.fetch)
        runtime.verify(target, self.spec)
        self.assertEqual(target.name, runtime.identity(self.spec))
        self.assertEqual(len(self.downloads), 4)
        self.assertEqual(target, runtime.provision(self.root / "weights", self.spec, lambda _: self.fail("unexpected download")))

    def test_failed_fetch_never_publishes_and_resumes_verified_files(self):
        def fail(name):
            if name == "tokenizer.json":
                raise ConnectionError("interrupted")
            return self.fetch(name)
        root = self.root / "weights"
        with self.assertRaises(ConnectionError):
            runtime.provision(root, self.spec, fail)
        self.assertFalse((root / runtime.identity(self.spec)).exists())
        self.assertFalse((root / (runtime.identity(self.spec) + ".partial") / ".complete.json").exists())
        target = runtime.provision(root, self.spec, self.fetch)
        self.assertEqual(self.downloads.count("config.json"), 1)
        runtime.verify(target, self.spec)

    def test_corrupt_download_cannot_publish(self):
        (self.inputs / "model.safetensors").write_bytes(b"bad")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            runtime.provision(self.root / "weights", self.spec, self.fetch)
        self.assertFalse((self.root / "weights" / runtime.identity(self.spec)).exists())

    def test_published_corruption_fails_closed_without_mutation(self):
        target = runtime.provision(self.root / "weights", self.spec, self.fetch)
        (target / "model.safetensors").write_bytes(b"bad")
        with self.assertRaisesRegex(ValueError, "corrupt"):
            runtime.provision(self.root / "weights", self.spec, lambda _: self.fail("must not repair published artifacts"))
        self.assertEqual((target / "model.safetensors").read_bytes(), b"bad")

    def test_changed_source_identity_gets_distinct_artifact(self):
        first = runtime.provision(self.root / "weights", self.spec, self.fetch)
        changed = dict(self.spec, revision="b" * 40)
        second = runtime.provision(self.root / "weights", changed, self.fetch)
        self.assertNotEqual(first, second)
        runtime.verify(first, self.spec)
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            runtime.verify(first, changed)

    def test_incomplete_weight_index_is_rejected(self):
        name = "model.safetensors.index.json"
        data = json.dumps({"weight_map": {"weight": "missing-shard.safetensors"}}).encode()
        (self.inputs / name).write_bytes(data)
        self.spec["files"][name] = hashlib.sha256(data).hexdigest()
        with self.assertRaisesRegex(ValueError, "shards absent"):
            runtime.provision(self.root / "weights", self.spec, self.fetch)

    def test_shard_without_index_and_symlink_staging_fail_before_fetch(self):
        files = dict(self.spec["files"])
        files["model-00001-of-00002.safetensors"] = files.pop("model.safetensors")
        with self.assertRaisesRegex(ValueError, "complete weight index"):
            runtime.provision(self.root / "weights", dict(self.spec, files=files), lambda _: self.fail("must validate first"))
        root = self.root / "weights"
        root.mkdir(exist_ok=True)
        (root / (runtime.identity(self.spec) + ".partial")).symlink_to(self.inputs, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Unsafe symlink"):
            runtime.provision(root, self.spec, lambda _: self.fail("must reject unsafe staging"))

    def test_unsafe_or_incomplete_manifest_is_rejected_before_fetch(self):
        for name in ("../secret", "/absolute", "a/../secret", ".complete.json"):
            changed = dict(self.spec, files=dict(self.spec["files"], **{name: "a" * 64}))
            with self.assertRaises(ValueError):
                runtime.provision(self.root / "weights", changed, lambda _: self.fail("must validate first"))
        for name in ("config.json", "model.safetensors", "tokenizer.json"):
            files = dict(self.spec["files"])
            del files[name]
            with self.assertRaises(ValueError):
                runtime.provision(self.root / "weights", dict(self.spec, files=files), lambda _: self.fail("must validate first"))

    def test_symlink_and_extra_files_are_rejected(self):
        target = runtime.provision(self.root / "weights", self.spec, self.fetch)
        (target / "unexpected.py").write_text("unsafe")
        with self.assertRaisesRegex(ValueError, "Unexpected"):
            runtime.verify(target, self.spec)
        (target / "unexpected.py").unlink()
        (target / "linked-directory").symlink_to(self.inputs, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlinks"):
            runtime.verify(target, self.spec)

    def test_launch_credentials_are_environment_only_and_empty_key_is_explicit(self):
        target = runtime.provision(self.root / "weights", self.spec, self.fetch)
        credentials = self.root / "credentials"
        credentials.mkdir()
        (credentials / "api-key").write_text("sensitive-runtime-key")
        launcher = self.root / "vllm"
        launcher.write_text(f"#!{sys.executable}\n" + "import json,os,sys\nprint(json.dumps({'args':sys.argv[1:], 'key':os.environ.get('VLLM_API_KEY')}))\n")
        launcher.chmod(0o700)
        configuration = self.root / "runtime.json"
        configuration.write_text(json.dumps({"weights": self.spec, "root": str(target.parent), "executable": str(launcher), "vllmConfig": "/nonsecret/config.yaml"}))
        environment = dict(os.environ, CREDENTIALS_DIRECTORY=str(credentials), VLLM_API_KEY="untrusted-ambient")
        def launch():
            result = subprocess.run([sys.executable, runtime.__file__, "serve", str(configuration)], env=environment, check=True, capture_output=True, text=True)
            return json.loads(result.stdout)
        result = launch()
        self.assertEqual(result["args"], ["serve", str(target), "--config", "/nonsecret/config.yaml"])
        self.assertEqual(result["key"], "sensitive-runtime-key")
        (credentials / "api-key").write_text("")
        self.assertIsNone(launch()["key"])


class ContainerTests(unittest.TestCase):
    def configuration(self):
        return {"podman": "/bin/podman", "unit": "chronicle-model-annotation", "root": "/var/lib/model", "weights": {"repository": "test/public", "revision": "a" * 40, "files": {}}, "cache": "/var/cache/model", "helper": "/store/helper.py", "vllmConfig": "/store/vllm.yaml", "devices": ["2", "3"], "environment": {"HF_HUB_OFFLINE": "1"}, "image": "docker.io/vllm/vllm-openai@sha256:" + "a" * 64}

    def test_container_nonroot_cdi_and_readonly_mount_contract(self):
        config = self.configuration()
        command = runtime.container_command(config, "/store/runtime.json", 12345, 12346, [44, 303], "/run/model/credentials")
        self.assertEqual(command[:2], ["/bin/podman", "run"])
        self.assertEqual(command[command.index("--user") + 1], "12345:12346")
        self.assertIn("--cap-drop=ALL", command)
        self.assertIn("--security-opt=no-new-privileges", command)
        self.assertIn("--read-only", command)
        self.assertIn("--network=host", command)
        self.assertIn("nvidia.com/gpu=2", command)
        self.assertIn("nvidia.com/gpu=3", command)
        self.assertIn("/run/model/credentials:/run/model/credentials:ro", command)
        self.assertIn("/var/cache/model:/var/cache/model:rw", command)
        self.assertIn("/store/vllm.yaml:/store/vllm.yaml:ro", command)
        self.assertNotIn("VLLM_API_KEY", " ".join(command))
        self.assertNotIn("--privileged", command)
        self.assertEqual(command[-4:], [config["image"], config["helper"], "serve", "/store/runtime.json"])

    def test_runtime_credential_staging_is_owned_readable_by_model_identity_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            credentials = Path(runtime.stage_credential(temporary, os.getuid(), os.getgid(), "runtime-key"))
            target = credentials / "api-key"
            self.assertEqual(credentials.stat().st_mode & 0o777, 0o700)
            self.assertEqual(target.stat().st_mode & 0o777, 0o400)
            self.assertEqual(target.stat().st_uid, os.getuid())
            self.assertEqual(target.stat().st_gid, os.getgid())
            self.assertEqual(target.read_text(), "runtime-key")
            runtime.stage_credential(temporary, os.getuid(), os.getgid(), "rotated-key")
            self.assertEqual(target.read_text(), "rotated-key")

    def test_container_launcher_never_changes_cache_ownership(self):
        class Launched(Exception):
            pass
        with tempfile.TemporaryDirectory() as temporary:
            config = self.configuration()
            config["cache"] = temporary
            config["runtime"] = temporary
            user = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())
            with (
                mock.patch.object(runtime, "verify"),
                mock.patch.object(runtime.pwd, "getpwnam", return_value=user),
                mock.patch.object(runtime, "credential", return_value="key"),
                mock.patch.object(runtime, "stage_credential", return_value="/run/model/credentials"),
                mock.patch.object(runtime.grp, "getgrnam", return_value=SimpleNamespace(gr_gid=os.getgid())),
                mock.patch.object(runtime.os, "chown", side_effect=AssertionError("root launcher must not chown the model cache")),
                mock.patch.object(runtime.os, "execv", side_effect=Launched),
            ):
                with self.assertRaises(Launched):
                    runtime.launch_container(config, "/store/runtime.json")
                user.pw_uid = os.getuid() + 1
                with self.assertRaisesRegex(ValueError, "cache.*owned"):
                    runtime.launch_container(config, "/store/runtime.json")
                user.pw_uid = os.getuid()
                link = Path(temporary) / "cache-link"
                link.symlink_to(temporary, target_is_directory=True)
                config["cache"] = str(link)
                with self.assertRaisesRegex(ValueError, "cache.*owned"):
                    runtime.launch_container(config, "/store/runtime.json")

    @unittest.skipIf(emitted_config is None, "Nix-emitted configuration only available in Nix check")
    def test_nix_configuration_is_actual_vllm_029_positional_yaml_contract(self):
        for emitted in (emitted_config, emitted_embedding_config):
            helper = Path(emitted["helper"])
            self.assertTrue(helper.is_file(), "Container helper must exist in the isolated runtime closure")
            self.assertEqual(runtime.digest(helper), runtime.digest(Path(runtime.__file__)))
        config = emitted_config
        self.assertEqual(config["executable"], "vllm")
        self.assertTrue(config["vllmConfig"].endswith(".yaml"))
        vllm = json.loads(Path(config["vllmConfig"]).read_text())
        self.assertNotIn("model", vllm)
        self.assertEqual(vllm["runner"], "generate")
        self.assertEqual(vllm["host"], "127.0.0.1")
        self.assertEqual(vllm["default-chat-template-kwargs"], {"enable_thinking": False})
        self.assertFalse(vllm["trust-remote-code"])
        embedding = json.loads(Path(emitted_embedding_config["vllmConfig"]).read_text())
        self.assertNotIn("model", embedding)
        self.assertEqual(embedding["runner"], "pooling")
        self.assertNotIn("default-chat-template-kwargs", embedding)
        self.assertEqual(embedding["dtype"], "bfloat16")
        command = runtime.container_command(config, "/store/runtime.json", 12345, 12346, [44, 303], "/run/model/credentials")
        self.assertIn("nvidia.com/gpu=0", command)
        self.assertFalse(any("secret" in arg for arg in command))


class ReadinessTests(unittest.TestCase):
    def test_authenticated_health_and_exact_served_identity(self):
        class Handler(BaseHTTPRequestHandler):
            redirect = False
            paths = []
            def do_GET(self):
                self.paths.append(self.path)
                if self.redirect and self.path == "/health":
                    self.send_response(302)
                    self.send_header("Location", "/redirected")
                    self.end_headers()
                    return
                if self.headers.get("Authorization") != "Bearer local-key":
                    self.send_error(401)
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"data":[{"id":"expected-model"}]}' if self.path == "/v1/models" else b"{}")
            def log_message(self, *args):
                pass
        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(server.shutdown)
        url = f"http://127.0.0.1:{server.server_port}"
        runtime.ready(url, "expected-model", "local-key", 2)
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            runtime.ready(url, "wrong-model", "local-key", 2)
        with self.assertRaisesRegex(RuntimeError, "Timed out"):
            runtime.ready(url, "expected-model", "wrong-key", 0)
        Handler.redirect = True
        with self.assertRaisesRegex(ValueError, "unexpectedly redirected"):
            runtime.ready(url, "expected-model", "local-key", 2)
        self.assertNotIn("/redirected", Handler.paths)


unittest.main()
