### Environment

- **Sandbox detection**: Check `$SMIND_SANDBOXED` in your environment. When set to `1`, you are running inside a bubblewrap sandbox via the `yolo` wrapper and the sandbox-specific guidance below applies. When unset, you are running unsandboxed with the user's normal filesystem permissions — ignore the sandbox-specific workflow and write wherever the task requires.
- **Sandbox layout** (when `SMIND_SANDBOXED=1`): The sandbox grants access to the project directory, `/nix`, this user's exchange directory, and any configured binds. The exchange directory is the absolute path in `$SMIND_EXCHANGE_DIR` (a per-user directory on the host tmpfs, under `/tmp/exchange/<user>`, mode 0700). Writes to the project directory, that exchange directory, and explicitly bound read-write paths persist across sandbox sessions. The exchange directory does not survive a host reboot; sandbox `/tmp` is ephemeral even across sessions. `/tmp/exchange` itself is not mounted read-write and is not a place to put files.
- **Direct execution**: Always run project commands directly (compilation, tests, linting, git, formatting, etc.) — these work fine in or out of the sandbox. Only use the script workflow below for true sandbox escapes.
- **For system interaction** (when `SMIND_SANDBOXED=1`): Access explicitly bound paths directly. When you need to access `$HOME`, modify system configuration, or reach files outside granted binds, use this workflow:
  1. Read the exchange directory before writing anything. Run `printenv SMIND_EXCHANGE_DIR` and use the absolute path it prints. If it is unset or empty, this sandbox has no exchange directory (for example macOS Seatbelt) — stop and say so. Do not invent `/tmp/exchange`, `/tmp/exchange/$USER`, or any other path.
  2. Write a shell script to `{exchange}/{name}.sh`, where `{exchange}` is that absolute path copied verbatim. The user's unsandboxed shell does not have `SMIND_EXCHANGE_DIR`; every path inside the script and every command you ask the user to run must be the absolute path, never `$SMIND_EXCHANGE_DIR`.
  3. Script structure MUST be:
     ```bash
     #!/usr/bin/env bash
     set -euxo pipefail
     bat --paging=never "$0"  # Show script contents first
     read -p "Press Enter to run, Ctrl+C to abort..."
     # Your commands here, with output captured:
     command 2>&1 | tee {exchange}/{name}.out
     ```
  4. Ask user to run: `bash {exchange}/{name}.sh`.
  5. After user confirms execution, use Read tool to read `{exchange}/{name}.out`.
  6. NEVER proceed without reading the output file — it contains the information you need.
- **Verbose debug scripts**: Use `set -x` so the user can see commands together with output.
- **Nix environment**: Use `flake.nix` and `direnv` for dependencies.
- **Commands**: Use `direnv exec DIR COMMAND [...ARGS]` and `nix run`.
  - **Commands exception**: IFF your shell has a defined `DIRENV_DIR` env var, then you are already in a direnv environment, and you **DO NOT NEED TO** execute commands via `direnv exec DIR COMMAND [...ARGS]` syntax.
