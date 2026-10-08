import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Deterministic asset names are content hashes; identical inputs give
    // identical outputs. Verified by rebuilding in Step 1 gate.
  },
  server: { port: 5173 },
});
