import { spawn } from "node:child_process";

const apiEnv = { ...process.env, PORT: process.env.PORT ?? "8787" };
const hasDatabaseConfiguration = [
  "DATABASE_URL",
  "DB_HOST",
  "DB_PORT",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
].some((key) => apiEnv[key]?.trim());
if (!hasDatabaseConfiguration && !apiEnv.CONTAS_FLOW_ALLOW_JSON_FALLBACK) {
  // npm run local é o modo legado de instância única; o servidor de produção
  // continua exigindo PostgreSQL e nunca ativa esse fallback sozinho.
  apiEnv.CONTAS_FLOW_ALLOW_JSON_FALLBACK = "true";
}

const api = spawn(process.execPath, ["server/index.mjs"], {
  env: apiEnv,
  stdio: "inherit",
});

const vite = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5175"],
  {
    env: { ...process.env },
    stdio: "inherit",
  },
);

function stop() {
  api.kill();
  vite.kill();
}

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});

api.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});

vite.on("exit", (code) => {
  api.kill();
  process.exit(code ?? 0);
});
