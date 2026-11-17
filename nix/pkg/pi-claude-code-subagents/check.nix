{ runCommand, nodejs, runtimeShell, pi-coding-agent, pi-claude-code, pi-claude-code-subagents, ponygirls-pi-extensions }:
runCommand "pi-claude-code-subagents-composition" {
  nativeBuildInputs = [ nodejs ];
  PI_SUBAGENTS_SDK_ROOT = "${pi-coding-agent}/lib/node_modules/pi-monorepo";
  PI_SUBAGENTS_CLAUDE_PACKAGE = pi-claude-code;
  PI_SUBAGENTS_CLAUDE_FIXTURE = ../pi-claude-code/fake-cli.mjs;
  PI_CLAUDE_SUBAGENTS_PACKAGE = pi-claude-code-subagents;
  PI_SUBAGENTS_EXTENSION = "${ponygirls-pi-extensions}/ponygirls-subagents";
  PI_OFFLINE = "1";
  PI_TELEMETRY = "0";
} ''
  mkdir -p bin home transport-ownership
  export HOME=$PWD/home
  export XDG_CONFIG_HOME=$HOME/.config
  export BLOCKED_CALLS=$PWD/blocked-calls
  touch "$BLOCKED_CALLS"
  for command in git npm pnpm bun; do
    printf '#!%s\nprintf "%%s\\n" %s >> "$BLOCKED_CALLS"\nexit 97\n' ${runtimeShell} "$command" > "bin/$command"
    chmod +x "bin/$command"
  done
  export PATH=$PWD/bin:$PATH
  if grep -R -n -E 'pi-claude-code|native-(service|proxy|framing|stream|contract)' "$PI_SUBAGENTS_EXTENSION/src" "$PI_SUBAGENTS_EXTENSION/index.ts"; then
    echo 'shared subagents source imports an addon-specific implementation' >&2
    exit 1
  fi
  test ! -e "$PI_CLAUDE_SUBAGENTS_PACKAGE/executor/provider.ts"
  test ! -e "$PI_CLAUDE_SUBAGENTS_PACKAGE/executor/model-catalog.ts"
  test ! -e "$PI_CLAUDE_SUBAGENTS_PACKAGE/executor/index.ts"
  test ! -e "$PI_CLAUDE_SUBAGENTS_PACKAGE/node_modules"
  cd transport-ownership
  node --experimental-transform-types --disable-warning=ExperimentalWarning ${./load-test.mjs} "$PI_SUBAGENTS_SDK_ROOT" "$PI_SUBAGENTS_CLAUDE_PACKAGE" "$PI_SUBAGENTS_CLAUDE_FIXTURE" "$PI_CLAUDE_SUBAGENTS_PACKAGE" > ../ownership.log 2> ../ownership.stderr || {
    cat ../ownership.log ../ownership.stderr >&2
    exit 1
  }
  cd ..
  test ! -s ownership.stderr
  export PI_COMPOSITION_OBSERVATION_PATH=$PWD/stock-observations.json
  node --experimental-transform-types --disable-warning=ExperimentalWarning --test ${./composition.test.mjs} > composition.log 2>&1 || {
    cat composition.log >&2
    exit 1
  }
  cat ownership.log composition.log
  test ! -s "$BLOCKED_CALLS"
  mkdir -p "$out"
  cp ownership.log composition.log stock-observations.json "$out/"
''
