#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMODULE_DIR="$ROOT_DIR/vendor/libghostty"

if [[ "$#" -gt 0 ]]; then
  OUT_PATHS=("$@")
else
  OUT_PATHS=(
    "$ROOT_DIR/example/public/ghostty-vt.wasm"
    "$ROOT_DIR/dist/ghostty-vt.wasm"
  )
fi

if ! command -v zig >/dev/null 2>&1; then
  echo "zig is required to build libghostty wasm. Install Zig and retry." >&2
  exit 1
fi

if [[ -z "${ZIG_GLOBAL_CACHE_DIR:-}" ]]; then
  export ZIG_GLOBAL_CACHE_DIR="$ROOT_DIR/.zig-global-cache"
fi

if [[ ! -d "$SUBMODULE_DIR" ]]; then
  echo "Missing submodule at $SUBMODULE_DIR" >&2
  echo "Run: git submodule update --init --recursive vendor/libghostty" >&2
  exit 1
fi

(
  cd "$ROOT_DIR"
  zig build \
    --build-file wasm/ghostty-vt/build.zig \
    wasm \
    --release=fast \
    -Dtarget=wasm32-freestanding
)

ARTIFACT=""
for candidate in \
  "$ROOT_DIR/wasm/ghostty-vt/zig-out/bin/ghostty-vt.wasm" \
  "$ROOT_DIR/wasm/ghostty-vt/zig-out/bin/ghostty-vt" \
  "$ROOT_DIR/wasm/ghostty-vt/zig-out/lib/ghostty-vt.wasm" \
  "$ROOT_DIR/wasm/ghostty-vt/zig-out/lib/libghostty-vt.wasm" \
  "$ROOT_DIR/zig-out/bin/ghostty-vt.wasm" \
  "$ROOT_DIR/zig-out/bin/ghostty-vt" \
  "$ROOT_DIR/zig-out/lib/ghostty-vt.wasm" \
  "$ROOT_DIR/zig-out/lib/libghostty-vt.wasm"
do
  if [[ -f "$candidate" ]]; then
    ARTIFACT="$candidate"
    break
  fi
done

if [[ -z "$ARTIFACT" ]]; then
  echo "Could not find built wasm artifact in $ROOT_DIR/wasm/ghostty-vt/zig-out or $ROOT_DIR/zig-out." >&2
  exit 1
fi

for out_path in "${OUT_PATHS[@]}"; do
  mkdir -p "$(dirname "$out_path")"
  cp "$ARTIFACT" "$out_path"
  echo "Built libghostty wasm -> $out_path"
done
