import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  createResetToken,
  resetPasswordWithToken,
  validateResetToken,
} from "../server/password-reset.mjs";
import {
  createUser,
  findByUsernameOrEmail,
  verifyPassword,
} from "../server/users-pg.mjs";
import { hashIp } from "../server/ip-hash.mjs";

test("reset de senha no fallback consome o token uma única vez", async () => {
  const storageDir = await mkdtemp(join(tmpdir(), "contas-reset-"));
  try {
    const user = await createUser(storageDir, {
      username: "reset-user",
      password: "Senha@123",
      email: "reset-user@example.test",
      role: "member",
    });
    const token = await createResetToken(storageDir, user.id);

    assert.equal(
      await resetPasswordWithToken(storageDir, token, "SenhaNova@456"),
      user.id,
    );
    assert.equal(await validateResetToken(storageDir, token), null);
    assert.equal(
      await resetPasswordWithToken(storageDir, token, "OutraSenha@789"),
      null,
    );

    const stored = await findByUsernameOrEmail(storageDir, "reset-user");
    assert.ok(stored?.passwordHash);
    assert.equal(
      await verifyPassword("SenhaNova@456", stored.passwordHash),
      true,
    );
    assert.equal(await verifyPassword("Senha@123", stored.passwordHash), false);
  } finally {
    await rm(storageDir, { recursive: true, force: true });
  }
});

test("hash de IP é determinístico e trata ausência com valor estável", () => {
  assert.equal(hashIp("127.0.0.1"), hashIp("127.0.0.1"));
  assert.equal(hashIp(), hashIp("unknown"));
  assert.match(hashIp("127.0.0.1"), /^[a-f0-9]{64}$/);
});
