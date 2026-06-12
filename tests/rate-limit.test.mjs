// Testes do limitador progressivo (server/rate-limit.mjs). O relógio é
// injetado via parâmetro `now`, então os cenários de 15min/1h/24h rodam
// instantaneamente.

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  _resetForTests,
  checkRateLimit,
  clearFailures,
  ipKey,
  pruneRateLimits,
  recordFailure,
  userKey,
} from "../server/rate-limit.mjs";

const MIN = 60 * 1000;

describe("rate-limit progressivo", () => {
  beforeEach(() => {
    _resetForTests();
  });

  it("conta de usuário: 4 falhas não bloqueiam, a 5ª bloqueia por 15min", () => {
    const key = userKey("andre");
    const t0 = 1_000_000;
    for (let i = 0; i < 4; i++) recordFailure([key], t0 + i);
    assert.equal(checkRateLimit([key], t0 + 10).blocked, false);

    const { newlyBlocked } = recordFailure([key], t0 + 10);
    assert.deepEqual(newlyBlocked, [key]);

    const blocked = checkRateLimit([key], t0 + 11);
    assert.equal(blocked.blocked, true);
    assert.ok(
      blocked.retryAfterMs > 14 * MIN && blocked.retryAfterMs <= 15 * MIN,
    );

    // Passados 15min, desbloqueia.
    assert.equal(checkRateLimit([key], t0 + 10 + 15 * MIN + 1).blocked, false);
  });

  it("escala: 10 falhas = 1h, 15 falhas = 24h", () => {
    const key = userKey("alvo");
    const t0 = 0;
    for (let i = 0; i < 10; i++) recordFailure([key], t0 + i);
    let check = checkRateLimit([key], t0 + 20);
    assert.ok(
      check.retryAfterMs > 59 * MIN,
      `esperava ~1h, veio ${check.retryAfterMs}`,
    );

    for (let i = 10; i < 15; i++) recordFailure([key], t0 + i);
    check = checkRateLimit([key], t0 + 20);
    assert.ok(
      check.retryAfterMs > 23 * 60 * MIN,
      `esperava ~24h, veio ${check.retryAfterMs}`,
    );
  });

  it("login correto zera o histórico (clearFailures)", () => {
    const keys = [userKey("ana"), ipKey("1.2.3.4")];
    for (let i = 0; i < 4; i++) recordFailure(keys, i);
    clearFailures(keys);
    recordFailure(keys, 100); // 1ª falha de novo, não 5ª
    assert.equal(checkRateLimit(keys, 101).blocked, false);
  });

  it("falhas antigas decaem após 30min sem bloqueio ativo", () => {
    const key = userKey("bia");
    for (let i = 0; i < 4; i++) recordFailure([key], i);
    // 31min depois, a próxima falha recomeça do zero (1ª, não 5ª).
    recordFailure([key], 31 * MIN);
    assert.equal(checkRateLimit([key], 31 * MIN + 1).blocked, false);
  });

  it("chave de IP tem limiar mais alto (bloqueia na 20ª)", () => {
    const key = ipKey("10.0.0.1");
    for (let i = 0; i < 19; i++) recordFailure([key], i);
    assert.equal(checkRateLimit([key], 30).blocked, false);
    recordFailure([key], 30);
    assert.equal(checkRateLimit([key], 31).blocked, true);
  });

  it("lockout é reportado uma vez (newlyBlocked), não a cada tentativa", () => {
    const key = userKey("carla");
    for (let i = 0; i < 4; i++) recordFailure([key], i);
    assert.deepEqual(recordFailure([key], 5).newlyBlocked, [key]);
    assert.deepEqual(recordFailure([key], 6).newlyBlocked, []);
  });

  it("prune remove entradas mortas e preserva bloqueios ativos", () => {
    // "morta": 1 falha em t=0 -> aos 31min está idle (>30min) e sem bloqueio.
    recordFailure([userKey("morta")], 0);
    // "viva": bloqueada aos 20min por 15min -> ainda bloqueada aos 31min.
    for (let i = 0; i < 5; i++) recordFailure([userKey("viva")], 20 * MIN + i);

    const dropped = pruneRateLimits(31 * MIN);
    assert.equal(dropped, 1);
    assert.equal(checkRateLimit([userKey("viva")], 31 * MIN).blocked, true);
  });
});
