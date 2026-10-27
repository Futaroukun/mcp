# Token-Saver & Developer Suite MCP Best Practices

`token-saver` provides high-performance, low-token alternatives to heavyweight shell commands and large file reads.

## Tool Selection & Token Optimization Rules

1. **Codebase Symbol & Outline Inspection**:
   - Use `code_outline` before reading an entire source file. It extracts function signatures, classes, types, and exports across 18+ programming languages (JS, TS, Python, Go, Rust, Java, Kotlin, Dart, C, C++, PHP, Bash, SQL, etc.) saving 90%+ context tokens.
   - Use `get_code_snippet` to inspect only the target line range around a function or class instead of loading hundreds of lines.

2. **Code Search**:
   - Prefer `fast_search` over bash `grep` or manual file traversal. It leverages native `ripgrep` (`rg`) with smart context lines and results truncation.

3. **Git Operations**:
   - Use `git_status`, `git_diff`, `git_log`, `git_show`, and `git_commit` instead of shell commands. Output is formatted with truncation safeguards to protect the conversation context window.

4. **Code Knowledge Graph**:
   - Use `index_repository` / `codebase_index` to maintain a persistent SQLite knowledge graph (`.codebase_graph.db`).
   - Use `search_graph` for fast symbol lookups.
   - Use `trace_path` / `trace_call_path` for dependency graph traversal (inbound callers or outbound dependencies).
   - Use `detect_changes` / `code_blast_radius` before refactoring to determine downstream impact on dependent modules.
   - Use `get_architecture` for a high-level overview of project entry points and hub modules.

5. **JSON Data Manipulation**:
   - Use `json_query` to query, filter, or slice large JSON files or API outputs using dot-paths (`data.users[0].id`, `keys`, `length`) rather than dumping massive payloads into context.

6. **Web & GitHub Integration**:
   - Use `web_reader` and `scrape_web` for clean, distraction-free markdown extraction.
   - Use `github_search` and `github_raw_file` to inspect public repositories, docs, or files without cloning.
   - Use `api_request` for testing REST APIs and webhooks.

7. **System & Temporal Anchoring**:
   - Use `get_current_time` to get accurate ISO timestamps and timezone offsets.
   - Use `system_status` to check Termux disk, RAM, and runtime health.
