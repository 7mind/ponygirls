"""Separate actual-native + packaged-web + pinned-Chromium conformance leg."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

from client import JsonObject
from fixtures import FORGE_KEY, FORGE_PROJECTS
from native_acceptance import CaseRecord, CommandRecord, NativeAcceptance, sanitize, write_private


EXPECTED_CHECKS = [
    "native-login", "ui-write-only-credential", "ui-repository", "ui-rite",
    "ui-manual-run-published", "owner-to-viewer-private-state",
]


class BrowserNativeAcceptance:
    def __init__(self, launcher: Path, worker: Path, native_elf: Path, web_root: Path, node_module_root: Path, chromium: Path):
        for directory, marker in ((web_root, "index.html"), (web_root / "web", "app.js"), (web_root / "web", "styles.css"), (node_module_root / "playwright-core", "package.json")):
            if not directory.is_dir() or not (directory / marker).is_file():
                raise RuntimeError("packaged web or pinned Playwright runtime is incomplete")
        if not chromium.is_file() or not os.access(chromium, os.X_OK):
            raise RuntimeError("pinned Chromium executable is invalid")
        self.acceptance = NativeAcceptance(launcher, worker, native_elf, report_namespace="browser-native-validation-runs")
        self.acceptance.web_root = web_root
        self.node_module_root = node_module_root
        self.chromium = chromium

    def run_browser(self) -> None:
        native = self.acceptance
        if not native.native_base or native.fixtures is None:
            raise RuntimeError("native browser fixtures are not ready")
        plan_path = native.runtime_path / "browser-plan.json"
        result_path = native.runtime_path / "browser-result.json"
        write_private(plan_path, json.dumps({
            "origin": native.native_base,
            "fixtureOrigin": native.fixtures.base_url,
            "nodeModuleRoot": str(self.node_module_root),
            "chromium": str(self.chromium),
            "resultPath": str(result_path),
            "host": "127.0.0.1",
            "forgeKey": FORGE_KEY,
            "repositoryId": "github",
            "project": FORGE_PROJECTS["Github"],
            "riteId": "site",
            "users": {
                "owner": {"login": "owner", "password": "owner-password"},
                "viewer": {"login": "viewer", "password": "viewer-password"},
            },
        }))
        node = shutil.which("node")
        if node is None:
            raise RuntimeError("pinned Node executable unavailable for browser conformance")
        driver = Path(__file__).resolve().with_name("browser_driver.mjs")
        argv = [node, str(driver), str(plan_path)]
        started = time.monotonic()
        output_path = native.runtime_path / "browser-driver.stdout"
        error_path = native.runtime_path / "browser-driver.stderr"
        home = native.runtime_path / "browser-home"
        home.mkdir(mode=0o700)
        environment = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(home), "XDG_CONFIG_HOME": str(home / "config"),
            "XDG_CACHE_HOME": str(home / "cache"), "XDG_DATA_HOME": str(home / "data"),
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
        }
        with output_path.open("wb") as stdout, error_path.open("wb") as stderr:
            process = subprocess.Popen(argv, cwd=native.runtime_path, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True, env=environment)
            timed_out = False
            try:
                code = process.wait(timeout=130)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=10)
                code = None
        self.acceptance.reporter.commands.append(CommandRecord(argv=argv, cwd=str(native.runtime_path), returnCode=code, durationSeconds=time.monotonic() - started))
        self.acceptance.reporter.log("browser-driver.stdout", output_path.read_text(errors="replace"))
        self.acceptance.reporter.log("browser-driver.stderr", error_path.read_text(errors="replace"))
        if timed_out:
            raise AssertionError("owned browser driver deadline exceeded")
        result: JsonObject = {}
        if result_path.is_file():
            self.acceptance.reporter.log("browser-result.json", result_path.read_text(errors="replace"))
            loaded = json.loads(result_path.read_text())
            if not isinstance(loaded, dict):
                raise AssertionError("browser driver result is not an object")
            result = loaded
        if code != 0:
            raise AssertionError(f"browser driver failed: {sanitize(str(result.get('failure', 'no result')))}")
        if code is None:
            raise AssertionError("browser driver terminated without a result")
        if result.get("checks") != EXPECTED_CHECKS or result.get("ok") is not True or not isinstance(result.get("runId"), str):
            raise AssertionError("browser driver did not complete every native UI check")
        run = native.owner.run(result["runId"])
        native.assert_publication("Github", run, "browser-first\n")

    def execute(self) -> int:
        native = self.acceptance
        try:
            try:
                native.start()
            except Exception as error:
                native.reporter.cases.append(CaseRecord(name="browser_native_setup", outcome="error", detail=sanitize(f"{type(error).__name__}: {error}")))
            else:
                native.reporter.case("browser_login_repo_rite_run_and_principal_change", self.run_browser)
        finally:
            try:
                native.close()
            except Exception as error:
                native.reporter.cases.append(CaseRecord(name="browser_owned_cleanup", outcome="error", detail=sanitize(f"{type(error).__name__}: {error}")))
            native.reporter.finish()
        return 1 if any(case.outcome != "passed" for case in native.reporter.cases) else 0


def main(arguments: list[str]) -> int:
    if len(arguments) != 6:
        print("usage: browser_native.py NATIVE_LAUNCHER WORKER_EXECUTABLE NATIVE_ELF WEB_ROOT NODE_MODULE_ROOT CHROMIUM", file=sys.stderr)
        return 2
    paths = [Path(value).resolve() for value in arguments]
    try:
        acceptance = BrowserNativeAcceptance(*paths)
    except Exception as error:
        print(sanitize(f"browser setup rejected: {type(error).__name__}: {error}"), file=sys.stderr)
        return 2
    return acceptance.execute()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
