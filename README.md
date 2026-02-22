# tui-preview

Render `wasm32-wasi` terminal apps inside React with a clean, size-aware API.

## Install

```bash
npm install @dkkoval/tui-preview
```

Build libghostty wasm from the submodule before running the example:

```bash
npm run build:ghostty-wasm
```

This builds an external wasm wrapper (`wasm/ghostty-vt/build.zig` + `wasm/ghostty-vt/wrapper.zig`)
that imports Ghostty sources from `vendor/libghostty` without modifying submodule files.
The wrapper is intentionally minimal: ANSI parsing + viewport rendering + basic input responses.

By default this writes:
- `example/public/ghostty-vt.wasm` (dev/example)
- `dist/ghostty-vt.wasm` (library package asset)

## Modern API (v1)

```tsx
import { TuiPreview } from "@dkkoval/tui-preview";

function Demo() {
  return (
    <TuiPreview
      wasm={new URL("./gradient.wasm", import.meta.url)}
      argv={({ cols, rows }) => [
        "Hello!",
        String(cols),
        String(Math.max(1, rows - 1)),
        "--gradient",
        "diagonal",
        "--no-border",
      ]}
      fit="container"
      terminal={{
        fontSize: 14,
        fontFamily: "monospace",
        theme: {
          background: "#1a1b26",
          foreground: "#a9b1d6",
        },
      }}
      interactive
      style={{ width: "100%", height: 400 }}
    />
  );
}
```

## API

- `wasm: string | URL`
  - WASM entrypoint compiled for `wasm32-wasi`.
- `argv?: string[] | ((size) => string[])`
  - CLI args (without argv[0]).
  - For `fit="container"`, size is the fitted terminal size.
- `mode?: "interactive" | "static"` (default: `"interactive"`)
  - `"interactive"`: keyboard/mouse-enabled terminal surface.
  - `"static"`: non-interactive render surface.
- `fit?: "container" | "none"` (default: `"container"`)
  - `"container"`: auto-size from container.
  - `"none"`: fixed terminal size from `size`.
- `size?: { cols: number; rows: number }`
  - Required in practice for fixed mode; fallback/initial for container mode.
- `terminal?: { fontSize, fontFamily, theme, convertEol }`
  - `terminal.wasmUrl?: string | URL` (default: `"/ghostty-vt.wasm"`)
- `interactive?: boolean` (default: `true`)
- `env?: Record<string, string>`
- `onExit?: (code: number) => void`
- `onError?: (error: unknown) => void`
- `onStatusChange?: ("loading" | "running" | "exited" | "error") => void`

## Notes

- Package exports:
  - `@dkkoval/tui-preview` (React component + public types)
  - `@dkkoval/tui-preview/core` (advanced internals)
- libghostty source is tracked as a git submodule at `vendor/libghostty`.
