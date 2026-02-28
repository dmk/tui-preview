import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [react(), wasm()],
  root: "example",
  base: process.env.GITHUB_ACTIONS ? "/tui-preview/" : "/",
  build: {
    outDir: "../dist-example",
  },
});
