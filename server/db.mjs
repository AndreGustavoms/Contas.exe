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

const { Pool } = pg;

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
    return true;
  } catch (error) {
    console.error("❌ Falha ao conectar PostgreSQL:", error.message);
    console.log("Fallback: usando JSON storage.");
    pool = null;
    connected = false;
    return false;
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
