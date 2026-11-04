"""Inspect docker-format image tarballs produced by dockerTools.buildLayeredImage.

Reads the image config JSON and replays layer members (mode/uid/gid and small
file contents) without extracting anything, then checks the per-image
expectations supplied as JSON.

Expectation contract (one object per image):
  image       path to the .tar.gz
  user        config.User
  workingDir  config.WorkingDir
  entrypoint  config.Entrypoint
  cmd         config.Cmd
  env         subset of the image environment
  uid, gid    expected owner of /data
  userName    /etc/passwd identity name
  subdirs     expected owned directories under /data
"""
import json
import sys
import tarfile

SMALL_FILE = 8192


def load(image_tar):
    with tarfile.open(image_tar, "r:*") as outer:
        manifest = json.load(outer.extractfile("manifest.json"))[0]
        config = json.load(outer.extractfile(manifest["Config"]))["config"]
        tree, blobs = {}, {}
        for layer in manifest["Layers"]:
            with tarfile.open(fileobj=outer.extractfile(layer), mode="r:*") as layer_tar:
                for member in layer_tar.getmembers():
                    name = member.name.lstrip("./")
                    if not name:
                        continue
                    tree[name] = {
                        "mode": member.mode,
                        "uid": member.uid,
                        "gid": member.gid,
                        "dir": member.isdir(),
                        "sym": member.issym(),
                        "link": member.linkname,
                    }
                    if member.isfile() and member.size < SMALL_FILE:
                        blobs[name] = layer_tar.extractfile(member).read()
    return config, tree, blobs


def image_env(config):
    env = {}
    for entry in config.get("Env") or []:
        key, _, value = entry.partition("=")
        env[key] = value
    return env


def main(spec_path):
    specifications = json.load(open(spec_path, encoding="utf-8"))
    for name, want in specifications.items():
        config, tree, blobs = load(want["image"])
        where = f"{name}: "
        assert config["User"] == want["user"], where + f"User {config['User']!r}"
        # Docker's field is WorkingDir; a misspelled key is silently ignored
        # by runtimes, so assert the exact config schema.
        assert set(config) == {"Cmd", "Entrypoint", "Env", "Labels", "User", "WorkingDir"}, (
            where + f"unexpected config keys {sorted(config)}"
        )
        assert config["WorkingDir"] == want["workingDir"], where + f"WorkingDir {config['WorkingDir']!r}"
        assert config["Entrypoint"] == want["entrypoint"], where + f"Entrypoint {config['Entrypoint']!r}"
        assert config["Cmd"] == want["cmd"], where + f"Cmd {config['Cmd']!r}"
        env = image_env(config)
        for key, value in want["env"].items():
            assert env.get(key) == value, where + f"env {key}={env.get(key)!r} != {value!r}"
        # Every image carries CA roots, zoneinfo and a fixed PATH: the
        # entrypoint scripts resolve their binaries from /bin only.
        assert env["PATH"] == "/bin", where + "PATH"
        assert env["SSL_CERT_FILE"].endswith("/etc/ssl/certs/ca-bundle.crt"), where + "SSL_CERT_FILE"
        assert env["TZDIR"].endswith("/share/zoneinfo"), where + "TZDIR"
        assert tree.get("etc/ssl/certs/ca-bundle.crt", {}).get("dir") is False, where + "CA bundle missing"
        # Runtime layout: an owned writable data directory, world-writable
        # /tmp (deployments may not mount one), and a resolvable identity for
        # the numeric uid the config declares.
        assert tree["tmp"]["dir"] and tree["tmp"]["mode"] & 0o7777 == 0o1777, where + "/tmp not 1777"
        data = tree["data"]
        assert data["dir"], where + "/data is not a directory"
        assert (data["uid"], data["gid"]) == (want["uid"], want["gid"]), where + "/data owner"
        assert data["mode"] & 0o777 == 0o775, where + "/data mode"
        for subdir in want["subdirs"]:
            entry = tree[f"data/{subdir}"]
            assert entry["dir"], where + f"/data/{subdir} is not a directory"
            assert (entry["uid"], entry["gid"]) == (want["uid"], want["gid"]), where + f"/data/{subdir} owner"
        # /bin/sh for deployment-supplied scripts, dispatched by busybox.
        shell = tree["bin/sh"]
        assert shell["sym"] and shell["link"] == "busybox", where + "/bin/sh is not the busybox symlink"
        assert not tree["bin/busybox"]["dir"], where + "busybox binary missing"
        passwd = blobs.get("etc/passwd", b"").decode()
        assert f"{want['userName']}:x:{want['uid']}:{want['gid']}" in passwd, where + "/etc/passwd identity"
        entrypoint = want["entrypoint"][0].lstrip("/")
        assert entrypoint in tree, where + f"entrypoint {entrypoint} missing"
        assert tree[entrypoint]["mode"] & 0o111, where + "entrypoint not executable"
        # No host configuration, credentials or homes may be baked in; the
        # deployment supplies those through mounts.
        for forbidden in ("run/secrets", "run/credentials", "etc/nixos", "etc/ssh", "home", "root/.ssh"):
            assert not any(path == forbidden or path.startswith(forbidden + "/") for path in tree), (
                where + f"image embeds {forbidden}"
            )
    print(f"{len(specifications)} image layouts ok")


if __name__ == "__main__":
    main(sys.argv[1])
