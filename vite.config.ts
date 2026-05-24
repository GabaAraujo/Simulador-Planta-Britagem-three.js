import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    open: false,
  },
  build: {
    target: "es2020",
    sourcemap: true,
  },
});
