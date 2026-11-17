{ runCommand, nodejs, runtimeShell, pi-coding-agent, pi-claude-code }:
runCommand "pi-claude-code-load" {
  nativeBuildInputs = [ nodejs ];
} ''
  mkdir -p bin home
  export HOME=$PWD/home
  export XDG_CONFIG_HOME=$HOME/.config
  export BLOCKED_CALLS=$PWD/blocked-calls
  touch "$BLOCKED_CALLS"
  for command in git npm pnpm bun; do
    printf '#!%s\nprintf "%%s\\n" %s >> "$BLOCKED_CALLS"\nexit 97\n' ${runtimeShell} "$command" > "bin/$command"
    chmod +x "bin/$command"
  done
  export PATH=$PWD/bin:$PATH
  node ${./load-test.mjs} ${pi-coding-agent}/lib/node_modules/pi-monorepo ${pi-claude-code} ${./fake-cli.mjs} 2> load.stderr || {
    cat load.stderr >&2
    exit 1
  }
  if test -s load.stderr; then
    cat load.stderr >&2
    exit 1
  fi
  test ! -s "$BLOCKED_CALLS"
  touch "$out"
''
