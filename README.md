# MCP Bundle Setup

Kumpulan konfigurasi dan server MCP (Model Context Protocol) untuk Antigravity / Gemini CLI di Android Termux & Linux.

## 📦 Isi Server & Kemampuan

### 1. `token-saver` (Custom Server)
- **Code Graph & AST**: `index_repository`, `codebase_index`, `search_graph`, `code_outline`, `trace_call_path`, `detect_changes`, `code_blast_radius` (Hemat token hingga 90%).
- **Database SQLite**: `sqlite_query`, `sqlite_schema`.
- **Web Scraping & Reader**: `web_reader`, `scrape_web`.
- **REST & HTTP API Tester**: `api_request` (GET, POST, PUT, DELETE, custom headers, JSON payload).
- **Workspace Portabel**: Auto-detect directory kerja, fallback fleksibel via env `MCP_WORKSPACE` atau folder bot.

### 2. `memory`
Knowledge graph & persistent memory (`@modelcontextprotocol/server-memory`).

### 3. `sequential-thinking`
Dynamic reasoning & sequential problem-solving (`@modelcontextprotocol/server-sequential-thinking`).

---

## 🚀 Cara Pasang Ulang (Restore di Perangkat Baru)

```bash
git clone <URL_REPO_ANDA> ~/mcp-setup
cd ~/mcp-setup
bash install.sh
```

> [!NOTE]
> Setelah menjalankan `install.sh`, restart sesi terminal/CLI agent Anda agar semua skema tools MCP baru termuat secara otomatis.
