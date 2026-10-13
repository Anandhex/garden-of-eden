import { resolve } from "node:path";
import { defineConfig } from "vite";

// `npm run dev` (repo root) runs this next to the game server; /api goes to the server.
const server = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

export default defineConfig({
  server: { port: Number(process.env.CLIENT_PORT ?? 5173), strictPort: true, proxy: { "/api": server } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Phaser is one big module; it's served locally, so its size is fine.
    chunkSizeWarningLimit: 2000,
    // Two pages: the game, and the admin view (N17), which the game's bundle never imports.
    rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), admin: resolve(import.meta.dirname, "admin.html") } },
  },
});
