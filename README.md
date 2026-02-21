# tui-preview

Render `wasm32-wasi` terminal apps inside React with a clean, size-aware API.

## Install

```bash
npm install tui-preview
```

## Modern API (v1)

```tsx
import { TuiPreview } from "tui-preview";

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
- `fit?: "container" | "none"` (default: `"container"`)
  - `"container"`: auto-size from container.
  - `"none"`: fixed terminal size from `size`.
- `size?: { cols: number; rows: number }`
  - Required in practice for fixed mode; fallback/initial for container mode.
- `terminal?: { fontSize, fontFamily, theme, cursorBlink, convertEol }`
- `interactive?: boolean` (default: `true`)
- `env?: Record<string, string>`
- `onExit?: (code: number) => void`
- `onError?: (error: unknown) => void`
- `onStatusChange?: ("loading" | "running" | "exited" | "error") => void`

## Legacy Compatibility

Legacy props still work:

- `app`, `args`
- `cols`, `rows`
- `fontSize`, `fontFamily`, `theme`

They are translated internally to the modern API and emit a one-time deprecation warning.

## Notes

- Package exports:
  - `tui-preview` (React component + public types)
  - `tui-preview/core` (advanced internals)
- `ghostty-web` is pinned with semver (`^0.4.0`) for predictable behavior.
