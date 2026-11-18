/**
 * The TUI transcript of a session, built by pi's own interactive-mode code
 * (entry order, spacing, retention of custom entries, the expand toggle)
 * without a terminal: InteractiveMode's transcript methods run on an object
 * that carries only the state they read.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const OUTPUT_PAD = 1;
/** SGR styling and OSC marks (pi brackets messages with OSC 133 zones). */
const TERMINAL_SEQUENCE = /\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07/g;

export async function loadTranscriptHost(root) {
  const load = (path) => import(pathToFileURL(join(root, path)).href);
  const { InteractiveMode } = await load("dist/modes/interactive/interactive-mode.js");
  const { initTheme } = await load("dist/modes/interactive/theme/theme.js");
  const { Container } = await load("node_modules/@earendil-works/pi-tui/dist/index.js");
  return { InteractiveMode, initTheme, Container };
}

/**
 * The session's transcript as interactive mode builds it on load, collapsed
 * or expanded; `keep` leaves entries out to compare what the others draw.
 */
export function buildTranscript(host, session, expanded, keep = () => true) {
  const mode = Object.create(host.InteractiveMode.prototype);
  Object.assign(mode, {
    runtimeHost: { session },
    chatContainer: new host.Container(),
    loadedResourcesContainer: new host.Container(),
    pendingMessagesContainer: new host.Container(),
    pendingTools: new Map(),
    outputPad: OUTPUT_PAD,
    toolOutputExpanded: expanded,
    hideThinkingBlock: false,
    hiddenThinkingLabel: "Thinking...",
    mermaidMarkdownTransformer: (markdown) => markdown,
    ui: { requestRender() {} },
    showStatus() {},
  });
  host.initTheme("dark");
  mode.renderSessionEntries(session.sessionManager.buildContextEntries().filter(keep));
  return {
    /** The global expand toggle (ctrl+o). */
    setExpanded: (value) => mode.setToolsExpanded(value),
    /** Rendered rows as the terminal receives them. */
    rows: (width) => mode.chatContainer.render(width),
    /** Rendered rows without styling, prompt-zone marks, or trailing padding. */
    lines: (width) => mode.chatContainer.render(width).map((line) => line.replace(TERMINAL_SEQUENCE, "").trimEnd()),
  };
}
