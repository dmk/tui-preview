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
  assert.equal(resolved.resolveArgv({ cols: 10, rows: 4 }).length, 0);
  assert.equal(resolved.usedLegacyProps, false);
});

test("legacy props resolve to fixed fit", () => {
  const resolved = resolveTuiPreviewProps({
    app: "legacy.wasm",
    args: ({ cols, rows }) => [String(cols), String(rows)],
    cols: 90,
    rows: 30,
    fontSize: 20,
    interactive: false,
  });

  assert.equal(resolved.wasm, "legacy.wasm");
  assert.equal(resolved.fit, "none");
  assert.deepEqual(resolved.size, { cols: 90, rows: 30 });
  assert.equal(resolved.terminal.fontSize, 20);
  assert.equal(resolved.interactive, false);
  assert.deepEqual(resolved.resolveArgv({ cols: 5, rows: 2 }), ["5", "2"]);
  assert.equal(resolved.usedLegacyProps, true);
});
