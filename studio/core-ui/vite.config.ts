import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GRAFT Block Studio — Vite config. Vitest config lives in vitest.config.ts
// so `vite build` never pulls test-only globals into the app bundle.
//
// `/api` is proxied to the studio backend's default local address
// (`uvicorn studio.backend.api:app --reload --port 8100`, per api.py's own
// docstring) so the frontend's API client (src/api/client.ts) can use plain
// relative paths in dev, preview, and prod alike. Override the backend host
// with STUDIO_BACKEND_URL if it's not running on the default port.
const backendUrl = process.env.STUDIO_BACKEND_URL ?? "http://127.0.0.1:8100";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    proxy: {
      "/api": { target: backendUrl, changeOrigin: true },
    },
  },
  preview: {
    port: 5190,
    proxy: {
      "/api": { target: backendUrl, changeOrigin: true },
    },
  },
});
