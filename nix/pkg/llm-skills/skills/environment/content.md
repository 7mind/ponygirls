### Environment

- **Sandbox detection**: Check `$SMIND_SANDBOXED` in your environment. When set to `1`, you are running inside a bubblewrap sandbox via the `yolo` wrapper and the sandbox-specific guidance below applies. When unset, you are running unsandboxed with the user's normal filesystem permissions — ignore the sandbox-specific workflow and write wherever the task requires.
- **Sandbox layout** (when `SMIND_SANDBOXED=1`): The sandbox grants access to the project directory, `/nix`, this user's exchange directory, and any configured binds. The exchange directory is the absolute path in `$SMIND_EXCHANGE_DIR` (a per-user directory on the host tmpfs, under `/tmp/exchange/<user>`, mode 0700). Writes to the project directory, that exchange directory, and explicitly bound read-write paths persist across sandbox sessions. The exchange directory does not survive a host reboot; sandbox `/tmp` is ephemeral even across sessions. `/tmp/exchange` itself is not mounted read-write and is not a place to put files.
- **Direct execution**: Always run project commands directly (compilation, tests, linting, git, formatting, etc.) — these work fine in or out of the sandbox. Only use the script workflow below for true sandbox escapes.
- **For system interaction** (when `SMIND_SANDBOXED=1`): Access explicitly bound paths directly. When you need to access `$HOME`, modify system configuration, or reach files outside granted binds, use this workflow:
  1. Read the exchange directory before writing anything. Run `printenv SMIND_EXCHANGE_DIR` and use the absolute path it prints. If it is unset or empty, this sandbox has no exchange directory (for example macOS Seatbelt) — stop and say so. Do not invent `/tmp/exchange`, `/tmp/exchange/$USER`, or any other path.
  2. Write a shell script to `{exchange}/{name}.sh`, where `{exchange}` is that absolute path copied verbatim. Choose a fresh, unique `{name}` for every attempt, including retries; verify its `.out` and `.done` files do not already exist. The user's unsandboxed shell does not have `SMIND_EXCHANGE_DIR`; every path inside the script and every command you ask the user to run must be the absolute path, never `$SMIND_EXCHANGE_DIR`.
  3. Script structure MUST be:
     ```bash
     #!/usr/bin/env bash
     set -euxo pipefail
     : > "{exchange}/{name}.out"
     trap 'status=$?; printf "\nexit_status=%s\n" "$status" >> "{exchange}/{name}.out"; touch -- "{exchange}/{name}.done"' EXIT
     trap 'exit 129' HUP
     trap 'exit 130' INT
     trap 'exit 143' TERM
     bat --paging=never "$0"  # Show script contents first
     read -p "Press Enter to run, Ctrl+C to abort..."
     # Your commands here, with output captured:
     command 2>&1 | tee -a "{exchange}/{name}.out"
     ```
     The `EXIT` trap writes the exit status before touching the completion marker, including on command failure or prompt cancellation; the signal handlers ensure interruptions record a nonzero status. `.done` means the script finished, NOT that it succeeded. Keep all host commands synchronous and capture each command's output with `tee -a`, so the marker cannot precede unfinished work or overwrite earlier output. Uncatchable termination (such as `SIGKILL`) cannot create a marker; if the script is killed that way, use explicit user input to report it and stop the watcher.
  4. **When background tasks are available**, arm a completion-notifying watcher BEFORE asking the user to run the script. Use the available background-task tool, not a detached shell process; the latter cannot wake an idle agent. For `bg_task`, substitute the same absolute paths and unique name in:
     ```json
     {
       "action": "spawn",
       "label": "exchange {name}",
       "command": "while [ ! -f \"{exchange}/{name}.done\" ]; do sleep 1; done",
       "cwd": "{exchange}",
       "notify": true
     }
     ```
     Record the returned task ID and its script/marker paths. An equivalent tool must also notify the agent and start a continuation when the watcher exits. If watcher launch fails, report the failure and explicitly use the user-confirmation fallback below; do not claim automatic resumption is armed.
  5. Ask the user to run: `bash "{exchange}/{name}.sh"`. Never execute the host script yourself. If the watcher is armed, say that execution will resume automatically; continue independent work or end the turn while waiting, without blocking on a foreground sleep/poll loop. **When background tasks are unavailable**, ask the user to confirm execution as in the existing protocol.
  6. On the matching watcher completion, automatically resume WITHOUT waiting for user input: verify that `{exchange}/{name}.done` exists and use the Read tool to read `{exchange}/{name}.out`. Without a watcher, read the output after the user confirms execution. In either case, check the recorded `exit_status`; do not treat watcher exit 0 or marker existence as host-command success. A failed/terminated watcher or missing marker is not proof of script completion. Stop obsolete watchers when an exchange request is cancelled or replaced.
  7. NEVER proceed with dependent work without reading the output file and checking its exit status — it contains the information you need. Report failures or cancellation instead of assuming the requested host action succeeded.
- **Verbose debug scripts**: Use `set -x` so the user can see commands together with output.
- **Nix environment**: Use `flake.nix` and `direnv` for dependencies.
- **Commands**: Use `direnv exec DIR COMMAND [...ARGS]` and `nix run`.
  - **Commands exception**: IFF your shell has a defined `DIRENV_DIR` env var, then you are already in a direnv environment, and you **DO NOT NEED TO** execute commands via `direnv exec DIR COMMAND [...ARGS]` syntax.
