// PostgreSQL connection pool and query helpers.
// Replaces the JSON-based storage with transactional, multi-instance-safe,
// indexed and searchable persistence. The connection string comes from
// DATABASE_URL (standard on Railway/Heroku/etc.), or you can build it from
// DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME for custom setups.
//
// Migration strategy: the server attempts to connect at startup; if DATABASE_URL
// is unset or connection fails, it falls back to the legacy JSON storage (so
// existing deployments don't break). New installs default to PostgreSQL.

import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { Pool } = pg;

const here = dirname(fileURLToPath(import.meta.url));

let pool = null;
let connected = false;

// Connection string from DATABASE_URL (Railway/Heroku standard), or composed
// from individual variables.
function getConnectionString() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";
  const user = process.env.DB_USER ?? "postgres";
  const password = process.env.DB_PASSWORD ?? "";
  const database = process.env.DB_NAME ?? "contas_flow";
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

// Initializes the pool and tests connectivity. Called once at startup.
export async function initDb() {
  const connectionString = getConnectionString();
  if (!connectionString || connectionString === "postgresql://:@localhost:5432/contas_flow") {
    console.log("PostgreSQL não configurado (DATABASE_URL ausente). Usando JSON storage.");
    return false;
  }

  try {
    // SSL: Railway/Heroku use self-signed certs so rejectUnauthorized must be
    // false by default in cloud deployments. Set PGSSLMODE=disable to turn SSL
    // off entirely (local dev), or PGSSLMODE=verify-full with PGSSLROOTCERT to
    // enforce full certificate verification when a CA cert is available.
    const sslMode = process.env.PGSSLMODE ?? (process.env.NODE_ENV === "production" ? "require" : "disable");
    let sslConfig;
    if (sslMode === "disable") {
      sslConfig = false;
    } else if (sslMode === "verify-full") {
      sslConfig = { rejectUnauthorized: true };
    } else {
      sslConfig = { rejectUnauthorized: false };
    }

    pool = new Pool({
      connectionString,
      ssl: sslConfig,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test the connection
    const client = await pool.connect();
    await client.query("SELECT NOW()");
    client.release();

    connected = true;
    console.log("✅ PostgreSQL conectado:", connectionString.replace(/:[^:@]+@/, ":***@"));

    // Aplica o schema no boot. Tudo em schema.sql é idempotente (IF NOT EXISTS /
    // ADD COLUMN IF NOT EXISTS / DROP+CREATE TRIGGER), então re-executar é seguro
    // e mantém o banco de produção em dia com novas colunas sem migração manual.
    await applySchema();
    return true;
  } catch (error) {
    console.error("❌ Falha ao conectar PostgreSQL:", error.message);
    console.log("Fallback: usando JSON storage.");
    pool = null;
    connected = false;
    return false;
  }
}

// Splits a SQL script into individual statements on top-level semicolons,
// respecting single-quoted strings, dollar-quoted blocks ($$...$$ / $tag$...$tag$),
// line comments (--) and block comments (/* */). Needed so we can run each
// statement on its own — a naive split on ";" would break function/DO bodies.
function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // line comment
    if (ch === "-" && next === "-") {
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? n : nl;
      current += sql.slice(i, end);
      i = end;
      continue;
    }
    // block comment
    if (ch === "/" && next === "*") {
      const close = sql.indexOf("*/", i + 2);
      const end = close === -1 ? n : close + 2;
      current += sql.slice(i, end);
      i = end;
      continue;
    }
    // single-quoted string
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j += 1; break; }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }
    // dollar-quoted block ($$ or $tag$)
    if (ch === "$") {
      const tagMatch = /^\$[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? n : close + tag.length;
        current += sql.slice(i, end);
        i = end;
        continue;
      }
    }
    // statement terminator
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

// Runs server/schema.sql against the connected database. Idempotent: safe to run
// on every startup. Each statement runs on its OWN implicit transaction, so a
// single failure (e.g. an index over a column an older deploy lacks) never blocks
// the others — the critical ADD COLUMN / CREATE TABLE statements still apply.
// Failures are logged, never thrown, so a schema hiccup can't block boot.
async function applySchema() {
  let sql;
  try {
    sql = await readFile(join(here, "schema.sql"), "utf8");
  } catch (error) {
    console.error("⚠️  Não foi possível ler schema.sql:", error.message);
    return;
  }
  const statements = splitSqlStatements(sql);
  let applied = 0;
  let failed = 0;
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      applied += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `⚠️  Statement do schema falhou (seguindo adiante): ${error.message} | ${stmt.slice(0, 80).replace(/\s+/g, " ")}…`,
      );
    }
  }
  console.log(`✅ Schema aplicado: ${applied} statements OK${failed ? `, ${failed} com erro (ignorados)` : ""}.`);
}

// Whether the PostgreSQL connection is live. Other modules check this to decide
// between SQL queries and JSON fallback.
export function isConnected() {
  return connected;
}

// Executes a query. Throws on error (caller handles with try/catch).
export async function query(text, params) {
  if (!pool) {
    throw new Error("PostgreSQL não inicializado. Use initDb() no startup.");
  }
  return pool.query(text, params);
}

// Acquires a client from the pool for multi-statement transactions. The caller
// must release() it when done (use try/finally to guarantee release).
export async function getClient() {
  if (!pool) {
    throw new Error("PostgreSQL não inicializado.");
  }
  return pool.connect();
}

// Graceful shutdown: closes all connections. Called on SIGTERM/SIGINT.
export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
    connected = false;
    console.log("PostgreSQL pool fechado.");
  }
}
