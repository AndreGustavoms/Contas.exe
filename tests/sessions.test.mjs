// Testes do ciclo de vida de sessões (server/sessions.mjs) num diretório
// temporário — cobre criação, revogação seletiva (exceptSessionId, usada na
// troca de senha) e revogação total.

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession,
  listSessionsForUser,
  resolveAndTouch,
  revokeAllForUser,
  revokeSession,
} from "../server/sessions.mjs";

describe("sessões", () => {
  let dir;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "contas-sessions-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("cria e resolve uma sessão", async () => {
    const token = await createSession(dir, {
      userId: "u1",
      ip: "127.0.0.1",
      userAgent: "teste",
    });
    const session = await resolveAndTouch(dir, token);
    assert.equal(session?.userId, "u1");
  });

  it("revogação individual mata só aquela sessão", async () => {
    const a = await createSession(dir, {
      userId: "u1",
      ip: "1",
      userAgent: "a",
    });
    const b = await createSession(dir, {
      userId: "u1",
      ip: "2",
      userAgent: "b",
    });
    await revokeSession(dir, a);
    assert.equal(await resolveAndTouch(dir, a), null);
    assert.notEqual(await resolveAndTouch(dir, b), null);
  });

  it("revokeAllForUser com exceptSessionId preserva a sessão atual (troca de senha)", async () => {
    const atual = await createSession(dir, {
      userId: "u1",
      ip: "1",
      userAgent: "atual",
    });
    const outra1 = await createSession(dir, {
      userId: "u1",
      ip: "2",
      userAgent: "o1",
    });
    const outra2 = await createSession(dir, {
      userId: "u1",
      ip: "3",
      userAgent: "o2",
    });
    const deOutro = await createSession(dir, {
      userId: "u2",
      ip: "4",
      userAgent: "x",
    });

    const revoked = await revokeAllForUser(dir, "u1", atual);
    assert.equal(revoked, 2);
    assert.notEqual(await resolveAndTouch(dir, atual), null);
    assert.equal(await resolveAndTouch(dir, outra1), null);
    assert.equal(await resolveAndTouch(dir, outra2), null);
    // Sessão de outro usuário não é afetada.
    assert.notEqual(await resolveAndTouch(dir, deOutro), null);
  });

  it("revokeAllForUser sem exceção derruba todas (reset pelo admin)", async () => {
    const a = await createSession(dir, {
      userId: "u1",
      ip: "1",
      userAgent: "a",
    });
    const b = await createSession(dir, {
      userId: "u1",
      ip: "2",
      userAgent: "b",
    });
    const revoked = await revokeAllForUser(dir, "u1");
    assert.equal(revoked, 2);
    assert.equal(await resolveAndTouch(dir, a), null);
    assert.equal(await resolveAndTouch(dir, b), null);
  });

  it("lista sessões ativas do usuário marcando a atual", async () => {
    const atual = await createSession(dir, {
      userId: "u1",
      ip: "1",
      userAgent: "a",
    });
    await createSession(dir, { userId: "u1", ip: "2", userAgent: "b" });
    const list = await listSessionsForUser(dir, "u1", atual);
    assert.equal(list.length, 2);
    assert.equal(list.filter((s) => s.current).length, 1);
  });
});
