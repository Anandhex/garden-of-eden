import { createReadStream, existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// `npm run dev` (repo root) runs this next to the game server; /api goes to the server.
const server = `http://127.0.0.1:${process.env.PORT ?? 3000}`;

/** G5 recordings (`npm run frames:record`) at /recordings/<name>.jsonl, so `?replay=` works with no game server running. */
const recordings: Plugin = {
  name: "recordings",
  configureServer(dev) {
    dev.middlewares.use("/recordings", (req, res, next) => {
      const file = resolve(import.meta.dirname, "../../protocol/recordings", basename((req.url ?? "").split("?")[0]!));
      if (!file.endsWith(".jsonl") || !existsSync(file)) return next();
      res.setHeader("content-type", "application/x-ndjson");
      createReadStream(file).pipe(res);
    });
  },
};

export default defineConfig({
  plugins: [recordings],
  server: { port: Number(process.env.CLIENT_PORT ?? 5173), strictPort: true, proxy: { "/api": server, "/ws": { target: server.replace("http", "ws"), ws: true } } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Phaser is one big module; it's served locally, so its size is fine.
    chunkSizeWarningLimit: 2000,
    // Three pages: the game, the admin view (N17), which the game's bundle never imports, and the plain canvas adapter (G5).
    rollupOptions: { input: { main: resolve(import.meta.dirname, "index.html"), admin: resolve(import.meta.dirname, "admin.html"), canvas: resolve(import.meta.dirname, "canvas.html") } },
  },
});
