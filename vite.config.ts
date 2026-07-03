import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
  build: {
    chunkSizeWarningLimit: 3000,
  },
  server: {
    strictPort: true,
    port: 1420,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
