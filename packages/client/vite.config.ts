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
  },
});
