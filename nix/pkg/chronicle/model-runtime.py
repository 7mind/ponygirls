"""Runtime-only Chronicle weights, credential loading and vLLM readiness."""
import argparse
import fcntl
import hashlib
import json
import os
import grp
import pwd
import re
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import time
import urllib.error
import urllib.request


class ModelError(ValueError):
    pass


class ReadinessError(RuntimeError):
    pass


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def identity(spec):
    return hashlib.sha256(json.dumps(spec, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_spec(spec):
    if set(spec) != {"repository", "revision", "files"}:
        raise ModelError("Invalid weights specification")
    if len(spec["revision"]) != 40 or any(c not in "0123456789abcdef" for c in spec["revision"]):
        raise ModelError("Model revision must be a full lowercase commit SHA")
    names = spec["files"]
    if "config.json" not in names or "tokenizer_config.json" not in names:
        raise ModelError("Manifest requires model and tokenizer configuration")
    if not any(name in names for name in ("tokenizer.json", "tokenizer.model", "spiece.model", "vocab.json")):
        raise ModelError("Manifest requires tokenizer data")
    if not any(name.endswith((".safetensors", ".bin")) for name in names):
        raise ModelError("Manifest requires model weights")
    for name, checksum in spec["files"].items():
        shard = re.fullmatch(r"(.*)-[0-9]{5}-of-[0-9]{5}(\.safetensors|\.bin)", name)
        if shard is not None and shard[1] + shard[2] + ".index.json" not in names:
            raise ModelError("Sharded weights require their complete weight index in the manifest")
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or name != str(path) or name == ".complete.json":
            raise ModelError("Unsafe manifest path")
        if len(checksum) != 64 or any(c not in "0123456789abcdef" for c in checksum):
            raise ModelError("Manifest requires lowercase SHA256 checksums")


def check_files(directory, spec):
    if any(path.is_symlink() for path in directory.rglob("*")):
        raise ModelError("Symlinks are not permitted in model artifacts")
    for name, checksum in spec["files"].items():
        path = directory / name
        if not path.is_file() or path.is_symlink() or digest(path) != checksum:
            raise ModelError(f"Missing or corrupt model file: {name}")
    for name in spec["files"]:
        if name.endswith((".safetensors.index.json", ".bin.index.json")):
            index = json.loads((directory / name).read_text())
            if not index["weight_map"] or not set(index["weight_map"].values()) <= set(spec["files"]):
                raise ModelError("Weight index references shards absent from the manifest")
    expected = set(spec["files"]) | {".complete.json"}
    actual = {str(p.relative_to(directory)) for p in directory.rglob("*") if not p.is_dir()}
    if actual - expected:
        raise ModelError("Unexpected files in model artifact")


def verify(directory, spec):
    validate_spec(spec)
    if directory.is_symlink():
        raise ModelError("Model artifact must not be a symlink")
    marker = json.loads((directory / ".complete.json").read_text())
    if marker != spec:
        raise ModelError("Model artifact identity mismatch")
    check_files(directory, spec)


def provision(root, spec, fetch):
    validate_spec(spec)
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".download.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        final = root / identity(spec)
        if final.exists():
            verify(final, spec)
            return final
        staging = root / (identity(spec) + ".partial")
        staging.mkdir(exist_ok=True)
        if staging.is_symlink() or any(path.is_symlink() for path in staging.rglob("*")):
            raise ModelError("Unsafe symlink in model staging directory")
        for name, checksum in spec["files"].items():
            target = staging / name
            if target.is_file() and not target.is_symlink() and digest(target) == checksum:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            source = Path(fetch(name))
            if digest(source) != checksum:
                raise ModelError(f"Downloaded checksum mismatch: {name}")
            temporary = target.with_name(target.name + ".chronicle-download")
            shutil.copyfile(source, temporary)
            os.replace(temporary, target)
        check_files(staging, spec)
        marker = staging / ".complete.json"
        marker.write_text(json.dumps(spec, sort_keys=True))
        verify(staging, spec)
        os.rename(staging, final)
        return final


def credential(name):
    value = (Path(os.environ["CREDENTIALS_DIRECTORY"]) / name).read_text().strip()
    if "\n" in value or "\r" in value:
        raise ModelError("Credential must be a single line")
    return value


class NoReadinessRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ModelError("Loopback model readiness endpoint unexpectedly redirected")


def ready(url, model, key, timeout):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoReadinessRedirect())
    deadline = time.monotonic() + timeout
    headers = {"Authorization": "Bearer " + key} if key else {}
    while True:
        try:
            request = urllib.request.Request(url + "/health", headers=headers)
            with opener.open(request, timeout=5) as response:
                if response.status != 200:
                    raise ModelError("Model health check did not return 200")
            request = urllib.request.Request(url + "/v1/models", headers=headers)
            with opener.open(request, timeout=5) as response:
                data = json.loads(response.read(1048576))
            if model not in [entry["id"] for entry in data["data"]]:
                raise ModelError("vLLM served model identity mismatch")
            return
        except (urllib.error.URLError, TimeoutError) as error:
            if isinstance(error, urllib.error.HTTPError):
                error.close()
            if time.monotonic() >= deadline:
                raise ReadinessError("Timed out waiting for vLLM readiness") from None
            time.sleep(1)


def container_command(config, config_path, uid, gid, groups, credentials):
    directory = str(Path(config["root"]) / identity(config["weights"]))
    command = [config["podman"], "run", "--rm", "--replace", "--name", config["unit"],
               "--pull=missing", "--network=host", "--read-only", "--cap-drop=ALL",
               "--security-opt=no-new-privileges", "--user", f"{uid}:{gid}",
               "--ipc=private", "--shm-size=1g", "--tmpfs", "/tmp:rw,nosuid,nodev,mode=1777",
               "--entrypoint", "python3"]
    for group in groups:
        command.extend(["--group-add", str(group)])
    for device in config["devices"]:
        command.extend(["--device", "nvidia.com/gpu=" + device])
    mounts = [(directory, directory, "ro"), (config["cache"], config["cache"], "rw"),
              (config["helper"], config["helper"], "ro"), (config_path, config_path, "ro"),
              (config["vllmConfig"], config["vllmConfig"], "ro"), (credentials, credentials, "ro")]
    for source, target, mode in mounts:
        command.extend(["--volume", f"{source}:{target}:{mode}"])
    for name, value in config["environment"].items():
        command.extend(["--env", name + "=" + value])
    command.extend(["--env", "CREDENTIALS_DIRECTORY=" + credentials,
                    config["image"], config["helper"], "serve", config_path])
    return command


def stage_credential(runtime_directory, uid, gid, key):
    credentials = Path(runtime_directory) / "credentials"
    credentials.mkdir(mode=0o700, exist_ok=True)
    os.chown(credentials, uid, gid)
    target = credentials / "api-key"
    if target.exists():
        target.unlink()
    target.write_text(key)
    target.chmod(0o400)
    os.chown(target, uid, gid)
    return str(credentials)


def launch_container(config, config_path):
    verify(Path(config["root"]) / identity(config["weights"]), config["weights"])
    user = pwd.getpwnam(config["unit"])
    cache = Path(config["cache"]).lstat()
    if not stat.S_ISDIR(cache.st_mode) or cache.st_uid != user.pw_uid or cache.st_gid != user.pw_gid:
        raise ModelError("Model cache must already be a directory owned by the dedicated model user and group")
    credentials = stage_credential(config["runtime"], user.pw_uid, user.pw_gid, credential("api-key"))
    groups = [grp.getgrnam(name).gr_gid for name in ("video", "render")]
    command = container_command(config, config_path, user.pw_uid, user.pw_gid, groups, str(credentials))
    os.execv(command[0], command)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["fetch", "serve", "ready", "container"])
    parser.add_argument("config")
    args = parser.parse_args()
    config = json.loads(Path(args.config).read_text())
    spec = config["weights"]
    directory = Path(config["root"]) / identity(spec)
    if args.operation == "fetch":
        from huggingface_hub import hf_hub_download
        token = credential("hf-token") if config["hfToken"] else False
        if config["hfToken"] and not token:
            raise ModelError("Configured HF token credential is empty; remove hfTokenFile for public unauthenticated downloads")
        provision(Path(config["root"]), spec, lambda name: hf_hub_download(
            repo_id=spec["repository"], revision=spec["revision"], filename=name,
            cache_dir=str(Path(config["root"]) / "download-cache"), token=token,
        ))
    elif args.operation == "container":
        launch_container(config, args.config)
    elif args.operation == "serve":
        verify(directory, spec)
        key = credential("api-key")
        os.environ.pop("VLLM_API_KEY", None)
        if key:
            os.environ["VLLM_API_KEY"] = key
        os.execvp(config["executable"], [config["executable"], "serve", str(directory), "--config", config["vllmConfig"]])
    else:
        ready(config["url"], config["model"], credential("api-key"), config["readyTimeout"])


if __name__ == "__main__":
    try:
        main()
    except (ModelError, ReadinessError) as error:
        print(f"Chronicle model runtime failed: {error}", file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        # Do not echo HTTP exceptions, URLs or credentials from provider failures.
        print(f"Chronicle model runtime failed ({type(error).__name__})", file=sys.stderr)
        sys.exit(1)
