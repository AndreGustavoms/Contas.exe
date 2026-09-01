import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import pg from "pg";
import { test } from "node:test";

const { Pool } = pg;
const databaseUrl = process.env.CONTAS_FLOW_TEST_DATABASE_URL;

function startServer(port, storageDir) {
  const child = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      CONTAS_FLOW_REQUIRE_DATABASE: "true",
      CONTAS_FLOW_STORAGE_DIR: storageDir,
      CONTAS_FLOW_COOKIE_SECURE: "0",
      CONTAS_FLOW_REGISTRATIONS_OPEN: "true",
      APP_AUTH_USER: "",
      APP_AUTH_PASSWORD: "",
      CONTAS_FLOW_FIXED_SUPERADMIN: "0",
      PORT: String(port),
      HOST: "127.0.0.1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  child.startupOutput = () => output;
  return child;
}

async function waitForServer(baseUrl, child) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.exitCode != null) {
      throw new Error(`server_not_ready: ${child.startupOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // O processo ainda está aplicando o schema ou iniciando o listener.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server_not_ready: ${child.startupOutput()}`);
}

async function stopServer(child) {
  if (child.exitCode != null) return;
  child.kill();
  await Promise.race([
    once(child, "close"),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode == null) child.kill("SIGKILL");
}

async function jsonRequest(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  assert.ok(value, "login deve devolver cookie");
  return value.split(";")[0];
}

test(
  "duas instâncias preservam gravações concorrentes no mesmo grupo",
  { skip: !databaseUrl },
  async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const username = `concorrencia_${suffix}`;
    const password = "Concorrencia@123";
    const ports = [
      32000 + Math.floor(Math.random() * 500),
      32500 + Math.floor(Math.random() * 500),
    ];
    const bases = ports.map((port) => `http://127.0.0.1:${port}`);
    const storageDirs = await Promise.all(
      [0, 1].map(() => mkdtemp(join(tmpdir(), "contas-pg-concurrency-"))),
    );
    const servers = ports.map((port, index) =>
      startServer(port, storageDirs[index]),
    );
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });

    try {
      await Promise.all(
        servers.map((server, index) => waitForServer(bases[index], server)),
      );

      const registered = await jsonRequest(bases[0], "/api/auth/register", {
        method: "POST",
        body: {
          username,
          password,
          email: `${username}@example.test`,
          fullName: username,
        },
      });
      assert.equal(registered.response.status, 201);

      const sessions = await Promise.all(
        bases.map(async (baseUrl) => {
          const result = await jsonRequest(baseUrl, "/api/auth/login", {
            method: "POST",
            body: { name: username, password },
          });
          assert.equal(result.response.status, 200);
          return cookieFrom(result.response);
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const knownIps = await pool.query(
        `SELECT ip_hash FROM login_known_ips
         JOIN users ON users.id = login_known_ips.user_id
         WHERE users.username = $1`,
        [username],
      );
      assert.equal(knownIps.rowCount, 1);

      const groups = await jsonRequest(bases[0], "/api/groups", {
        cookie: sessions[0],
      });
      assert.equal(groups.response.status, 200);
      const groupId = groups.data.groups[0].id;

      const writes = await Promise.all(
        Array.from({ length: 12 }, (_, index) => {
          const instance = index % 2;
          return jsonRequest(
            bases[instance],
            `/api/groups/${groupId}/accounts`,
            {
              method: "POST",
              cookie: sessions[instance],
              body: {
                platform: "Teste",
                role: "Concorrente",
                owner: username,
                label: `conta-${index}`,
                username: `login-${index}`,
                password: `Senha@${index}123`,
              },
            },
          );
        }),
      );
      assert.deepEqual(
        writes.map(({ response }) => response.status),
        Array(12).fill(201),
      );

      const listed = await jsonRequest(
        bases[1],
        `/api/groups/${groupId}/accounts`,
        { cookie: sessions[1] },
      );
      assert.equal(listed.response.status, 200);
      assert.deepEqual(
        new Set(listed.data.map((account) => account.label)),
        new Set(Array.from({ length: 12 }, (_, index) => `conta-${index}`)),
      );
    } finally {
      await Promise.all(servers.map(stopServer));
      await pool
        .query("DELETE FROM users WHERE username = $1", [username])
        .catch(() => undefined);
      await pool.end();
      await Promise.all(
        storageDirs.map((directory) =>
          rm(directory, { recursive: true, force: true }),
        ),
      );
    }
  },
);
