// PostgreSQL connection pool and query helpers.
// Replaces the JSON-based storage with transactional, multi-instance-safe,
// indexed and searchable persistence. The connection string comes from
// DATABASE_URL (standard on Railway/Heroku/etc.), or you can build it from
// DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME for custom setups.
//
// Migration strategy: PostgreSQL is the shared store for production and
// multi-instance deployments. The legacy JSON store is available only when a
// local operator explicitly opts into it with CONTAS_FLOW_ALLOW_JSON_FALLBACK.

import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { Pool } = pg;

const here = dirname(fileURLToPath(import.meta.url));

let pool = null;
let connected = false;

const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
];

function hasDatabaseConfiguration() {
  return DATABASE_ENV_KEYS.some((key) => {
    const value = process.env[key];
    return typeof value === "string" && value.trim() !== "";
  });
}

export function databaseRequired() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.CONTAS_FLOW_REQUIRE_DATABASE === "true"
  );
}

function jsonFallbackAllowed() {
  return (
    !databaseRequired() &&
    process.env.CONTAS_FLOW_ALLOW_JSON_FALLBACK === "true"
  );
}

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
  if (!hasDatabaseConfiguration()) {
    const message =
      "PostgreSQL não configurado. Defina DATABASE_URL para persistência " +
      "compartilhada ou CONTAS_FLOW_ALLOW_JSON_FALLBACK=true apenas em uso local legado.";
    if (!jsonFallbackAllowed()) {
      throw new Error(message);
    }
    console.warn(`${message} Fallback JSON explícito habilitado.`);
    return false;
  }

  const connectionString = getConnectionString();

  try {
    // SSL: Railway/Heroku use self-signed certs so rejectUnauthorized must be
    // false by default in cloud deployments. Set PGSSLMODE=disable to turn SSL
    // off entirely (local dev), or PGSSLMODE=verify-full with PGSSLROOTCERT to
    // enforce full certificate verification when a CA cert is available.
    const sslMode =
      process.env.PGSSLMODE ??
      (process.env.NODE_ENV === "production" ? "require" : "disable");
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

    // Testa a conexao antes de aplicar o schema.
    const client = await pool.connect();
    try {
      await client.query("SELECT NOW()");
    } finally {
      client.release();
    }

    await applySchema();
    connected = true;
    console.log(
      "✅ PostgreSQL conectado:",
      connectionString.replace(/:[^:@]+@/, ":***@"),
    );

    return true;
  } catch (error) {
    console.error("❌ Falha ao inicializar PostgreSQL:", error.message);
    if (pool) {
      await pool.end().catch(() => undefined);
    }
    pool = null;
    connected = false;
    if (!jsonFallbackAllowed()) {
      throw new Error(
        "PostgreSQL obrigatório, mas a conexão falhou. O servidor foi " +
          "mantido desligado para evitar split-brain em armazenamento local.",
        { cause: error },
      );
    }
    console.warn(
      "Fallback JSON explícito habilitado após falha do PostgreSQL.",
    );
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
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
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
// on every startup. Each statement runs on its OWN implicit transaction, so the
// remaining independent statements can still be attempted after one failure.
// Failures are collected and thrown at the end: an incomplete schema must never
// release the application with a false "connected" state.
async function applySchema() {
  let sql;
  try {
    sql = await readFile(join(here, "schema.sql"), "utf8");
  } catch (error) {
    console.error("Falha ao ler schema.sql:", error.message);
    throw new Error("Não foi possível carregar o schema do PostgreSQL.", {
      cause: error,
    });
  }
  const statements = splitSqlStatements(sql);
  let applied = 0;
  let failed = 0;
  let firstFailure = null;
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
      applied += 1;
    } catch (error) {
      failed += 1;
      firstFailure ??= error;
      console.error(
        `⚠️  Statement do schema falhou (seguindo adiante): ${error.message} | ${stmt.slice(0, 80).replace(/\s+/g, " ")}…`,
      );
    }
  }
  console.log(
    `✅ Schema aplicado: ${applied} statements OK${failed ? `, ${failed} com erro (ignorados)` : ""}.`,
  );
  if (failed > 0) {
    throw new Error(
      `Schema do PostgreSQL incompleto: ${failed} statement(s) falharam.`,
      { cause: firstFailure },
    );
  }
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
