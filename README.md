# ⚡ High-Performance MCP Bundle for Termux & Linux

[![Platform](https://img.shields.io/badge/Platform-Android%20Termux%20%7C%20Linux-green.svg)](https://termux.dev)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933.svg?logo=node.js)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20(MCP)-blue.svg)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)

Paket konfigurasi dan server **Model Context Protocol (MCP)** siap pakai yang dioptimalkan untuk penghematan token (~90%), analisis AST codebase, manipulasi database, REST API testing, dan persistensi memori pada environment **Termux / Linux** (Antigravity & Gemini CLI).

---

## 🌟 Fitur Utama

- **🚀 1-Click Restore**: Otomatis setup seluruh dependencies, binary `sqlite3`, npm global packages, dan path dinamis.
- **🛡️ Laser-Focus Protocol**: Sudah terintegrasi dengan `AGENTS.md` untuk mencegah AI keluar dari konteks dan mencegah eksplorasi file liar.
- **⚡ Token-Saver Engine**: Ekstraksi struktur AST (fungsi, class, routes) tanpa membuang context window ribuan token.
- **🌐 REST / API Tester**: Pengujian endpoint API & webhook langsung tanpa tools pihak ketiga.
- **🧠 Cognitive & Memory Retention**: Dilengkapi memory graph persistent dan sequential thinking.

---

## 📦 Komponen Server

```
mcp/
├── mcp_config.json             # Konfigurasi deklarasi MCP server
├── install.sh                  # Skrip instalasi & auto-detect path dinamis
├── AGENTS.md                   # Strict execution protocol (anti-drift & zero fluff)
└── lightweight-tools/          # Custom server engine
    ├── server.js               # Implementasi tools token-saver & api_request
    └── package.json            # Dependensi lokal (SDK, Cheerio, Zod)
```

### 1. `token-saver` (Custom Local Server)
Engine utilitas performa tinggi hemat token:

| Kategori | Tool | Deskripsi |
| :--- | :--- | :--- |
| **Code Graph** | `index_repository` | Membangun graph dependensi & index simbol proyek ke database SQLite. |
| | `code_outline` | Ekstraksi AST cepat (daftar fungsi/class/export + baris kode) hemat 90%+ token. |
| | `search_graph` | Mencari simbol, modul, atau rute spesifik di database graph. |
| | `trace_call_path` | Melacak alur pemanggilan fungsi antar-file. |
| | `detect_changes` | Deteksi perubahan file aktif terhadap codebase graph. |
| **Database** | `sqlite_query` | Eksekusi SQL query langsung ke file `.db` dengan format JSON ringkas. |
| | `sqlite_schema` | Mengambil skema tabel dan relasi kolom database secara instan. |
| **Web & API** | `web_reader` / `scrape_web` | Fetch halaman web dan ekstraksi markdown/JSON menggunakan selector CSS. |
| | `api_request` | HTTP client lengkap (GET, POST, PUT, DELETE, JSON body, custom headers). |

### 2. `memory` (`@modelcontextprotocol/server-memory`)
Memori jangka panjang berbasis knowledge graph:
- Menyimpan entitas (`create_entities`)
- Menghubungkan relasi antar-entitas (`create_relations`)
- Mencatat observasi penting agar AI tetap ingat antar-sesi percakapan.

### 3. `sequential-thinking` (`@modelcontextprotocol/server-sequential-thinking`)
Kemampuan berpikir analitis bertahap (step-by-step dynamic reasoning) untuk menyelesaikan perbaikan bug rumit atau arsitektur sistem kompleks.

---

## 🚀 Instalasi & Pasang Ulang (Restore)

Di perangkat baru atau setelah reset Termux, jalankan perintah ini:

```bash
git clone https://github.com/Futaroukun/mcp.git ~/mcp-setup
cd ~/mcp-setup
bash install.sh
```

### Apa yang dilakukan `install.sh` secara otomatis?
1. Mengecek & memasang binary sistem `sqlite3` jika belum ada (`pkg` / `apt`).
2. Memasang package MCP global via npm (`@modelcontextprotocol/server-memory` & `server-sequential-thinking`).
3. Menyalin modul `lightweight-tools` ke `~/.gemini/mcp-servers/` dan menjalankan `npm install`.
4. Mengkonfigurasi `~/.gemini/config/mcp_config.json` dengan path Node.js dinamis (tidak hardcoded).
5. Menyinkronkan file aturan `AGENTS.md` ke `$HOME/AGENTS.md`.

> [!IMPORTANT]
> Setelah instalasi selesai, restart sesi terminal atau aplikasi agent Anda satu kali agar seluruh skema tool terbaca.

---

## ⚙️ Variabel Lingkungan (Opsional)

Server mendukung konfigurasi fleksibel via environment variables:

| Variabel | Default | Keterangan |
| :--- | :--- | :--- |
| `MCP_WORKSPACE` | Direktori aktif / `~/Joy` | Menentukan root folder proyek target untuk indeks graph kode. |
| `MCP_SERVER_NAME` | `token-saver` | Nama registrasi instance server MCP. |

---

## 📄 Lisensi

Open-source di bawah lisensi [MIT](LICENSE).
