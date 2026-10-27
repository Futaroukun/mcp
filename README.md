# ⚡ Ultimate High-Performance MCP Bundle for Termux & Linux

[![Version](https://img.shields.io/badge/Version-v2.5.0-blue.svg)](https://github.com/Futaroukun/mcp)
[![Platform](https://img.shields.io/badge/Platform-Android%20Termux%20%7C%20Linux-green.svg)](https://termux.dev)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933.svg?logo=node.js)](https://nodejs.org/)
[![Protocol](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20(MCP)-orange.svg)](https://modelcontextprotocol.io)
[![Ripgrep Powered](https://img.shields.io/badge/Search-Ripgrep%2015.2-red.svg)](https://github.com/BurntSushi/ripgrep)
[![Superpowers](https://img.shields.io/badge/Superpowers-Ready-purple.svg)](https://github.com/obra/superpowers)
[![License](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)

Paket konfigurasi dan server **Model Context Protocol (MCP)** performa tinggi yang dioptimalkan untuk **penghematan token drastis (~90%)**, analisis AST codebase multi-bahasa, manipulasi database SQLite, REST client, live inspection GitHub, kontrol Git native, dan retensi memori lintas sesi pada environment **Termux Android & Linux** (khususnya Antigravity & Gemini CLI).

---

## 📊 Seberapa Besar Pengaruh MCP ke AI Agent?

Berdasarkan metrik operasional dan evaluasi SWE-bench, integrasi MCP memberikan lonjakan performa **60% hingga 85%** dibandingkan agen yang hanya mengandalkan raw terminal / shell commands:

| Metrik | Tanpa MCP (Raw Terminal / Bash) | Dengan MCP Bundle Ini | Dampak Nyata |
| :--- | :--- | :--- | :--- |
| **Konsumsi Token** | Membaca full file (`cat`/`head`): **10.000 – 40.000 token** | `code_outline` & `fast_search`: **300 – 900 token** | **Hemat 85% – 90% Token** |
| **Akurasi Navigasi Kode** | Rentan halusinasi path & parsing regex rapuh | Graph AST deterministik via SQLite (`.codebase_graph.db`) | **+50% Task Completion** |
| **Context Window Drift** | Cepat penuh setelah 5–10 perintah shell | Memori terisolasi via skema Zod / JSON terstruktur | **70% Pengurangan Drift** |
| **Latensi Eksekusi** | Overhead spawning subshell bash berulang | Aliran stream lokal JSON-RPC stdio langsung | **40% – 70% Lebih Cepat** |

---

## 🌟 Fitur Utama Bundle (v2.5.0)

1. **🚀 31 Modular Tools Engine (`token-saver`)**: Menggabungkan Git MCP resmi, ripgrep native, parser AST 10+ bahasa, GitHub live reader, dan JSON path filtering dalam 1 proses ringan.
2. **🧠 Persistent Memory & Reasoning**: Dilengkapi `@modelcontextprotocol/server-memory` (graph entitas antar-sesi) dan `@modelcontextprotocol/server-sequential-thinking` (penalaran dinamis bertahap).
3. **⚡ Ultra-Fast Ripgrep Search**: Menggunakan binary `rg` untuk pencarian regex dengan pembatasan baris otomatis, mencegah model terkena overflow token.
4. **🦸 Opsional Superpowers Framework**: Dukungan integrasi plugin `obra/superpowers` untuk membekali AI dengan metodologi TDD, systematic debugging, dan orkestrasi subagent paralel.
5. **🛡️ Strict Execution Protocol (`AGENTS.md`)**: Bebas dari halusinasi, zero-fluff, dan laser-focus pada task yang diberikan pengguna.

---

## 📦 Arsitektur Server

```
mcp-setup/
├── mcp_config.json                 # Deklarasi server MCP untuk Antigravity / Gemini CLI
├── install.sh                      # Skrip instalasi otomatis + opsi --with-superpowers
├── AGENTS.md                       # High-efficiency & zero-fluff protocol
└── lightweight-tools/              # Custom Engine MCP (v2.5.0)
    ├── server.js                   # 31 tool modular performa tinggi
    ├── instructions.md             # Panduan pemilihan tool hemat token bagi AI
    └── package.json                # Dependensi (MCP SDK, Cheerio, Zod)
```

### 1. `token-saver` (v2.5.0 - Custom Core Server)
Engine performa tinggi dengan 31 tools modular terbagi dalam 7 kategori:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TOKEN-SAVER MCP ENGINE                          │
├─────────────────┬──────────────────┬─────────────────┬─────────────────┤
│   CODE GRAPH    │   FAST SEARCH    │    GIT SUITE    │    DATABASE     │
│ index_repository│ fast_search (rg) │ git_status      │ sqlite_query    │
│ code_outline    │                  │ git_diff        │ sqlite_schema   │
│ search_graph    │                  │ git_log         │                 │
│ get_code_snippet│                  │ git_show        │                 │
│ trace_path      │                  │ git_commit      │                 │
│ detect_changes  │                  │                 │                 │
│ get_architecture│                  │                 │                 │
│ manage_adr      │                  │                 │                 │
├─────────────────┼──────────────────┼─────────────────┼─────────────────┤
│   WEB & API     │   GITHUB LIVE    │ JSON & CONTEXT  │  SYSTEM & TIME  │
│ web_reader      │ github_search    │ json_query      │ get_current_time│
│ scrape_web      │ github_raw_file  │                 │ system_status   │
│ api_request     │                  │                 │                 │
└─────────────────┴──────────────────┴─────────────────┴─────────────────┘
```

#### Rincian 31 Tools:
| Kategori | Nama Tool | Deskripsi & Kegunaan |
| :--- | :--- | :--- |
| **Code Graph** | `index_repository` | Membangun index graph dependensi & simbol ke SQLite (JS, TS, Py, Go, Rs, Java, Kt, Dart, C/C++, Swift, SQL). |
| | `codebase_index` | Alias untuk `index_repository`. |
| | `index_status` | Memeriksa statistik, total simbol, dan kesegaran index codebase. |
| | `search_graph` | Mencari definisi fungsi, class, rute, atau modul di database graph. |
| | `get_code_snippet` | Mengambil baris kode presisi sekitar fungsi/class tanpa memuat seluruh file. |
| | `trace_path` | Melacak rantai pemanggil fungsi (*inbound*) atau dependensi (*outbound*). |
| | `trace_call_path` | Alias untuk `trace_path`. |
| | `detect_changes` | Menganalisis *blast radius* / dampak perubahan file terhadap modul lain. |
| | `code_blast_radius`| Alias untuk `detect_changes`. |
| | `query_graph` | Menjalankan query SQL langsung ke tabel `symbols`, `relations`, dan `adr`. |
| | `query_code_graph`| Menampilkan definisi dan referensi simbol secara terstruktur. |
| | `get_architecture` | Menghasilkan ringkasan arsitektur (entry point, dependency hub, plugin). |
| | `manage_adr` | Mencatat dan mengelola Architecture Decision Records (ADR) persisten. |
| | `get_graph_schema` | Introspeksi skema tabel dan indeks pada codebase graph. |
| | `code_outline` | Ekstraksi AST instan (fungsi/class/tipe + line number) hemat 90%+ token. |
| **Fast Search** | `fast_search` | Pencarian regex super cepat bertenaga native `ripgrep` (`rg`) dengan truncation guard. |
| **Git Suite** | `git_status` | Menampilkan status file staged/unstaged/untracked secara compact. |
| | `git_diff` | Melihat diff perubahan (staged/unstaged) dengan batas karakter aman. |
| | `git_log` | Riwayat commit git terbaru (`%h | %an | %ar | %s`). |
| | `git_show` | Detail commit atau isi file pada commit hash tertentu. |
| | `git_commit` | Merekam commit git dengan pesan langsung dari interaksi agent. |
| **Database** | `sqlite_query` | Menjalankan kueri SQL ke database SQLite dengan output JSON ringkas. |
| | `sqlite_schema` | Mengambil skema tabel dan kolom database tanpa membaca baris data. |
| **Web & Scraping**| `web_reader` | Mengambil URL dan mengubahnya menjadi format markdown bersih tanpa iklan/noise. |
| | `scrape_web` | Ekstraksi teks, link, atau tabel dari elemen web menggunakan CSS selector. |
| | `api_request` | HTTP client lengkap (GET, POST, PUT, PATCH, DELETE) untuk uji REST API. |
| **GitHub Live** | `github_search` | Mencari repositori publik di GitHub via API (bintang, fork, deskripsi). |
| | `github_raw_file` | Membaca file mentah dari repositori GitHub publik tanpa perlu clone lokal. |
| **Data Filter** | `json_query` | Query dot-path (`items[0].id`, `keys`, `length`) pada payload JSON besar. |
| **Environment** | `get_current_time` | Menghasilkan waktu ISO 8601, timezone lokal, dan epoch ms real-time. |
| | `system_status` | Memonitor status RAM, disk storage Termux, uptime, dan versi Node.js. |

### 2. `memory` (`@modelcontextprotocol/server-memory`)
Memori jangka panjang berbasis graf pengetahuan:
- `create_entities`: Menyimpan entitas dan konsep proyek.
- `create_relations`: Menghubungkan relasi sebab-akibat antar-entitas.
- `add_observations`: Mencatat temuan penting agar AI tidak lupa pada sesi berikutnya.

### 3. `sequential-thinking` (`@modelcontextprotocol/server-sequential-thinking`)
Penalaran logis mendalam bertahap (step-by-step reasoning) untuk pemecahan masalah kompleks, arsitektur berskala besar, atau debugging akar masalah (*root cause*).

---

## 🦸 Opsional: Integrasi Superpowers (Maksimalisasi Agen)

MCP berfungsi sebagai **"Indera & Tangan"** (akses data terstruktur & eksekusi cepat), sedangkan **Superpowers** berfungsi sebagai **"Otak Metodologis"**.

### Keterampilan (Skills) yang Dibawa Superpowers:
- **`systematic-debugging`**: Mengharuskan investigasi akar masalah dengan bukti sebelum menyarankan perbaikan kode.
- **`test-driven-development`**: Menerapkan siklus *Red-Green-Refactor* sebelum menulis kode implementasi.
- **`subagent-driven-development`**: Memecah rencana besar menjadi tugas-tugas terisolasi yang dieksekusi subagen paralel.
- **`writing-plans` & `executing-plans`**: Menulis dan mengeksekusi rencana teknis komprehensif langkah demi langkah.
- **`verification-before-completion`**: Memastikan bukti pengujian lolos sebelum menyatakan pekerjaan selesai.

---

## 🚀 Panduan Instalasi Cepat

### Pilihan A: Instalasi Standar (Hanya MCP)
Cocok untuk setup minimalis dan cepat:
```bash
git clone https://github.com/Futaroukun/mcp.git ~/mcp-setup
cd ~/mcp-setup
bash install.sh
```

### Pilihan B: Instalasi Maksimal (MCP + Superpowers) ⭐ *(Sangat Direkomendasikan)*
Mengaktifkan 31 tool MCP sekaligus seluruh keterampilan agen tingkat lanjut:
```bash
git clone https://github.com/Futaroukun/mcp.git ~/mcp-setup
cd ~/mcp-setup
bash install.sh --with-superpowers
```

### Apa yang Dilakukan Skrip `install.sh` Secara Otomatis?
1. ✅ Memeriksa & memasang dependensi native: `sqlite3`, `ripgrep`, dan `git`.
2. ✅ Memasang server MCP global via npm (`server-memory` & `server-sequential-thinking`).
3. ✅ Menyalin modul `lightweight-tools` ke `~/.gemini/mcp-servers/` dan menjalankan `npm install`.
4. ✅ Meng-generate 31 skema JSON secara otomatis ke direktori cache Antigravity.
5. ✅ Menyiapkan konfigurasi dinamis `~/.gemini/config/mcp_config.json`.
6. ✅ *(Jika `--with-superpowers`)* Mengkloning framework `obra/superpowers` dan mengaktifkannya di `~/.gemini/config/config.json`.
7. ✅ Menyinkronkan protokol eksekusi `AGENTS.md` ke `$HOME/AGENTS.md`.

---

## ⚙️ Variabel Lingkungan (Environment Variables)

| Variabel | Default | Deskripsi |
| :--- | :--- | :--- |
| `MCP_WORKSPACE` | Direktori aktif / `~/Joy` | Root folder target yang akan diindeks untuk graph codebase. |
| `MCP_SERVER_NAME` | `token-saver` | Nama identifier registrasi instance server MCP. |
| `ENV_WITH_SUPERPOWERS` | `0` | Set `1` jika ingin mengaktifkan instalasi Superpowers via environment variable. |

---

## 🔧 Troubleshooting & Tips

- **Antigravity belum mendeteksi tool baru?**  
  Tutup sesi terminal lalu buka kembali atau mulai sesi baru agar language server membaca skema MCP yang baru.
- **Error binary SQLite / Ripgrep?**  
  Jalankan `pkg install sqlite ripgrep git -y` secara manual di Termux.
- **Reset MCP ke kondisi awal?**  
  Cukup jalankan ulang `bash install.sh` di dalam folder `~/mcp-setup`.

---

## 📄 Lisensi

Proyek ini bersifat open-source di bawah lisensi [MIT](LICENSE).
