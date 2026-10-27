#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_CONFIG_DIR="$HOME/.gemini/config"
TARGET_MCP_DIR="$HOME/.gemini/mcp-servers/lightweight-tools"
TARGET_PLUGINS_DIR="$HOME/.gemini/config/plugins"

WITH_SUPERPOWERS=false
for arg in "$@"; do
  case "$arg" in
    --with-superpowers|-s)
      WITH_SUPERPOWERS=true
      ;;
  esac
done

if [ "$ENV_WITH_SUPERPOWERS" = "1" ] || [ "$ENV_WITH_SUPERPOWERS" = "true" ]; then
  WITH_SUPERPOWERS=true
fi

echo "› [1/5] Memeriksa dependensi sistem (sqlite3, ripgrep, git)..."
MISSING_PKGS=""
command -v sqlite3 >/dev/null 2>&1 || MISSING_PKGS="$MISSING_PKGS sqlite"
command -v rg >/dev/null 2>&1 || MISSING_PKGS="$MISSING_PKGS ripgrep"
command -v git >/dev/null 2>&1 || MISSING_PKGS="$MISSING_PKGS git"

if [ -n "$MISSING_PKGS" ]; then
  echo "  Memasang paket sistem yang belum ada:$MISSING_PKGS..."
  if command -v pkg >/dev/null 2>&1; then
    pkg install -y $MISSING_PKGS
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y sqlite3 ripgrep git
  else
    echo "⚠️ Peringatan: Harap install paket berikut secara manual:$MISSING_PKGS"
  fi
else
  echo "  ✓ Dependensi sistem (sqlite3, ripgrep, git) siap."
fi

echo "› [2/5] Menginstall paket MCP global via npm..."
npm install -g @modelcontextprotocol/server-memory @modelcontextprotocol/server-sequential-thinking

echo "› [3/5] Menyiapkan direktori target..."
mkdir -p "$TARGET_CONFIG_DIR"
mkdir -p "$TARGET_MCP_DIR"
mkdir -p "$TARGET_PLUGINS_DIR"

echo "› [4/5] Menyalin source code custom MCP (token-saver v2.5.0)..."
if [ -f "$SCRIPT_DIR/AGENTS.md" ]; then
  cp "$SCRIPT_DIR/AGENTS.md" "$HOME/AGENTS.md"
fi
cp -r "$SCRIPT_DIR/lightweight-tools/server.js" "$TARGET_MCP_DIR/"
cp -r "$SCRIPT_DIR/lightweight-tools/package.json" "$TARGET_MCP_DIR/"
if [ -f "$SCRIPT_DIR/lightweight-tools/package-lock.json" ]; then
  cp "$SCRIPT_DIR/lightweight-tools/package-lock.json" "$TARGET_MCP_DIR/"
fi
if [ -f "$SCRIPT_DIR/lightweight-tools/instructions.md" ]; then
  cp "$SCRIPT_DIR/lightweight-tools/instructions.md" "$TARGET_MCP_DIR/"
fi

echo "  Menginstall dependensi lokal lightweight-tools..."
cd "$TARGET_MCP_DIR"
npm install --omit=dev

echo "  Menyinkronkan skema tool MCP untuk Antigravity CLI..."
SCHEMA_DIR="$HOME/.gemini/antigravity-cli/mcp/token-saver"
mkdir -p "$SCHEMA_DIR"
DUMP_SCHEMAS=1 DUMP_SCHEMAS_DIR="$SCHEMA_DIR" node server.js >/dev/null 2>&1 || true
if [ -f "$SCRIPT_DIR/lightweight-tools/instructions.md" ]; then
  cp "$SCRIPT_DIR/lightweight-tools/instructions.md" "$SCHEMA_DIR/"
fi

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

# -----------------------------------------------------------------------------
# Optional: Superpowers Plugin Installation
# -----------------------------------------------------------------------------
if [ "$WITH_SUPERPOWERS" = true ]; then
  echo ""
  echo "⚡ [OPSIONAL] Memasang plugin Superpowers (obra/superpowers)..."
  SUPERPOWERS_DIR="$TARGET_PLUGINS_DIR/superpowers"
  if [ -d "$SUPERPOWERS_DIR/.git" ]; then
    echo "  Memperbarui repository superpowers..."
    git -C "$SUPERPOWERS_DIR" pull --ff-only || true
  else
    echo "  Mengkloning repository superpowers..."
    git clone --depth 1 https://github.com/obra/superpowers.git "$SUPERPOWERS_DIR"
  fi

  # Enable in ~/.gemini/config/config.json
  CONFIG_JSON="$TARGET_CONFIG_DIR/config.json"
  "$NODE_BIN" -e '
    const fs = require("fs");
    const p = process.argv[1];
    let data = { plugins: {} };
    if (fs.existsSync(p)) {
      try { data = JSON.parse(fs.readFileSync(p, "utf-8")); } catch {}
    }
    data.plugins = data.plugins || {};
    data.plugins.superpowers = data.plugins.superpowers || {};
    data.plugins.superpowers.enabled = true;
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  ' "$CONFIG_JSON"
  echo "  ✓ Plugin Superpowers aktif dan siap digunakan."
fi

echo ""
echo "✦ Instalasi Selesai! Seluruh server MCP (memory, sequential-thinking, token-saver v2.5.0) aktif."
if [ "$WITH_SUPERPOWERS" = true ]; then
  echo "✦ Plugin Superpowers terpasang! Agent kini memiliki skill TDD, debugging sistematis, dan multi-agent."
else
  echo "💡 Tips: Jalankan 'bash install.sh --with-superpowers' untuk mengaktifkan metodologi agen tingkat lanjut."
fi
