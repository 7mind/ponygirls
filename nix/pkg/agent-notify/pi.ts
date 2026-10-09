import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";

export default function (pi: ExtensionAPI) {
  const notify = async (ctx: ExtensionContext, start: boolean): Promise<void> => {
    const payload = JSON.stringify({ session_id: ctx.sessionManager.getSessionId() });
    const args = start ? ["pi", "--start", payload] : ["pi", payload];
    await new Promise<void>((resolve, reject) => {
      execFile("@notifyCommand@", args, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  };
  pi.on("agent_start", async (_event, ctx) => notify(ctx, true));
  pi.on("agent_settled", async (_event, ctx) => notify(ctx, false));
}
