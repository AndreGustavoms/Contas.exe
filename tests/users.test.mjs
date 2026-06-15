// Testes das regras de credencial (server/users.mjs): política de senha,
// validação de username e o roundtrip scrypt (incluindo fail-closed em hash
// corrompido — um users.json editado à mão não pode aceitar qualquer senha).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createUser,
  findByUsernameOrEmail,
  hashPassword,
  keepOnlySuperadmin,
  listUsers,
  resetSuperadminPasswordFromEnv,
  validatePassword,
  validateUsername,
  verifyPassword,
} from "../server/users.mjs";

describe("validatePassword", () => {
  it("aceita senha forte", () => {
    assert.equal(validatePassword("Correta@123"), null);
  });

  it("rejeita cada regra individualmente", () => {
    assert.equal(validatePassword("Ab@1"), "password_too_short");
    assert.equal(validatePassword("minuscula@123"), "password_no_uppercase");
    assert.equal(validatePassword("MAIUSCULA@123"), "password_no_lowercase");
    assert.equal(validatePassword("SemNumero@abc"), "password_no_number");
    assert.equal(validatePassword("SemEspecial123"), "password_no_special");
    assert.equal(
      validatePassword("A@1" + "a".repeat(130)),
      "password_too_long",
    );
  });

  it("rejeita senha igual ao username (case-insensitive)", () => {
    assert.equal(
      validatePassword("Andre@123", "andre@123"),
      "password_same_as_username",
    );
  });
});

describe("validateUsername", () => {
  it("aceita nomes razoáveis", () => {
    assert.equal(validateUsername("andre"), null);
    assert.equal(validateUsername("André Gustavo"), null);
  });

  it("rejeita curto e longo demais", () => {
    assert.equal(validateUsername("a"), "username_too_short");
    assert.equal(validateUsername("x".repeat(81)), "username_too_long");
  });
});

describe("scrypt roundtrip", () => {
  it("hash gerado verifica com a senha certa e falha com a errada", async () => {
    const hash = await hashPassword("Segredo@123");
    assert.equal(await verifyPassword("Segredo@123", hash), true);
    assert.equal(await verifyPassword("Errada@123", hash), false);
  });

  it("fail-closed: hash malformado nunca aceita", async () => {
    assert.equal(await verifyPassword("qualquer", "lixo"), false);
    assert.equal(await verifyPassword("qualquer", "scrypt:32768:8:1::"), false);
    assert.equal(
      await verifyPassword("qualquer", "scrypt:32768:8:1:zz:zz"),
      false,
    );
    assert.equal(await verifyPassword("qualquer", null), false);
  });
});

describe("findByUsernameOrEmail", () => {
  it("encontra a mesma conta por username ou e-mail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contas-users-"));
    try {
      const created = await createUser(dir, {
        username: "andre",
        email: "Andre@Teste.com",
        password: "Segredo@123",
        role: "member",
      });

      assert.equal(
        (await findByUsernameOrEmail(dir, "andre"))?.id,
        created.id,
      );
      assert.equal(
        (await findByUsernameOrEmail(dir, "andre@teste.com"))?.id,
        created.id,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("keepOnlySuperadmin", () => {
  it("remove todos exceto o dono configurado por e-mail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contas-users-"));
    const previousEmail = process.env.CONTAS_FLOW_SUPERADMIN_EMAIL;
    const previousFlag = process.env.CONTAS_FLOW_KEEP_ONLY_SUPERADMIN;
    try {
      await createUser(dir, {
        username: "dede",
        email: "owner@example.test",
        password: "Segredo@123",
        role: "member",
      });
      await createUser(dir, {
        username: "outro",
        email: "outro@example.com",
        password: "Segredo@123",
        role: "admin",
      });

      process.env.CONTAS_FLOW_SUPERADMIN_EMAIL = "owner@example.test";
      process.env.CONTAS_FLOW_KEEP_ONLY_SUPERADMIN = "1";

      const result = await keepOnlySuperadmin(dir);
      assert.equal(result?.removed.length, 1);

      const users = await listUsers(dir);
      assert.equal(users.length, 1);
      assert.equal(users[0].email, "owner@example.test");
      assert.equal(users[0].role, "superadmin");
    } finally {
      if (previousEmail == null) {
        delete process.env.CONTAS_FLOW_SUPERADMIN_EMAIL;
      } else {
        process.env.CONTAS_FLOW_SUPERADMIN_EMAIL = previousEmail;
      }
      if (previousFlag == null) {
        delete process.env.CONTAS_FLOW_KEEP_ONLY_SUPERADMIN;
      } else {
        process.env.CONTAS_FLOW_KEEP_ONLY_SUPERADMIN = previousFlag;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("resetSuperadminPasswordFromEnv", () => {
  it("redefine a senha do dono configurado por e-mail", async () => {
    const dir = await mkdtemp(join(tmpdir(), "contas-users-"));
    const previousEmail = process.env.CONTAS_FLOW_SUPERADMIN_EMAIL;
    const previousPassword = process.env.CONTAS_FLOW_SUPERADMIN_PASSWORD;
    try {
      await createUser(dir, {
        username: "dede",
        email: "owner@example.test",
        password: "Antiga@123",
        role: "superadmin",
      });

      process.env.CONTAS_FLOW_SUPERADMIN_EMAIL = "owner@example.test";
      process.env.CONTAS_FLOW_SUPERADMIN_PASSWORD = "Nova@1234";

      const result = await resetSuperadminPasswordFromEnv(dir);
      assert.equal(result?.error, null);

      const owner = await findByUsernameOrEmail(
        dir,
        "owner@example.test",
      );
      assert.equal(await verifyPassword("Nova@1234", owner.passwordHash), true);
      assert.equal(
        await verifyPassword("Antiga@123", owner.passwordHash),
        false,
      );
    } finally {
      if (previousEmail == null) {
        delete process.env.CONTAS_FLOW_SUPERADMIN_EMAIL;
      } else {
        process.env.CONTAS_FLOW_SUPERADMIN_EMAIL = previousEmail;
      }
      if (previousPassword == null) {
        delete process.env.CONTAS_FLOW_SUPERADMIN_PASSWORD;
      } else {
        process.env.CONTAS_FLOW_SUPERADMIN_PASSWORD = previousPassword;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });
});
