import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

export default defineConfig(({ mode }) => ({
  plugins: [react(), wasm()],

  // Library build
  ...(mode === "lib" && {
    build: {
      emptyOutDir: false,
      lib: {
        entry: "src/index.ts",
        name: "TuiPreview",
        formats: ["es", "cjs"],
        fileName: (format) => `index.${format === "es" ? "js" : "cjs"}`,
      },
      rollupOptions: {
        external: ["react", "react/jsx-runtime", "react-dom"],
        output: {
          globals: {
            react: "React",
            "react-dom": "ReactDOM",
          },
        },
      },
    },
  }),

  // Dev server for the example
  ...(mode !== "lib" && {
    root: "example",
    build: {
      outDir: "../dist-example",
    },
  }),
}));
