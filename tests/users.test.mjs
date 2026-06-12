// Testes das regras de credencial (server/users.mjs): política de senha,
// validação de username e o roundtrip scrypt (incluindo fail-closed em hash
// corrompido — um users.json editado à mão não pode aceitar qualquer senha).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
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
