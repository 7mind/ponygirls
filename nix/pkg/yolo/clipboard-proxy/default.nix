{ runCommandLocal, rustc, stdenv }:

runCommandLocal "yolo-clipboard-proxy" {
  nativeBuildInputs = [ rustc stdenv.cc ];
} ''
  install -Dm644 ${./main.rs} yolo/clipboard-proxy/main.rs
  install -Dm644 ${../../agent-notify/tmux-window-format.txt} agent-notify/tmux-window-format.txt
  mkdir -p "$out/bin" "$out/tmux-shim"
  rustc -C opt-level=2 -C debuginfo=0 -o "$out/bin/yolo-clipboard-proxy" \
    yolo/clipboard-proxy/main.rs
  ln -s ../bin/yolo-clipboard-proxy "$out/tmux-shim/tmux"
''
