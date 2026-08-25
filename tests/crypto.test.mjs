// Fail-closed behavior for encryption at rest: production must refuse to boot
// without CONTAS_FLOW_ENC_KEY, while development stays explicit (encryption
// disabled, not silently pretending to encrypt). Each case spawns a fresh node
// process because server/crypto.mjs decides at import time (module-level
// loadKey()), so the only reliable way to test both branches is a real process
// per env combination.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const VALID_KEY = randomBytes(32).toString("hex");

function runImport(env) {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "import('./server/crypto.mjs').then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); })",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => resolvePromise({ code, stderr }));
  });
}

describe("crypto.mjs — fail-closed sem CONTAS_FLOW_ENC_KEY", () => {
  it("producao sem chave: recusa iniciar", async () => {
    const { code, stderr } = await runImport({
      NODE_ENV: "production",
      CONTAS_FLOW_ENC_KEY: "",
    });
    assert.equal(code, 1);
    assert.match(stderr, /CONTAS_FLOW_ENC_KEY/);
  });

  it("producao com chave valida: inicia normalmente", async () => {
    const { code } = await runImport({
      NODE_ENV: "production",
      CONTAS_FLOW_ENC_KEY: VALID_KEY,
    });
    assert.equal(code, 0);
  });

  it("desenvolvimento sem chave: carrega com criptografia desabilitada (explicito, sem persistir 'como se' cifrado)", async () => {
    const { code } = await runImport({
      NODE_ENV: "development",
      CONTAS_FLOW_ENC_KEY: "",
    });
    assert.equal(code, 0);
  });
});
