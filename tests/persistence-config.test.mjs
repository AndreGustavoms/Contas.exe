import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";

function runNode(code, overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of [
    "DATABASE_URL",
    "DB_HOST",
    "DB_PORT",
    "DB_USER",
    "DB_PASSWORD",
    "DB_NAME",
  ]) {
    if (!(key in overrides)) delete env[key];
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (codeValue, signal) =>
      resolve({ code: codeValue, signal, stdout, stderr }),
    );
  });
}

test("produção falha fechado sem PostgreSQL configurado", async () => {
  const result = await runNode(
    'import { initDb } from "./server/db.mjs"; await initDb();',
    { NODE_ENV: "production" },
  );

  assert.notEqual(result.code, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /PostgreSQL não configurado/,
  );
});

test("fallback JSON exige opt-in explícito fora de produção", async () => {
  const result = await runNode(
    'import { initDb } from "./server/db.mjs"; const connected = await initDb(); if (connected) process.exitCode = 2;',
    {
      NODE_ENV: "test",
      CONTAS_FLOW_ALLOW_JSON_FALLBACK: "true",
    },
  );

  assert.equal(result.code, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /Fallback JSON explícito habilitado/,
  );
});
