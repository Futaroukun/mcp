#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_CONFIG_DIR="$HOME/.gemini/config"
TARGET_MCP_DIR="$HOME/.gemini/mcp-servers/lightweight-tools"

echo "› [1/5] Memeriksa dependensi sistem (sqlite3)..."
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "  sqlite3 belum terpasang. Mencoba menginstall..."
  if command -v pkg >/dev/null 2>&1; then
    pkg install -y sqlite
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y sqlite3
  else
    echo "⚠️ Peringatan: sqlite3 tidak ditemukan. Harap install sqlite3 secara manual."
  fi
else
  echo "  ✓ sqlite3 sudah terpasang."
fi

echo "› [2/5] Menginstall paket MCP global via npm..."
npm install -g @modelcontextprotocol/server-memory @modelcontextprotocol/server-sequential-thinking

echo "› [3/5] Menyiapkan direktori target..."
mkdir -p "$TARGET_CONFIG_DIR"
mkdir -p "$TARGET_MCP_DIR"

echo "› [4/5] Menyalin source code custom MCP (token-saver)..."
cp -r "$SCRIPT_DIR/lightweight-tools/server.js" "$TARGET_MCP_DIR/"
cp -r "$SCRIPT_DIR/lightweight-tools/package.json" "$TARGET_MCP_DIR/"
if [ -f "$SCRIPT_DIR/lightweight-tools/package-lock.json" ]; then
  cp "$SCRIPT_DIR/lightweight-tools/package-lock.json" "$TARGET_MCP_DIR/"
fi

echo "  Menginstall dependensi local lightweight-tools..."
cd "$TARGET_MCP_DIR"
npm install --omit=dev

echo "› [5/5] Membuat konfigurasi mcp_config.json..."
GLOBAL_PREFIX="$(npm root -g)"
NODE_BIN="$(command -v node)"

cat << EOF > "$TARGET_CONFIG_DIR/mcp_config.json"
{
  "mcpServers": {
    "memory": {
      "command": "$NODE_BIN",
      "args": [
        "--no-warnings",
        "$GLOBAL_PREFIX/@modelcontextprotocol/server-memory/dist/index.js"
      ]
    },
    "sequential-thinking": {
      "command": "$NODE_BIN",
      "args": [
        "--no-warnings",
        "$GLOBAL_PREFIX/@modelcontextprotocol/server-sequential-thinking/dist/index.js"
      ]
    },
    "token-saver": {
      "command": "$NODE_BIN",
      "args": [
        "--no-warnings",
        "$TARGET_MCP_DIR/server.js"
      ]
    }
  }
}
EOF

echo "✦ Selesai! Semua MCP (memory, sequential-thinking, token-saver) aktif dan siap digunakan."
