import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";

const serverName = process.env.MCP_SERVER_NAME || process.argv[2] || "token-saver";
const server = new McpServer({
  name: serverName,
  version: "2.0.0"
});

const HOME_DIR = process.env.HOME || "/data/data/com.termux/files/home";
const DEFAULT_WORKSPACE = process.env.MCP_WORKSPACE || (process.cwd() !== HOME_DIR && process.cwd() !== "/" ? process.cwd() : `${HOME_DIR}/Joy`);
const DEFAULT_DB_FILE = ".codebase_graph.db";

// SQLite Helpers
function execSqlBatch(dbPath, sqlStatements) {
  return new Promise((resolve, reject) => {
    const p = execFile("sqlite3", [dbPath], { maxBuffer: 1024 * 1024 * 25 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
    p.stdin.write(sqlStatements);
    p.stdin.end();
  });
}

function runSqlJson(dbPath, sql) {
  return new Promise((resolve, reject) => {
    execFile("sqlite3", [dbPath, "-json", sql], { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : []);
      } catch {
        resolve([]);
      }
    });
  });
}

function resolveDbPath(customPath) {
  if (!customPath) {
    return path.join(DEFAULT_WORKSPACE, DEFAULT_DB_FILE);
  }
  const resolved = path.resolve(customPath);
  if (resolved.endsWith(".db")) {
    return resolved;
  }
  return path.join(resolved, DEFAULT_DB_FILE);
}

function resolveRootDir(customPath) {
  if (!customPath) return DEFAULT_WORKSPACE;
  const resolved = path.resolve(customPath);
  if (resolved.endsWith(".db")) {
    return path.dirname(resolved);
  }
  return resolved;
}

async function initGraphDb(dbPath) {
  const schema = `
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA cache_size = -64000;
    PRAGMA temp_store = MEMORY;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      root_path TEXT UNIQUE,
      indexed_at INTEGER,
      file_count INTEGER,
      symbol_count INTEGER,
      relation_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rel_path TEXT UNIQUE,
      abs_path TEXT,
      mtime INTEGER,
      size INTEGER,
      language TEXT
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER,
      name TEXT,
      kind TEXT,
      line INTEGER,
      signature TEXT,
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file_id INTEGER,
      target_file_id INTEGER,
      type TEXT,
      symbol_name TEXT,
      line INTEGER,
      FOREIGN KEY(source_file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS adr (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'accepted',
      context TEXT,
      decision TEXT,
      consequences TEXT,
      created_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sym_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_sym_file ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_sym_kind ON symbols(kind);
    CREATE INDEX IF NOT EXISTS idx_rel_sym ON relations(symbol_name);
    CREATE INDEX IF NOT EXISTS idx_rel_src ON relations(source_file_id);
    CREATE INDEX IF NOT EXISTS idx_rel_tgt ON relations(target_file_id);
    CREATE INDEX IF NOT EXISTS idx_rel_type ON relations(type);
  `;
  await execSqlBatch(dbPath, schema);
}

// ---------------------------------------------------------------------------
// 1. INDEX_REPOSITORY / CODEBASE_INDEX
// ---------------------------------------------------------------------------
async function handleIndexRepository({ path: targetPath, force = false }) {
  const startTime = Date.now();
  const rootDir = resolveRootDir(targetPath);
  const graphDb = resolveDbPath(targetPath);

  try {
    await fs.access(rootDir);
  } catch {
    return {
      content: [{ type: "text", text: `Target directory not found: ${rootDir}` }],
      isError: true
    };
  }

  await initGraphDb(graphDb);

  const ignoredDirs = new Set([
    "node_modules", ".git", "dist", "build", ".cache", "coverage", ".system_generated",
    ".gemini", "temp", "tmp", "logs", "media", "sessions", "session", "auth_info_baileys"
  ]);

  const validExts = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".py", ".sh", ".bash", ".json", ".go", ".rs", ".php"]);

  const fileEntries = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".env") {
        if (entry.isDirectory() && (entry.name === ".git" || entry.name === ".gemini")) continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (validExts.has(ext)) {
          try {
            const st = await fs.stat(fullPath);
            if (st.size < 500 * 1024) {
              fileEntries.push({
                rel_path: path.relative(rootDir, fullPath),
                abs_path: fullPath,
                mtime: Math.floor(st.mtimeMs),
                size: st.size,
                ext
              });
            }
          } catch {}
        }
      }
    }
  }

  await walk(rootDir);

  const existing = await runSqlJson(graphDb, "SELECT id, rel_path, mtime, size FROM files;");
  const existingMap = new Map(existing.map((f) => [f.rel_path, f]));

  let filesProcessed = 0;
  let symbolsIndexed = 0;
  let relationsIndexed = 0;

  const batchStatements = ["BEGIN IMMEDIATE;"];

  for (const f of fileEntries) {
    const old = existingMap.get(f.rel_path);
    if (!force && old && old.mtime === f.mtime && old.size === f.size) {
      continue;
    }

    if (old) {
      batchStatements.push(`DELETE FROM files WHERE id = ${old.id};`);
    }

    let lang = "javascript";
    if (f.ext === ".py") lang = "python";
    else if (f.ext === ".json") lang = "json";
    else if (f.ext === ".sh" || f.ext === ".bash") lang = "bash";
    else if (f.ext === ".go") lang = "go";
    else if (f.ext === ".rs") lang = "rust";
    else if (f.ext === ".php") lang = "php";
    else if (f.ext === ".ts" || f.ext === ".tsx") lang = "typescript";
    const safeRel = f.rel_path.replace(/'/g, "''");
    const safeAbs = f.abs_path.replace(/'/g, "''");

    batchStatements.push(
      `INSERT INTO files (rel_path, abs_path, mtime, size, language) VALUES ('${safeRel}', '${safeAbs}', ${f.mtime}, ${f.size}, '${lang}');`
    );
    filesProcessed++;

    let content;
    try {
      content = await fs.readFile(f.abs_path, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;

      let symName = null;
      let symKind = "function";
      let sig = trimmed.slice(0, 120);

      if (lang === "python") {
        const mDef = trimmed.match(/^(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/);
        const mClass = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
        if (mDef) symName = mDef[1];
        else if (mClass) { symName = mClass[1]; symKind = "class"; }
      } else if (lang === "bash") {
        const mSh = trimmed.match(/^(?:function\s+)?([A-Za-z0-9_-]+)\s*\(\)\s*\{?/);
        if (mSh) { symName = mSh[1]; symKind = "function"; }
      } else if (lang === "go") {
        const mGoFunc = trimmed.match(/^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(/);
        const mGoType = trimmed.match(/^type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)/);
        if (mGoFunc) symName = mGoFunc[1];
        else if (mGoType) { symName = mGoType[1]; symKind = "type"; }
      } else if (lang === "rust") {
        const mRsFn = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/);
        const mRsType = trimmed.match(/^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z0-9_]+)/);
        if (mRsFn) symName = mRsFn[1];
        else if (mRsType) { symName = mRsType[1]; symKind = "type"; }
      } else if (lang === "php") {
        const mPhp = trimmed.match(/^(?:(?:public|protected|private|static|final|abstract)\s+)*(?:function\s+([A-Za-z0-9_]+)|class\s+([A-Za-z0-9_]+)|interface\s+([A-Za-z0-9_]+))/);
        if (mPhp) {
          symName = mPhp[1] || mPhp[2] || mPhp[3];
          symKind = mPhp[2] ? "class" : (mPhp[3] ? "interface" : "function");
        }
      } else if (lang === "javascript" || lang === "typescript") {
        const mFunc = trimmed.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_]+)?\s*\(/);
        const mClass = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/);
        const mArrow = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/);
        const mType = trimmed.match(/^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z0-9_]+)/);
        const mPluginHandler = trimmed.match(/^(?:let|var|const)?\s*(handler)\s*=\s*(?:async\s+)?(?:function|\()/);
        const mMethod = line.match(/^\s*(?:async\s+)?([A-Za-z0-9_]+)\s*\([^)]*\)\s*{/);

        if (mFunc && mFunc[1]) symName = mFunc[1];
        else if (mClass) { symName = mClass[1]; symKind = "class"; }
        else if (mArrow) symName = mArrow[1];
        else if (mType) { symName = mType[1]; symKind = "type"; }
        else if (mPluginHandler) { symName = "handler"; symKind = "route"; }
        else if (mMethod && !["if", "for", "while", "switch", "catch"].includes(mMethod[1])) {
          symName = mMethod[1];
          symKind = "method";
        }
      }

      if (symName) {
        const safeSig = sig.replace(/'/g, "''");
        batchStatements.push(
          `INSERT INTO symbols (file_id, name, kind, line, signature) VALUES ((SELECT id FROM files WHERE rel_path = '${safeRel}'), '${symName}', '${symKind}', ${lineNum}, '${safeSig}');`
        );
        symbolsIndexed++;
      }

      // Import / Require relations
      let importTarget = null;
      const mImport = trimmed.match(/(?:import\s+.*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/);
      if (mImport) {
        importTarget = mImport[1] || mImport[2];
      } else if (lang === "python") {
        const mPyImp = trimmed.match(/(?:from\s+([A-Za-z0-9_.]+)\s+import|import\s+([A-Za-z0-9_.]+))/);
        if (mPyImp) importTarget = mPyImp[1] || mPyImp[2];
      }

      if (importTarget) {
        const safeTarget = importTarget.replace(/'/g, "''");
        batchStatements.push(
          `INSERT INTO relations (source_file_id, target_file_id, type, symbol_name, line) VALUES ((SELECT id FROM files WHERE rel_path = '${safeRel}'), (SELECT id FROM files WHERE rel_path LIKE '%${safeTarget}%' LIMIT 1), 'import', '${safeTarget}', ${lineNum});`
        );
        relationsIndexed++;
      }
    });
  }

  // Update project entry
  const projectName = path.basename(rootDir);
  const now = Date.now();
  batchStatements.push(`
    INSERT INTO projects (name, root_path, indexed_at, file_count, symbol_count, relation_count)
    VALUES ('${projectName}', '${rootDir}', ${now}, (SELECT COUNT(*) FROM files), (SELECT COUNT(*) FROM symbols), (SELECT COUNT(*) FROM relations))
    ON CONFLICT(root_path) DO UPDATE SET
      indexed_at = ${now},
      file_count = (SELECT COUNT(*) FROM files),
      symbol_count = (SELECT COUNT(*) FROM symbols),
      relation_count = (SELECT COUNT(*) FROM relations);
  `);

  batchStatements.push("COMMIT;");

  if (batchStatements.length > 3) {
    await execSqlBatch(graphDb, batchStatements.join("\n"));
  }

  const duration = Date.now() - startTime;
  const totals = await runSqlJson(
    graphDb,
    "SELECT (SELECT COUNT(*) FROM files) as total_files, (SELECT COUNT(*) FROM symbols) as total_symbols, (SELECT COUNT(*) FROM relations) as total_relations;"
  );

  const stats = totals[0] || { total_files: fileEntries.length, total_symbols: symbolsIndexed, total_relations: relationsIndexed };

  return {
    content: [{
      type: "text",
      text: `Repository indexed successfully in ${duration}ms.\n` +
            `• Files scanned: ${fileEntries.length} (${filesProcessed} updated)\n` +
            `• Symbols mapped: ${stats.total_symbols}\n` +
            `• Relations mapped: ${stats.total_relations}\n` +
            `• Database: ${graphDb}`
    }]
  };
}

server.tool(
  "index_repository",
  "Index a codebase repository into a persistent knowledge graph (.codebase_graph.db). Performs incremental parsing of symbols, functions, classes, and imports.",
  {
    path: z.string().optional().describe(`Target directory or project root. Defaults to ${DEFAULT_WORKSPACE}`),
    force: z.boolean().optional().describe("Force re-index all files regardless of modification time")
  },
  handleIndexRepository
);

server.tool(
  "codebase_index",
  "Alias for index_repository. Indexes repository into SQLite knowledge graph.",
  {
    target_dir: z.string().optional().describe("Target repository path"),
    db_path: z.string().optional().describe("Database path")
  },
  async ({ target_dir, db_path }) => handleIndexRepository({ path: target_dir || db_path })
);

// ---------------------------------------------------------------------------
// 2. INDEX_STATUS
// ---------------------------------------------------------------------------
server.tool(
  "index_status",
  "Check the status, coverage, and freshness of the codebase knowledge graph index.",
  {
    path: z.string().optional().describe(`Target repository path. Defaults to ${DEFAULT_WORKSPACE}`)
  },
  async ({ path: targetPath }) => {
    const graphDb = resolveDbPath(targetPath);
    const rootDir = resolveRootDir(targetPath);

    try {
      const dbStat = await fs.stat(graphDb);
      const rows = await runSqlJson(
        graphDb,
        `SELECT 
          (SELECT COUNT(*) FROM files) as file_count,
          (SELECT COUNT(*) FROM symbols) as symbol_count,
          (SELECT COUNT(*) FROM relations) as relation_count,
          (SELECT MAX(indexed_at) FROM projects) as last_indexed;`
      );

      const data = rows[0] || { file_count: 0, symbol_count: 0, relation_count: 0, last_indexed: null };
      const sizeKb = (dbStat.size / 1024).toFixed(1);
      const lastIndexDate = data.last_indexed ? new Date(data.last_indexed).toISOString() : "Unknown";

      return {
        content: [{
          type: "text",
          text: `### Codebase Index Status\n` +
                `• Status: **Active & Ready**\n` +
                `• Project: \`${rootDir}\`\n` +
                `• Database: \`${graphDb}\` (${sizeKb} KB)\n` +
                `• Total Files: **${data.file_count}**\n` +
                `• Total Symbols: **${data.symbol_count}**\n` +
                `• Total Relations: **${data.relation_count}**\n` +
                `• Last Indexed: \`${lastIndexDate}\``
        }]
      };
    } catch {
      return {
        content: [{
          type: "text",
          text: `No active index found at ${graphDb}. Run index_repository to create one.`
        }]
      };
    }
  }
);

// ---------------------------------------------------------------------------
// 3. SEARCH_GRAPH
// ---------------------------------------------------------------------------
server.tool(
  "search_graph",
  "Search the codebase graph for symbols, functions, classes, routes, or files with minimal token usage.",
  {
    query: z.string().describe("Search term, symbol name, or partial keyword"),
    kind: z.enum(["function", "class", "method", "variable", "route", "all"]).optional().describe("Filter by symbol kind"),
    path: z.string().optional().describe(`Target repository path. Defaults to ${DEFAULT_WORKSPACE}`),
    limit: z.number().optional().describe("Maximum results to return (default 20)")
  },
  async ({ query, kind = "all", path: targetPath, limit = 20 }) => {
    const graphDb = resolveDbPath(targetPath);
    try {
      await fs.access(graphDb);
    } catch {
      return { content: [{ type: "text", text: `Database not found at ${graphDb}. Run index_repository first.` }], isError: true };
    }

    const safeQ = query.replace(/'/g, "''");
    let kindFilter = "";
    if (kind !== "all") {
      kindFilter = `AND s.kind = '${kind}'`;
    }

    const results = await runSqlJson(
      graphDb,
      `SELECT s.name, s.kind, s.line, s.signature, f.rel_path 
       FROM symbols s 
       JOIN files f ON s.file_id = f.id 
       WHERE (s.name LIKE '%${safeQ}%' OR s.signature LIKE '%${safeQ}%' OR f.rel_path LIKE '%${safeQ}%') ${kindFilter}
       ORDER BY CASE WHEN s.name = '${safeQ}' THEN 1 WHEN s.name LIKE '${safeQ}%' THEN 2 ELSE 3 END
       LIMIT ${limit};`
    );

    if (results.length === 0) {
      return {
        content: [{ type: "text", text: `No symbols or files found matching \`${query}\`.` }]
      };
    }

    let out = `### Search Results for \`${query}\` (${results.length} matches)\n`;
    for (const r of results) {
      out += `• \`${r.kind}\` **${r.name}** — [${r.rel_path}:${r.line}]\n  \`${r.signature}\`\n`;
    }

    return { content: [{ type: "text", text: out.trim() }] };
  }
);

// ---------------------------------------------------------------------------
// 4. GET_CODE_SNIPPET
// ---------------------------------------------------------------------------
server.tool(
  "get_code_snippet",
  "Extract exact code snippet around a function, class, or symbol line without loading the full file into context.",
  {
    file_path: z.string().describe("Relative or absolute path of the file"),
    symbol: z.string().optional().describe("Symbol name to locate automatically"),
    line: z.number().optional().describe("Line number to inspect"),
    context_lines: z.number().optional().describe("Lines of context before and after (default 15)"),
    path: z.string().optional().describe(`Target repository path. Defaults to ${DEFAULT_WORKSPACE}`)
  },
  async ({ file_path, symbol, line, context_lines = 15, path: targetPath }) => {
    const rootDir = resolveRootDir(targetPath);
    const absPath = path.isAbsolute(file_path) ? file_path : path.join(rootDir, file_path);

    let targetLine = line;

    if (!targetLine && symbol) {
      const graphDb = resolveDbPath(targetPath);
      try {
        const found = await runSqlJson(
          graphDb,
          `SELECT s.line FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.name = '${symbol.replace(/'/g, "''")}' AND (f.rel_path LIKE '%${file_path}%' OR f.abs_path = '${absPath}') LIMIT 1;`
        );
        if (found.length > 0) {
          targetLine = found[0].line;
        }
      } catch {}
    }

    try {
      const content = await fs.readFile(absPath, "utf-8");
      const allLines = content.split(/\r?\n/);

      if (!targetLine || isNaN(targetLine) || targetLine < 1) targetLine = 1;
      targetLine = Math.min(allLines.length, targetLine);

      const start = Math.max(1, targetLine - 3);
      const end = Math.min(allLines.length, targetLine + context_lines);

      const snippet = allLines.slice(start - 1, end).map((l, i) => {
        const currentLineNum = start + i;
        const pointer = currentLineNum === targetLine ? ">" : " ";
        return `${pointer} ${String(currentLineNum).padStart(4, " ")} | ${l}`;
      }).join("\n");

      const ext = path.extname(absPath).slice(1) || "txt";

      return {
        content: [{
          type: "text",
          text: `### Code Snippet: \`${path.relative(rootDir, absPath)}\` (Lines ${start}-${end})\n` +
                `\`\`\`${ext}\n${snippet}\n\`\`\``
        }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error reading file ${absPath}: ${err.message}` }],
        isError: true
      };
    }
  }
);

// ---------------------------------------------------------------------------
// 5. TRACE_PATH (Call Graph & Dependency Path)
// ---------------------------------------------------------------------------
async function handleTracePath({ target, direction = "inbound", depth = 2, path: targetPath }) {
  const graphDb = resolveDbPath(targetPath);
  try {
    await fs.access(graphDb);
  } catch {
    return { content: [{ type: "text", text: `Database not found at ${graphDb}. Run index_repository first.` }], isError: true };
  }

  const safeTarget = target.replace(/'/g, "''");
  let out = `### Trace Tree for \`${target}\` (Depth: ${depth}, Direction: ${direction})\n\n`;

  if (direction === "inbound" || direction === "both") {
    out += `**Inbound Callers / Importers (Who depends on ${target})**:\n`;
    const visited = new Set();
    const queue = [{ term: safeTarget, currentDepth: 1 }];
    const callersFound = [];

    while (queue.length > 0) {
      const { term, currentDepth } = queue.shift();
      if (currentDepth > depth) continue;

      const callers = await runSqlJson(
        graphDb,
        `SELECT DISTINCT f.rel_path, r.symbol_name, r.type, r.line
         FROM relations r
         JOIN files f ON r.source_file_id = f.id
         WHERE r.symbol_name LIKE '%${term}%' OR r.target_file_id IN (SELECT id FROM files WHERE rel_path LIKE '%${term}%')
         LIMIT 25;`
      );

      for (const c of callers) {
        const key = `${c.rel_path}:${c.line}:${c.symbol_name}`;
        if (!visited.has(key)) {
          visited.add(key);
          const indent = "  ".repeat(currentDepth);
          callersFound.push(`${indent}├── [${c.rel_path}:${c.line}] (${c.type} \`${c.symbol_name}\`)`);
          if (currentDepth < depth) {
            const nextTerm = path.basename(c.rel_path).replace(/'/g, "''");
            queue.push({ term: nextTerm, currentDepth: currentDepth + 1 });
          }
        }
      }
    }

    if (callersFound.length === 0) {
      out += `  *(No inbound references found)*\n`;
    } else {
      out += callersFound.join("\n") + "\n";
    }
  }

  if (direction === "outbound" || direction === "both") {
    out += `\n**Outbound Dependencies (What ${target} depends on)**:\n`;
    const visited = new Set();
    const queue = [{ term: safeTarget, currentDepth: 1 }];
    const depsFound = [];

    while (queue.length > 0) {
      const { term, currentDepth } = queue.shift();
      if (currentDepth > depth) continue;

      const deps = await runSqlJson(
        graphDb,
        `SELECT DISTINCT r.symbol_name, r.type, r.line, f2.rel_path as target_path
         FROM relations r
         JOIN files f ON r.source_file_id = f.id
         LEFT JOIN files f2 ON r.target_file_id = f2.id
         WHERE f.rel_path LIKE '%${term}%'
         LIMIT 25;`
      );

      for (const d of deps) {
        const key = `${d.target_path || d.symbol_name}:${d.line}`;
        if (!visited.has(key)) {
          visited.add(key);
          const indent = "  ".repeat(currentDepth);
          const resolvedPath = d.target_path ? ` -> [${d.target_path}]` : "";
          depsFound.push(`${indent}└── line ${d.line}: ${d.type} \`${d.symbol_name}\`${resolvedPath}`);
          if (currentDepth < depth && d.target_path) {
            const nextTerm = path.basename(d.target_path).replace(/'/g, "''");
            queue.push({ term: nextTerm, currentDepth: currentDepth + 1 });
          }
        }
      }
    }

    if (depsFound.length === 0) {
      out += `  *(No outbound dependencies found)*\n`;
    } else {
      out += depsFound.join("\n") + "\n";
    }
  }

  return { content: [{ type: "text", text: out.trim() }] };
}

server.tool(
  "trace_path",
  "Trace inbound callers or outbound dependencies for a function, class, or file using BFS traversal.",
  {
    target: z.string().describe("Symbol name or partial file path to trace"),
    direction: z.enum(["inbound", "outbound", "both"]).optional().describe("Trace direction: inbound (callers), outbound (dependencies), or both (default: inbound)"),
    depth: z.number().optional().describe("Traversal depth (1 to 5, default 2)"),
    path: z.string().optional().describe(`Target repository path. Defaults to ${DEFAULT_WORKSPACE}`)
  },
  handleTracePath
);

server.tool(
  "trace_call_path",
  "Alias for trace_path.",
  {
    target: z.string().describe("Symbol name or file to trace"),
    direction: z.enum(["inbound", "outbound", "both"]).optional(),
    depth: z.number().optional(),
    path: z.string().optional()
  },
  handleTracePath
);

// ---------------------------------------------------------------------------
// 6. DETECT_CHANGES / BLAST_RADIUS
// ---------------------------------------------------------------------------
async function handleDetectChanges({ target, git_diff = false, path: targetPath }) {
  const rootDir = resolveRootDir(targetPath);
  const graphDb = resolveDbPath(targetPath);

  try {
    await fs.access(graphDb);
  } catch {
    return { content: [{ type: "text", text: `Database not found at ${graphDb}. Run index_repository first.` }], isError: true };
  }

  let targetsToAnalyze = [];

  if (git_diff) {
    try {
      const gitStatus = await new Promise((res, rej) => {
        execFile("git", ["status", "--porcelain"], { cwd: rootDir }, (err, stdout) => {
          if (err) return res("");
          res(stdout);
        });
      });
      const lines = gitStatus.trim().split("\n").filter(Boolean);
      for (const l of lines) {
        const filePath = l.slice(3).trim();
        if (filePath) targetsToAnalyze.push(filePath);
      }
    } catch {}
  }

  if (target) {
    targetsToAnalyze.push(target);
  }

  if (targetsToAnalyze.length === 0) {
    return {
      content: [{ type: "text", text: "No targets provided and no uncommitted git changes detected." }]
    };
  }

  let out = `### Change Impact & Blast Radius Analysis\n`;
  let totalImpacted = new Set();

  for (const item of targetsToAnalyze) {
    const safeItem = item.replace(/'/g, "''");
    const dependents = await runSqlJson(
      graphDb,
      `SELECT DISTINCT f.rel_path, r.symbol_name, r.line
       FROM relations r
       JOIN files f ON r.source_file_id = f.id
       WHERE r.symbol_name LIKE '%${safeItem}%' 
          OR r.target_file_id IN (SELECT id FROM files WHERE rel_path LIKE '%${safeItem}%');`
    );

    dependents.forEach((d) => totalImpacted.add(d.rel_path));

    out += `\n**Target**: \`${item}\` (${dependents.length} direct dependents)\n`;
    if (dependents.length === 0) {
      out += `  *No dependent files detected.*\n`;
    } else {
      for (const d of dependents.slice(0, 10)) {
        out += `  • \`${d.rel_path}\` (line ${d.line}, references \`${d.symbol_name}\`)\n`;
      }
      if (dependents.length > 10) {
        out += `  *...and ${dependents.length - 10} more files*\n`;
      }
    }
  }

  const risk = totalImpacted.size > 8 ? "HIGH" : (totalImpacted.size > 2 ? "MEDIUM" : "LOW");
  out = `**Risk Assessment**: **${risk}** (${totalImpacted.size} total affected files)\n` + out;

  return { content: [{ type: "text", text: out.trim() }] };
}

server.tool(
  "detect_changes",
  "Analyze blast radius and downstream impact of modified files, symbols, or current git diff.",
  {
    target: z.string().optional().describe("File path or symbol name to analyze"),
    git_diff: z.boolean().optional().describe("Inspect all modified files from git status"),
    path: z.string().optional().describe(`Target repository path. Defaults to ${DEFAULT_WORKSPACE}`)
  },
  handleDetectChanges
);

server.tool(
  "code_blast_radius",
  "Alias for detect_changes.",
  {
    target: z.string().optional().describe("Target file path or symbol name"),
    git_diff: z.boolean().optional().describe("Inspect all modified files from git status"),
    db_path: z.string().optional().describe("Path to .codebase_graph.db")
  },
  async ({ target, git_diff, db_path }) => handleDetectChanges({ target, git_diff, path: db_path })
);

// ---------------------------------------------------------------------------
// 7. QUERY_GRAPH
// ---------------------------------------------------------------------------
async function handleQueryGraph({ query, path: targetPath }) {
  const graphDb = resolveDbPath(targetPath);
  try {
    await fs.access(graphDb);
  } catch {
    return { content: [{ type: "text", text: `Database not found at ${graphDb}. Run index_repository first.` }], isError: true };
  }

  try {
    const results = await runSqlJson(graphDb, query);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }]
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Query Error: ${err.message}` }],
      isError: true
    };
  }
}

server.tool(
  "query_graph",
  "Execute SQL graph query directly against files, symbols, relations, and adr tables.",
  {
    query: z.string().describe("SQL query, e.g. SELECT name, kind, line FROM symbols WHERE kind = 'route' LIMIT 10"),
    path: z.string().optional().describe(`Target repository path. Defaults to ${DEFAULT_WORKSPACE}`)
  },
  handleQueryGraph
);

server.tool(
  "query_code_graph",
  "Query symbol definitions and references from the knowledge graph.",
  {
    symbol: z.string().describe("Symbol name to inspect"),
    db_path: z.string().optional().describe("Database path")
  },
  async ({ symbol, db_path }) => {
    const graphDb = resolveDbPath(db_path);
    const safeSym = symbol.replace(/'/g, "''");
    const defs = await runSqlJson(
      graphDb,
      `SELECT s.name, s.kind, s.line, s.signature, f.rel_path 
       FROM symbols s JOIN files f ON s.file_id = f.id 
       WHERE s.name = '${safeSym}' OR s.name LIKE '${safeSym}%' LIMIT 10;`
    );
    const inbounds = await runSqlJson(
      graphDb,
      `SELECT r.type, r.symbol_name, r.line, f.rel_path 
       FROM relations r JOIN files f ON r.source_file_id = f.id 
       WHERE r.symbol_name LIKE '%${safeSym}%' LIMIT 15;`
    );

    let output = `### Code Graph for \`${symbol}\`\n\n`;
    output += `**Definitions (${defs.length})**:\n`;
    for (const d of defs) {
      output += `• \`${d.kind}\` **${d.name}** in [${d.rel_path}:${d.line}] — \`${d.signature}\`\n`;
    }
    output += `\n**References / Callers (${inbounds.length})**:\n`;
    for (const r of inbounds) {
      output += `• [${r.rel_path}:${r.line}] (${r.type} \`${r.symbol_name}\`)\n`;
    }
    return { content: [{ type: "text", text: output.trim() }] };
  }
);

// ---------------------------------------------------------------------------
// 8. GET_ARCHITECTURE
// ---------------------------------------------------------------------------
server.tool(
  "get_architecture",
  "Generate high-level architectural overview: entry points, core hubs, plugin routes, and module statistics.",
  {
    path: z.string().optional().describe(`Target repository path. Defaults to ${DEFAULT_WORKSPACE}`)
  },
  async ({ path: targetPath }) => {
    const rootDir = resolveRootDir(targetPath);
    const graphDb = resolveDbPath(targetPath);

    try {
      await fs.access(graphDb);
    } catch {
      return { content: [{ type: "text", text: `Database not found at ${graphDb}. Run index_repository first.` }], isError: true };
    }

    // 1. Overall stats
    const stats = (await runSqlJson(
      graphDb,
      `SELECT (SELECT COUNT(*) FROM files) as files, (SELECT COUNT(*) FROM symbols) as symbols, (SELECT COUNT(*) FROM relations) as relations;`
    ))[0];

    // 2. Hub Modules (Most imported files)
    const hubs = await runSqlJson(
      graphDb,
      `SELECT f.rel_path, COUNT(r.id) as in_degree
       FROM files f
       JOIN relations r ON r.target_file_id = f.id
       GROUP BY f.id
       ORDER BY in_degree DESC
       LIMIT 5;`
    );

    // 3. Entry points
    const entryPoints = await runSqlJson(
      graphDb,
      `SELECT rel_path FROM files WHERE rel_path IN ('main.js', 'index.js', 'handler.js', 'start.js', 'app.js', 'server.js', 'setup.js');`
    );

    // 4. Folder module distribution
    const folders = await runSqlJson(
      graphDb,
      `SELECT SUBSTR(rel_path, 1, INSTR(rel_path, '/') - 1) as folder, COUNT(*) as count
       FROM files
       WHERE rel_path LIKE '%/%'
       GROUP BY folder
       ORDER BY count DESC
       LIMIT 6;`
    );

    // 5. Route / Command handlers count
    const routes = await runSqlJson(
      graphDb,
      `SELECT COUNT(*) as count FROM symbols WHERE kind = 'route';`
    );

    let doc = `### Architecture Overview: \`${path.basename(rootDir)}\`\n`;
    doc += `• **Total Modules**: ${stats.files} files | **Symbols**: ${stats.symbols} | **Dependencies**: ${stats.relations}\n\n`;

    doc += `**Key Entry Points**:\n`;
    for (const e of entryPoints) {
      doc += `• \`${e.rel_path}\`\n`;
    }

    doc += `\n**Top Dependency Hubs (Most Imported)**:\n`;
    for (const h of hubs) {
      doc += `• \`${h.rel_path}\` (imported by ${h.in_degree} files)\n`;
    }

    doc += `\n**Module Structure**:\n`;
    for (const f of folders) {
      doc += `• \`${f.folder}/\`: ${f.count} files\n`;
    }

    if (routes[0]?.count > 0) {
      doc += `\n**Registered Plugin Handlers / Routes**: ${routes[0].count} handlers detected in knowledge graph.\n`;
    }

    return { content: [{ type: "text", text: doc.trim() }] };
  }
);

// ---------------------------------------------------------------------------
// 9. MANAGE_ADR (Architecture Decision Records)
// ---------------------------------------------------------------------------
server.tool(
  "manage_adr",
  "Manage Architecture Decision Records (ADR) to persist technical decisions across AI sessions.",
  {
    action: z.enum(["list", "get", "create"]).describe("Action to perform: list, get, or create"),
    id: z.number().optional().describe("ADR ID for get"),
    title: z.string().optional().describe("ADR Title for create"),
    decision: z.string().optional().describe("Decision summary for create"),
    context: z.string().optional().describe("Context and problem description"),
    consequences: z.string().optional().describe("Positive/negative consequences"),
    status: z.enum(["proposed", "accepted", "deprecated", "superseded"]).optional().describe("ADR status (default accepted)"),
    path: z.string().optional().describe(`Target repository path. Defaults to ${DEFAULT_WORKSPACE}`)
  },
  async ({ action, id, title, decision, context = "", consequences = "", status = "accepted", path: targetPath }) => {
    const graphDb = resolveDbPath(targetPath);
    await initGraphDb(graphDb);

    if (action === "list") {
      const records = await runSqlJson(graphDb, "SELECT id, title, status, created_at FROM adr ORDER BY id ASC;");
      if (records.length === 0) {
        return { content: [{ type: "text", text: "No ADR records found. Use action 'create' to record technical decisions." }] };
      }
      let out = `### Architecture Decision Records (${records.length})\n`;
      for (const r of records) {
        const d = r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : "";
        out += `• **[ADR-${r.id}]** ${r.title} — \`${r.status}\` (${d})\n`;
      }
      return { content: [{ type: "text", text: out.trim() }] };
    }

    if (action === "get") {
      if (!id) return { content: [{ type: "text", text: "Please provide 'id' for get action." }], isError: true };
      const records = await runSqlJson(graphDb, `SELECT * FROM adr WHERE id = ${id};`);
      if (records.length === 0) return { content: [{ type: "text", text: `ADR-${id} not found.` }], isError: true };
      const r = records[0];
      return {
        content: [{
          type: "text",
          text: `### [ADR-${r.id}] ${r.title}\n` +
                `• **Status**: \`${r.status}\`\n\n` +
                `**Context**:\n${r.context || "N/A"}\n\n` +
                `**Decision**:\n${r.decision || "N/A"}\n\n` +
                `**Consequences**:\n${r.consequences || "N/A"}`
        }]
      };
    }

    if (action === "create") {
      if (!title || !decision) {
        return { content: [{ type: "text", text: "Please provide both 'title' and 'decision' to create an ADR." }], isError: true };
      }
      const now = Date.now();
      const safeTitle = title.replace(/'/g, "''");
      const safeDec = decision.replace(/'/g, "''");
      const safeCtx = context.replace(/'/g, "''");
      const safeCons = consequences.replace(/'/g, "''");

      await execSqlBatch(
        graphDb,
        `INSERT INTO adr (title, status, context, decision, consequences, created_at)
         VALUES ('${safeTitle}', '${status}', '${safeCtx}', '${safeDec}', '${safeCons}', ${now});`
      );

      return {
        content: [{ type: "text", text: `ADR created successfully: **${title}** (status: \`${status}\`)` }]
      };
    }
  }
);

// ---------------------------------------------------------------------------
// 10. GET_GRAPH_SCHEMA
// ---------------------------------------------------------------------------
server.tool(
  "get_graph_schema",
  "Introspect available tables, column definitions, and relationship schemas in the codebase graph.",
  {
    path: z.string().optional().describe(`Target repository path. Defaults to ${DEFAULT_WORKSPACE}`)
  },
  async ({ path: targetPath }) => {
    const graphDb = resolveDbPath(targetPath);
    try {
      const schema = await new Promise((res, rej) => {
        execFile("sqlite3", [graphDb, ".schema"], (err, stdout) => {
          if (err) return rej(err);
          res(stdout);
        });
      });
      return { content: [{ type: "text", text: `### Codebase Graph Schema\n\`\`\`sql\n${schema.trim()}\n\`\`\`` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error reading schema: ${err.message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// 11. LIGHTWEIGHT UTILITIES (Token-Saver tools)
// ---------------------------------------------------------------------------
function extractOutline(content, ext) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const normalizedExt = (ext || "").toLowerCase();

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    if (normalizedExt === ".py") {
      if (/^(?:async\s+)?def\s+([A-Za-z0-9_]+)\s*\(/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/:.*$/, "")}`);
      } else if (/^class\s+([A-Za-z0-9_]+)/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/:.*$/, "")}`);
      }
    } else if ([".sh", ".bash", ".zsh"].includes(normalizedExt)) {
      if (trimmed.startsWith("#")) return;
      if (/^(?:function\s+)?([A-Za-z0-9_-]+)\s*\(\)\s*\{?/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed}`);
      } else if (/^alias\s+([A-Za-z0-9_-]+)=/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed}`);
      }
    } else if (normalizedExt === ".go") {
      if (trimmed.startsWith("//")) return;
      if (/^func\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_]+)\s*\(/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/\{.*$/, "").trim()}`);
      } else if (/^type\s+([A-Za-z0-9_]+)\s+(?:struct|interface)/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/\{.*$/, "").trim()}`);
      }
    } else if (normalizedExt === ".rs") {
      if (trimmed.startsWith("//")) return;
      if (/^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/\{.*$/, "").trim()}`);
      } else if (/^(?:pub\s+)?(?:struct|enum|trait|impl)\s+([A-Za-z0-9_]+)/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/\{.*$/, "").trim()}`);
      }
    } else if (normalizedExt === ".php") {
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) return;
      if (/^(?:(?:public|protected|private|static|final|abstract)\s+)*(?:function\s+([A-Za-z0-9_]+)|class\s+([A-Za-z0-9_]+)|trait\s+([A-Za-z0-9_]+)|interface\s+([A-Za-z0-9_]+))/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/\{.*$/, "").trim()}`);
      }
    } else if (normalizedExt === ".json") {
      const m = line.match(/^\s*"([^"]+)"\s*:\s*([{\[]|[^\n,]+)/);
      if (m && !line.startsWith("    ")) {
        symbols.push(`L${lineNum}: "${m[1]}"`);
      }
    } else if ([".yaml", ".yml"].includes(normalizedExt)) {
      if (/^[A-Za-z0-9_-]+:/.test(line)) {
        symbols.push(`L${lineNum}: ${trimmed}`);
      }
    } else if (normalizedExt === ".md") {
      if (/^#{1,4}\s+/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed}`);
      }
    } else {
      // JS, TS, JSX, TSX, CJS, MJS
      if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;
      if (/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z0-9_]+)?\s*\(/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/\{.*$/, "").trim()}`);
      } else if (/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/\{.*$/, "").trim()}`);
      } else if (/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/=>.*/, "=>").trim()}`);
      } else if (/^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z0-9_]+)/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed.replace(/\{.*$/, "").trim()}`);
      } else if (/^(?:export\s+default|module\.exports\s*=)/.test(trimmed)) {
        symbols.push(`L${lineNum}: ${trimmed}`);
      } else if (/^\s*(?:async\s+)?([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/.test(line)) {
        const m = line.match(/^\s*(?:async\s+)?([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/);
        if (m && !["if", "for", "while", "switch", "catch"].includes(m[1])) {
          symbols.push(`L${lineNum}: ${trimmed.replace(/\{.*$/, "").trim()}`);
        }
      }
    }
  });

  return symbols;
}

server.tool(
  "code_outline",
  "Extract structural symbols (functions, classes, exports, types) with line numbers from JS, TS, Python, Bash, Go, Rust, PHP, JSON, YAML, or Markdown files. Saves 90%+ tokens.",
  {
    file_path: z.string().describe("Path to the source file to inspect")
  },
  async ({ file_path }) => {
    try {
      const resolvedPath = path.resolve(file_path);
      const content = await fs.readFile(resolvedPath, "utf-8");
      const ext = path.extname(resolvedPath);
      const symbols = extractOutline(content, ext);

      return {
        content: [{
          type: "text",
          text: symbols.length > 0
            ? `### Outline for \`${path.basename(resolvedPath)}\` (${symbols.length} symbols)\n` + symbols.join("\n")
            : `No top-level symbols found in \`${path.basename(resolvedPath)}\`.`
        }]
      };
    } catch (err) {
      return { content: [{ type: "text", text: `Error reading file ${file_path}: ${err.message}` }], isError: true };
    }
  }
);

async function resolveSqliteDb(customPath) {
  if (customPath) {
    const resolved = path.resolve(customPath);
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      throw new Error(`Database file not found at: ${resolved}`);
    }
  }

  const candidates = [
    "/data/data/com.termux/files/home/Joy/data/database.db",
    "/data/data/com.termux/files/home/Joy/.codebase_graph.db",
    path.join(process.cwd(), ".codebase_graph.db")
  ];

  for (const cand of candidates) {
    try {
      await fs.access(cand);
      return cand;
    } catch {}
  }

  throw new Error("No default database found. Please specify 'db_path' pointing to your SQLite database file.");
}

server.tool(
  "sqlite_query",
  "Execute a targeted SQL query on a SQLite database. Returns compact JSON.",
  {
    sql: z.string().describe("SQL query to run"),
    db_path: z.string().optional().describe("Path to SQLite database file")
  },
  async ({ sql, db_path }) => {
    try {
      const targetDb = await resolveSqliteDb(db_path);
      return new Promise((resolve) => {
        execFile("sqlite3", [targetDb, "-json", sql], { maxBuffer: 1024 * 1024 * 5 }, (err, stdout, stderr) => {
          if (err) {
            resolve({ content: [{ type: "text", text: `SQL Error: ${stderr || err.message}` }], isError: true });
          } else {
            let res = stdout.trim() || "[] (No rows returned)";
            if (res.length > 12000) {
              res = res.slice(0, 12000) + "\n\n...[Truncated - limit reached]";
            }
            resolve({ content: [{ type: "text", text: res }] });
          }
        });
      });
    } catch (err) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  }
);

server.tool(
  "sqlite_schema",
  "Get compact schema and table definitions for a SQLite database without returning data rows.",
  {
    table: z.string().optional().describe("Optional specific table name"),
    db_path: z.string().optional().describe("Path to SQLite database file")
  },
  async ({ table, db_path }) => {
    try {
      const targetDb = await resolveSqliteDb(db_path);
      const args = [targetDb, ".schema"];
      if (table) args.push(table);
      return new Promise((resolve) => {
        execFile("sqlite3", args, (err, stdout, stderr) => {
          if (err) resolve({ content: [{ type: "text", text: `Schema Error: ${stderr || err.message}` }], isError: true });
          else resolve({ content: [{ type: "text", text: stdout.trim() || "(Empty schema)" }] });
        });
      });
    } catch (err) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
  }
);

async function scrapeUrl({ url, selector, mode = "markdown", max_chars = 12000, headers = {} }) {
  try {
    const defaultHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
      "Accept-Language": "id,en-US;q=0.9,en;q=0.8",
      ...headers
    };

    const response = await fetch(url, {
      headers: defaultHeaders,
      signal: AbortSignal.timeout(25000),
      redirect: "follow"
    });

    if (!response.ok) {
      return { content: [{ type: "text", text: `HTTP Error: ${response.status} ${response.statusText} for URL: ${url}` }], isError: true };
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json") || mode === "json") {
      const rawText = await response.text();
      try {
        const parsed = JSON.parse(rawText);
        let out = JSON.stringify(parsed, null, 2);
        if (out.length > max_chars) out = out.slice(0, max_chars) + "\n\n...[Truncated - limit reached]";
        return { content: [{ type: "text", text: out }] };
      } catch {
        // Fallback to HTML/text processing
      }
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract metadata
    const title = $("title").first().text().trim() || $('meta[property="og:title"]').attr("content") || "";
    const description = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";

    // Remove noise elements
    $("script, style, noscript, svg, iframe, canvas, meta, link").remove();

    let target = null;
    let selectorNote = "";
    if (selector) {
      target = $(selector);
      if (!target || target.length === 0) {
        selectorNote = `> [!NOTE]\n> Selector \`${selector}\` not found; falling back to main body content.\n\n`;
        target = $("main").length ? $("main") : ($("article").length ? $("article") : $("body"));
        target.find("nav, footer, header, aside, form, dialog, .cookie-banner, .advertisement, #cookie-notice").remove();
      }
    } else {
      target = $("main").length ? $("main") : ($("article").length ? $("article") : $("body"));
      target.find("nav, footer, header, aside, form, dialog, .cookie-banner, .advertisement, #cookie-notice").remove();
    }

    let output = "";

    if (mode === "html") {
      output = selector ? (target.prop("outerHTML") || target.html() || "") : $("body").html();
    } else if (mode === "links") {
      const links = [];
      const seen = new Set();
      (selector ? target.find("a") : $("a")).each((_, el) => {
        const rawHref = $(el).attr("href");
        if (!rawHref || rawHref.startsWith("javascript:") || rawHref.startsWith("#")) return;
        try {
          const resolved = new URL(rawHref, url).href;
          const text = $(el).text().trim().replace(/\s+/g, " ");
          if (text && !seen.has(resolved)) {
            seen.add(resolved);
            links.push({ text, url: resolved });
          }
        } catch {}
      });
      output = JSON.stringify(links, null, 2);
    } else if (mode === "tables") {
      const tables = [];
      const tableEls = selector ? target.filter("table").add(target.find("table")) : $("table");
      tableEls.each((idx, tableEl) => {
        const tableHeaders = [];
        $(tableEl).find("thead tr th, tr:first-child th").each((_, th) => {
          tableHeaders.push($(th).text().trim());
        });
        const rows = [];
        $(tableEl).find("tbody tr, tr").each((_, tr) => {
          const cells = [];
          $(tr).find("td").each((_, td) => {
            cells.push($(td).text().trim().replace(/\s+/g, " "));
          });
          if (cells.length > 0) rows.push(cells);
        });
        tables.push({ index: idx + 1, headers: tableHeaders, rows });
      });
      output = JSON.stringify(tables, null, 2);
    } else if (mode === "text") {
      output = target.text().replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();
    } else {
      // Default: clean structured markdown
      let metaHeader = "";
      if (title) metaHeader += `# ${title}\n`;
      if (description) metaHeader += `> ${description}\n\n`;

      target.find("h1, h2, h3, h4, h5, h6").each((_, el) => {
        const tag = el.tagName ? el.tagName.toLowerCase() : "h2";
        const level = tag[1] || "2";
        const prefix = "#".repeat(Number(level)) + " ";
        $(el).prepend(prefix).append("\n\n");
      });
      target.find("p").each((_, el) => {
        $(el).append("\n\n");
      });
      target.find("li").each((_, el) => {
        $(el).prepend("• ").append("\n");
      });
      target.find("br").replaceWith("\n");
      target.find("a").each((_, el) => {
        const href = $(el).attr("href");
        const linkText = $(el).text().trim();
        if (href && linkText && !href.startsWith("javascript:")) {
          try {
            const resolved = new URL(href, url).href;
            $(el).text(`[${linkText}](${resolved})`);
          } catch {}
        }
      });
      output = metaHeader + target.text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    }

    if (selectorNote) {
      output = selectorNote + output;
    }

    if (output && output.length > max_chars) {
      output = output.slice(0, max_chars) + "\n\n...[Truncated - limit reached]";
    }

    return { content: [{ type: "text", text: output || "(Empty content)" }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Scrape Error (${url}): ${err.message}` }], isError: true };
  }
}

server.tool(
  "web_reader",
  "Fetch URL and extract clean, token-dense markdown content or structured data.",
  {
    url: z.string().url().describe("Target URL to fetch"),
    selector: z.string().optional().describe("Optional CSS selector to extract specific elements (e.g. 'article', 'main', '.content')"),
    mode: z.enum(["markdown", "text", "html", "links", "tables", "json"]).optional().describe("Extraction mode: markdown (default), text, html, links, tables, or json"),
    max_chars: z.number().optional().describe("Maximum character length (default 12000)")
  },
  async ({ url, selector, mode = "markdown", max_chars = 12000 }) => {
    return scrapeUrl({ url, selector, mode, max_chars });
  }
);

server.tool(
  "scrape_web",
  "Scrape and extract structured content (text, markdown, links, tables, or HTML) from any web page using CSS selectors.",
  {
    url: z.string().url().describe("Target URL to scrape"),
    selector: z.string().optional().describe("CSS selector to target specific DOM elements (e.g. 'article', 'main', '.post', 'table')"),
    mode: z.enum(["markdown", "text", "html", "links", "tables", "json"]).optional().describe("Extraction mode: 'markdown' (default), 'text', 'html', 'links', 'tables', or 'json'"),
    max_chars: z.number().optional().describe("Maximum character length (default 15000)")
  },
  async ({ url, selector, mode = "markdown", max_chars = 15000 }) => {
    return scrapeUrl({ url, selector, mode, max_chars });
  }
);

const transport = new StdioServerTransport();

const cleanup = async () => {
  try {
    await server.close();
  } catch {}
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.stdin.on("close", cleanup);
process.stdin.on("end", cleanup);

process.on("uncaughtException", (err) => {
  console.error("[MCP Error] Uncaught exception:", err?.message || err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[MCP Error] Unhandled rejection:", reason);
});

await server.connect(transport);
