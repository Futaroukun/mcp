#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_CONFIG_DIR="$HOME/.gemini/config"
TARGET_MCP_DIR="$HOME/.gemini/mcp-servers/lightweight-tools"

echo "› [1/4] Menginstall paket MCP global..."
npm install -g @modelcontextprotocol/server-memory @modelcontextprotocol/server-sequential-thinking

echo "› [2/4] Membuat direktori konfigurasi..."
mkdir -p "$TARGET_CONFIG_DIR"
mkdir -p "$TARGET_MCP_DIR"

echo "› [3/4] Menyalin source code custom MCP..."
cp -r "$SCRIPT_DIR/lightweight-tools/server.js" "$TARGET_MCP_DIR/"
cp -r "$SCRIPT_DIR/lightweight-tools/package.json" "$TARGET_MCP_DIR/"
if [ -f "$SCRIPT_DIR/lightweight-tools/package-lock.json" ]; then
  cp "$SCRIPT_DIR/lightweight-tools/package-lock.json" "$TARGET_MCP_DIR/"
fi

cd "$TARGET_MCP_DIR"
npm install --omit=dev

echo "› [4/4] Menyesuaikan konfigurasi mcp_config.json..."
GLOBAL_PREFIX="$(npm root -g)"

cat << EOF > "$TARGET_CONFIG_DIR/mcp_config.json"
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": [
        "--no-warnings",
        "$GLOBAL_PREFIX/@modelcontextprotocol/server-memory/dist/index.js"
      ]
    },
    "sequential-thinking": {
      "command": "node",
      "args": [
        "--no-warnings",
        "$GLOBAL_PREFIX/@modelcontextprotocol/server-sequential-thinking/dist/index.js"
      ]
    },
    "token-saver": {
      "command": "node",
      "args": [
        "--no-warnings",
        "$TARGET_MCP_DIR/server.js"
      ]
    }
  }
}
EOF

echo "✦ Sukses! MCP berhasil dipasang di $TARGET_CONFIG_DIR/mcp_config.json"
