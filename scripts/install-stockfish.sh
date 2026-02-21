#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="${DEST_DIR:-bin}"
DEST_PATH="${DEST_DIR}/stockfish"
DOWNLOAD_URL="${STOCKFISH_DOWNLOAD_URL:-https://github.com/official-stockfish/Stockfish/releases/latest/download/stockfish-ubuntu-x86-64-avx2.tar}"

mkdir -p "$DEST_DIR"

if [[ -x "$DEST_PATH" ]]; then
  echo "Stockfish already installed at $DEST_PATH"
  exit 0
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Downloading Stockfish from $DOWNLOAD_URL"
curl -fsSL "$DOWNLOAD_URL" -o "$tmp_dir/stockfish.tar"
tar -xf "$tmp_dir/stockfish.tar" -C "$tmp_dir"

source_bin="$tmp_dir/stockfish/stockfish-ubuntu-x86-64-avx2"
if [[ ! -f "$source_bin" ]]; then
  echo "Could not find expected binary at $source_bin" >&2
  exit 1
fi

cp "$source_bin" "$DEST_PATH"
chmod +x "$DEST_PATH"
echo "Installed Stockfish to $DEST_PATH"
