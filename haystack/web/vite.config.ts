import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

function accountAssets(): Plugin {
  const root = process.env.ACCOUNT_WEB_ROOT === undefined ? fileURLToPath(new URL("../../shared/account-web/", import.meta.url)) : process.env.ACCOUNT_WEB_ROOT;
  const assets = ["account.js", "account.css"];
  return {
    name: "shared-account-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = new URL(request.url!, "http://localhost").pathname.slice(1);
        if (!assets.includes(name)) { next(); return; }
        response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : "text/css");
        response.end(readFileSync(join(root, name)));
      });
    },
    generateBundle() {
      for (const name of assets) this.emitFile({ type: "asset", fileName: name, source: readFileSync(join(root, name)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), accountAssets()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Deterministic asset names are content hashes; identical inputs give
    // identical outputs. Verified by rebuilding in Step 1 gate.
  },
  server: { port: 5173 },
});
