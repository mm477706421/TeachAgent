import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "pages" ? process.env.PAGES_BASE_PATH || "/TeachAgent/" : "/",
  build: {
    outDir: mode === "pages" ? "dist-pages" : "dist",
    rollupOptions: { output: { manualChunks: { charts: ["recharts"] } } },
  },
  server: {
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
  },
}));
