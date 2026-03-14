/**
 * Data Connector — Soul connects to ANY database or API
 *
 * Supported:
 * 1. MySQL / MariaDB
 * 2. PostgreSQL
 * 3. MongoDB
 * 4. REST API (GET/POST)
 * 5. Google Sheets
 * 6. SQLite (external files)
 * 7. CSV/JSON files
 *
 * All drivers are optional — install only what you need:
 *   npm install mysql2        # for MySQL
 *   npm install pg            # for PostgreSQL
 *   npm install mongodb       # for MongoDB
 */

import { getRawDb } from "../db/index.js";

// ─── Connection Registry ───

interface DataConnection {
  id: number;
  name: string;
  type: "mysql" | "postgres" | "mongodb" | "rest" | "sqlite" | "sheets";
  config: string; // JSON
  isActive: boolean;
  createdAt: string;
}

let _tableReady = false;

function ensureTable() {
  if (_tableReady) return;
  const db = getRawDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS soul_data_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  _tableReady = true;
}

// ─── Connection Management ───

export function addConnection(input: {
  name: string;
  type: string;
  config: Record<string, any>;
}): { success: boolean; message: string } {
  ensureTable();
  const db = getRawDb();
  try {
    db.prepare("INSERT OR REPLACE INTO soul_data_connections (name, type, config) VALUES (?, ?, ?)")
      .run(input.name, input.type, JSON.stringify(input.config));
    return { success: true, message: `Connection "${input.name}" (${input.type}) saved.` };
  } catch (e: any) {
    return { success: false, message: `Failed: ${e.message}` };
  }
}

export function listConnections(): DataConnection[] {
  ensureTable();
  const db = getRawDb();
  return (db.prepare("SELECT * FROM soul_data_connections ORDER BY created_at DESC").all() as any[])
    .map(r => ({ id: r.id, name: r.name, type: r.type, config: r.config, isActive: r.is_active === 1, createdAt: r.created_at }));
}

export function removeConnection(name: string): boolean {
  ensureTable();
  const db = getRawDb();
  return db.prepare("DELETE FROM soul_data_connections WHERE name = ?").run(name).changes > 0;
}

function getConnection(name: string): DataConnection | null {
  ensureTable();
  const db = getRawDb();
  const row = db.prepare("SELECT * FROM soul_data_connections WHERE name = ? AND is_active = 1").get(name) as any;
  if (!row) return null;
  return { id: row.id, name: row.name, type: row.type, config: row.config, isActive: true, createdAt: row.created_at };
}

// ─── Query Engine ───

export async function queryData(
  connectionName: string,
  query: string,
  params?: any[],
): Promise<{ success: boolean; data: any[]; rowCount: number; message: string }> {
  const conn = getConnection(connectionName);
  if (!conn) {
    return { success: false, data: [], rowCount: 0, message: `Connection "${connectionName}" not found. Use soul_db_connect to add one.` };
  }

  const config = JSON.parse(conn.config);

  switch (conn.type) {
    case "mysql":
      return queryMySQL(config, query, params);
    case "postgres":
      return queryPostgres(config, query, params);
    case "mongodb":
      return queryMongoDB(config, query);
    case "rest":
      return queryREST(config, query);
    case "sqlite":
      return querySQLite(config, query, params);
    case "sheets":
      return querySheets(config, query);
    default:
      return { success: false, data: [], rowCount: 0, message: `Unknown connection type: ${conn.type}` };
  }
}

// ─── MySQL ───

async function queryMySQL(
  config: { host: string; port?: number; user: string; password: string; database: string },
  query: string,
  params?: any[],
): Promise<{ success: boolean; data: any[]; rowCount: number; message: string }> {
  try {
    const mysql = await (eval('import("mysql2/promise")') as Promise<any>);
    const connection = await mysql.createConnection({
      host: config.host,
      port: config.port || 3306,
      user: config.user,
      password: config.password,
      database: config.database,
    });
    const [rows] = await connection.execute(query, params || []);
    await connection.end();
    const data = Array.isArray(rows) ? rows : [];
    return { success: true, data: data.slice(0, 100), rowCount: data.length, message: `${data.length} rows returned` };
  } catch (e: any) {
    if (/Cannot find module/i.test(e.message)) {
      return { success: false, data: [], rowCount: 0, message: "MySQL driver not installed. Run: npm install mysql2" };
    }
    return { success: false, data: [], rowCount: 0, message: `MySQL error: ${e.message}` };
  }
}

// ─── PostgreSQL ───

async function queryPostgres(
  config: { host: string; port?: number; user: string; password: string; database: string },
  query: string,
  params?: any[],
): Promise<{ success: boolean; data: any[]; rowCount: number; message: string }> {
  try {
    const { default: pg } = await (eval('import("pg")') as Promise<any>);
    const client = new pg.Client({
      host: config.host,
      port: config.port || 5432,
      user: config.user,
      password: config.password,
      database: config.database,
    });
    await client.connect();
    const result = await client.query(query, params || []);
    await client.end();
    return { success: true, data: result.rows.slice(0, 100), rowCount: result.rowCount || 0, message: `${result.rowCount} rows returned` };
  } catch (e: any) {
    if (/Cannot find module/i.test(e.message)) {
      return { success: false, data: [], rowCount: 0, message: "PostgreSQL driver not installed. Run: npm install pg" };
    }
    return { success: false, data: [], rowCount: 0, message: `PostgreSQL error: ${e.message}` };
  }
}

// ─── MongoDB ───

async function queryMongoDB(
  config: { uri: string; database: string; collection?: string },
  query: string, // JSON string: { collection, filter, limit }
): Promise<{ success: boolean; data: any[]; rowCount: number; message: string }> {
  try {
    const { MongoClient } = await (eval('import("mongodb")') as Promise<any>);
    const client = new MongoClient(config.uri);
    await client.connect();
    const db = client.db(config.database);

    let parsed: any;
    try { parsed = JSON.parse(query); } catch { parsed = { collection: config.collection || "test", filter: {} }; }

    const collection = db.collection(parsed.collection || config.collection || "test");
    const docs = await collection.find(parsed.filter || {}).limit(parsed.limit || 100).toArray();
    await client.close();
    return { success: true, data: docs, rowCount: docs.length, message: `${docs.length} documents returned` };
  } catch (e: any) {
    if (/Cannot find module/i.test(e.message)) {
      return { success: false, data: [], rowCount: 0, message: "MongoDB driver not installed. Run: npm install mongodb" };
    }
    return { success: false, data: [], rowCount: 0, message: `MongoDB error: ${e.message}` };
  }
}

// ─── REST API ───

async function queryREST(
  config: { baseUrl: string; headers?: Record<string, string>; auth?: string },
  query: string, // URL path or JSON: { method, path, body }
): Promise<{ success: boolean; data: any[]; rowCount: number; message: string }> {
  try {
    let method = "GET";
    let path = query;
    let body: string | undefined;

    try {
      const parsed = JSON.parse(query);
      method = parsed.method || "GET";
      path = parsed.path || parsed.url || "/";
      body = parsed.body ? JSON.stringify(parsed.body) : undefined;
    } catch { /* query is just a path */ }

    const url = config.baseUrl.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json", ...config.headers };
    if (config.auth) headers["Authorization"] = config.auth;

    const res = await fetch(url, {
      method,
      headers,
      body: method !== "GET" ? body : undefined,
      signal: AbortSignal.timeout(30000),
    });

    const text = await res.text();
    let data: any[];
    try {
      const json = JSON.parse(text);
      data = Array.isArray(json) ? json : [json];
    } catch {
      data = [{ response: text.substring(0, 5000) }];
    }

    return { success: res.ok, data: data.slice(0, 100), rowCount: data.length, message: `HTTP ${res.status}: ${data.length} items` };
  } catch (e: any) {
    return { success: false, data: [], rowCount: 0, message: `REST error: ${e.message}` };
  }
}

// ─── SQLite (external files) ───

async function querySQLite(
  config: { path: string },
  query: string,
  params?: any[],
): Promise<{ success: boolean; data: any[]; rowCount: number; message: string }> {
  try {
    const { default: Database } = await import("better-sqlite3");
    const db = new Database(config.path, { readonly: true });
    const rows = db.prepare(query).all(...(params || []));
    db.close();
    return { success: true, data: rows.slice(0, 100), rowCount: rows.length, message: `${rows.length} rows returned` };
  } catch (e: any) {
    return { success: false, data: [], rowCount: 0, message: `SQLite error: ${e.message}` };
  }
}

// ─── Google Sheets ───

async function querySheets(
  config: { spreadsheetId: string; apiKey: string; range?: string },
  query: string, // sheet name or range like "Sheet1!A1:D10"
): Promise<{ success: boolean; data: any[]; rowCount: number; message: string }> {
  try {
    const range = query || config.range || "Sheet1";
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(range)}?key=${config.apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { success: false, data: [], rowCount: 0, message: `Sheets API error: ${res.status}` };

    const json = await res.json() as any;
    const rows = json.values || [];
    // Convert to objects using first row as headers
    if (rows.length > 1) {
      const headers = rows[0];
      const data = rows.slice(1).map((row: any[]) => {
        const obj: Record<string, any> = {};
        headers.forEach((h: string, i: number) => { obj[h] = row[i] || ""; });
        return obj;
      });
      return { success: true, data, rowCount: data.length, message: `${data.length} rows from ${range}` };
    }
    return { success: true, data: rows, rowCount: rows.length, message: `${rows.length} rows` };
  } catch (e: any) {
    return { success: false, data: [], rowCount: 0, message: `Sheets error: ${e.message}` };
  }
}

// ─── Analyze Data ───

export function analyzeData(data: any[]): string {
  if (!data || data.length === 0) return "No data to analyze.";

  const lines: string[] = [];
  lines.push(`Records: ${data.length}`);

  // Column info
  if (typeof data[0] === "object") {
    const keys = Object.keys(data[0]);
    lines.push(`Columns: ${keys.join(", ")}`);

    // Basic stats for numeric columns
    for (const key of keys) {
      const values = data.map(r => r[key]).filter(v => v !== null && v !== undefined);
      const numbers = values.filter(v => typeof v === "number" || !isNaN(Number(v))).map(Number);
      if (numbers.length > data.length * 0.5) {
        const sum = numbers.reduce((a, b) => a + b, 0);
        const avg = sum / numbers.length;
        const min = Math.min(...numbers);
        const max = Math.max(...numbers);
        lines.push(`  ${key}: avg=${avg.toFixed(2)}, min=${min}, max=${max}, sum=${sum.toFixed(2)}`);
      } else {
        // Categorical — show top values
        const counts: Record<string, number> = {};
        values.forEach(v => { counts[String(v)] = (counts[String(v)] || 0) + 1; });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
        lines.push(`  ${key}: ${top.map(([v, c]) => `${v}(${c})`).join(", ")}`);
      }
    }
  }

  // Sample rows
  lines.push(`\nSample (first 5):`);
  for (const row of data.slice(0, 5)) {
    lines.push(`  ${JSON.stringify(row).substring(0, 200)}`);
  }

  return lines.join("\n");
}
