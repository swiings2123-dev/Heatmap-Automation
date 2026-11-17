import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const api = "http://localhost:3000";

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 900 },
  // `npm run dev:ui` (HMR on :5173) proxies to the running server.
  server: { proxy: { "/api": api, "/tracker.js": api, "/demo": api } },
});
