import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TuiPreview } from "../src/index.js";

const GRADIENT_WASM = new URL("./gradient.wasm", import.meta.url);
const COUNTER_WASM = new URL("./counter.wasm", import.meta.url);
const MINESWEEPER_WASM = new URL("./minesweeper.wasm", import.meta.url);

const terminal = {
  fontSize: 14,
  wasmUrl: `${import.meta.env.BASE_URL}ghostty-vt.wasm`,
  theme: { background: "#1a1b26", foreground: "#a9b1d6" },
} as const;

const previewStyle = { width: "100%", height: "400px" };

function Label({ name, mode }: { name: string; mode: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "0.5rem",
        marginBottom: "0.6rem",
      }}
    >
      <span style={{ fontSize: "0.95rem", fontWeight: 500, color: "#c0caf5" }}>
        {name}
      </span>
      <span
        style={{
          fontSize: "0.7rem",
          fontFamily: "'JetBrains Mono', monospace",
          color: "#565f89",
          background: "rgba(169, 177, 214, 0.06)",
          padding: "0.15em 0.5em",
          borderRadius: "4px",
        }}
      >
        {mode}
      </span>
    </div>
  );
}

function Demo({
  children,
  last,
}: {
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <section style={{ marginBottom: last ? 0 : "2rem" }}>
      {children}
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Demo>
      <Label name="Counter" mode="interactive" />
      <TuiPreview
        wasm={COUNTER_WASM}
        fit="container"
        mode="interactive"
        terminal={terminal}
        style={previewStyle}
      />
    </Demo>

    <Demo>
      <Label name="Minesweeper" mode="interactive" />
      <TuiPreview
        wasm={MINESWEEPER_WASM}
        fit="container"
        mode="interactive"
        terminal={terminal}
        style={previewStyle}
      />
    </Demo>

    <Demo last>
      <Label name="Gradient" mode="static" />
      <TuiPreview
        wasm={GRADIENT_WASM}
        argv={({ cols, rows }) => {
          const innerCols = Math.max(1, cols);
          const innerRows = Math.max(1, rows - 1);
          return [
            "Tui-Preview",
            String(innerCols),
            String(innerRows),
            "--gradient",
            "diagonal",
            "--no-border",
          ];
        }}
        fit="container"
        mode="static"
        terminal={terminal}
        style={previewStyle}
      />
    </Demo>
  </StrictMode>,
);
