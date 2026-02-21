import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TuiPreview } from "../src/index.js";

const GRADIENT_WASM = new URL("./gradient.wasm", import.meta.url);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TuiPreview
      wasm={GRADIENT_WASM}
      argv={({ cols, rows }) => {
        // Keep one spare row for the trailing newline and disable app-side border
        // so the preview reflects terminal sizing directly.
        const innerCols = Math.max(1, cols);
        const innerRows = Math.max(1, rows - 1);
        return ["Hello!", String(innerCols), String(innerRows), "--gradient", "diagonal", "--no-border"];
      }}
      fit="container"
      terminal={{
        fontSize: 14,
        theme: {
          background: "#1a1b26",
          foreground: "#a9b1d6",
        },
      }}
      style={{ width: "100%", height: "400px" }}
    />
  </StrictMode>
);
