#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for example in counter minesweeper; do
  echo "Building $example..."
  cargo build \
    --release \
    --target wasm32-wasip1 \
    --manifest-path "$ROOT_DIR/example/$example/Cargo.toml"

  cp "$ROOT_DIR/example/$example/target/wasm32-wasip1/release/$example.wasm" \
     "$ROOT_DIR/example/$example.wasm"

  echo "Built -> example/$example.wasm"
done
