import test from "node:test";
import assert from "node:assert/strict";
import { resolveTuiPreviewProps } from "../dist/core/index.js";

test("modern props resolve with container fit defaults", () => {
  const resolved = resolveTuiPreviewProps({
    wasm: "demo.wasm",
  });

  assert.equal(resolved.wasm, "demo.wasm");
  assert.equal(resolved.fit, "container");
  assert.deepEqual(resolved.size, { cols: 80, rows: 24 });
  assert.equal(resolved.interactive, true);
  assert.equal(resolved.mode, "interactive");
  assert.equal(resolved.resolveArgv({ cols: 10, rows: 4 }).length, 0);
});

test("static mode is non-interactive and keeps modern terminal options", () => {
  const resolved = resolveTuiPreviewProps({
    wasm: "demo.wasm",
    argv: ({ cols, rows }) => [String(cols), String(rows)],
    mode: "static",
    fit: "none",
    size: { cols: 90, rows: 30 },
    interactive: true,
    terminal: {
      fontSize: 20,
      convertEol: false,
    },
  });

  assert.equal(resolved.wasm, "demo.wasm");
  assert.equal(resolved.mode, "static");
  assert.equal(resolved.fit, "none");
  assert.deepEqual(resolved.size, { cols: 90, rows: 30 });
  assert.equal(resolved.terminal.fontSize, 20);
  assert.equal(resolved.terminal.convertEol, false);
  assert.equal(resolved.interactive, false);
  assert.deepEqual(resolved.resolveArgv({ cols: 5, rows: 2 }), ["5", "2"]);
});
