import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // Shown in Settings > App on the web, where there is no desktop updater to ask.
  define: { __APP_VERSION__: JSON.stringify(version) },
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // `npm run cf:dev` serves the Worker (API and realtime socket) on 8787.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:8787",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
});
