# makeWrapper arguments that supply ponygirls-bg-tasks' runtime executables to
# the pi process: the stdlib-only supervisor interpreter and the shell that
# runs task commands (`bash --noprofile --norc -c`). Shared by the Home Manager
# pi wrapper and the packaged flake check, so both run the same executables.
{ lib, python3, bash }:
lib.escapeShellArgs [
  "--set-default" "PI_BG_TASKS_PYTHON" "${python3}/bin/python3"
  "--set-default" "PI_BG_TASKS_SHELL" "${bash}/bin/bash"
]
