# Generic daemonless OCI (docker-format) image builder for the service
# binaries. dockerTools.buildLayeredImage writes the tarball without a docker
# daemon or socket, so this works in a sandbox without container privileges.
#
# Every image carries the service closure, CA roots, zoneinfo, busybox
# (/bin/sh for deployment-supplied scripts) and coreutils, plus a
# runtime-invariant /etc/passwd identity. It never carries host configuration
# or credentials: deployment configs and secrets are mounted by the caller.
{ lib, dockerTools, busybox, cacert, coreutils, tzdata }:
{
  # Image reference name (namespace/name). Keep the tag fixed so identical
  # inputs produce an identical tarball.
  name,
  tag ? "latest",
  # Extra contents. A bare "/nix/store/..." string is a first-deployment
  # reference to an already-built artifact and gets a store dependency edge.
  contents ? [ ],
  # Executable path inside the image, e.g. [ "/bin/haystack-server" ].
  entrypoint,
  # Default arguments; a deployment overrides them with command/args.
  cmd ? [ ],
  # Environment shared by every deployment. PATH, SSL_CERT_FILE, TZDIR and
  # LANG are fixed below and cannot be overridden.
  env ? { },
  uid ? 10001,
  gid ? 10001,
  userName ? "app",
  # Working directory baked into the image and owned by the service uid. A
  # deployment normally mounts persistent storage over it.
  workingDir ? "/data",
  # Flat directories created under workingDir (chowned to the service uid) so
  # a service that does not create its own subtrees can still start.
  workingSubdirs ? [ ],
  # dockerTools layer count: 2 keeps the tarball small and upload-friendly
  # (few blobs) at the cost of cross-image layer reuse.
  maxLayers ? 2,
  labels ? { },
  passthru ? { },
  meta ? { },
}:
let
  # fakeRootCommands run inside the layer directory, so every path there is
  # relative; only the image config may use the absolute working directory.
  workingDirRel = lib.removePrefix "/" workingDir;

  # A plain Nix string carries no dependency edge, so re-attach one before
  # the image closure is computed.
  toStoreRef = path: if builtins.isString path then builtins.storePath path else path;

  imageEnv = env // {
    PATH = "/bin";
    SSL_CERT_FILE = "${cacert}/etc/ssl/certs/ca-bundle.crt";
    TZDIR = "${tzdata}/share/zoneinfo";
    LANG = "C.UTF-8";
  };

  imageConfig = {
    User = "${toString uid}:${toString gid}";
    WorkingDirectory = workingDir;
    Entrypoint = entrypoint;
    Cmd = cmd;
    Env = lib.mapAttrsToList (key: value: "${key}=${value}") imageEnv;
    Labels = labels;
  };
in
assert lib.assertMsg
  (lib.hasPrefix "/" workingDir && workingDir != "/" && !(lib.hasInfix ".." workingDir))
  "mkServiceImage: workingDir must be an absolute path below / without .. (got ${workingDir})";
dockerTools.buildLayeredImage {
  inherit name tag maxLayers;

  contents = [ busybox cacert coreutils tzdata ] ++ map toStoreRef contents;

  config = imageConfig;

  # Escape hatch for ownership and directory modes a symlink forest cannot
  # express: some runtimes resolve the numeric uid through getpwuid, /tmp must
  # stay world-writable when a deployment does not mount one, and /bin/sh must
  # exist for deployment-supplied scripts.
  fakeRootCommands = ''
    mkdir -p bin etc tmp '${workingDirRel}'
    ln -sfn busybox bin/sh
    cat > etc/passwd <<'PASSWD'
    root:x:0:0:root:/root:/bin/sh
    ${userName}:x:${toString uid}:${toString gid}:${userName}:${workingDir}:/bin/sh
    PASSWD
    cat > etc/group <<'GROUP'
    root:x:0:
    ${userName}:x:${toString gid}:
    GROUP
    chown 0:0 etc etc/passwd etc/group
    chmod 0644 etc/passwd etc/group
    chmod 1777 tmp
    chown ${toString uid}:${toString gid} '${workingDirRel}'
    chmod 0775 '${workingDirRel}'
    ${lib.concatMapStrings (subdir: ''
      mkdir -p '${workingDirRel}/${subdir}'
      chown ${toString uid}:${toString gid} '${workingDirRel}/${subdir}'
      chmod 0775 '${workingDirRel}/${subdir}'
    '') workingSubdirs}
  '';

  passthru = passthru // { inherit imageConfig; };
  inherit meta;
}
