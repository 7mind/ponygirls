import { join } from "node:path";
import type { TestContext } from "node:test";

export function isolateAgentConfig(t: TestContext, root: string): string {
  const key = "PI_CODING_AGENT_DIR";
  const previous = process.env[key];
  const path = join(root, "agent-config");
  process.env[key] = path;
  t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  return path;
}

// The legacy CLI and badge tests exercise no saved settings.
export const emptySettingsContext = {
  isProjectTrusted: () => false,
  sessionManager: { getSessionId: () => "fixture", getEntries: () => [] },
};
