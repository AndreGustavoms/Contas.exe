// Limitador progressivo de tentativas de autenticação. Conta FALHAS (não
// requisições) por chave e aplica bloqueios crescentes: errar pouco custa uma
// pausa curta; insistir custa horas. Duas famílias de chave:
//
//   - "user:<nome>"  — protege UMA conta contra força bruta distribuída.
//     Limiares baixos (5/10/15), porque ninguém erra a própria senha 15 vezes.
//   - "ip:<addr>"    — protege contra varredura de várias contas a partir de um
//     mesmo endereço. Limiares mais altos (20/35/50), porque um NAT/escritório
//     compartilha IP entre usuários legítimos.
//
// O chamador verifica as duas chaves na entrada (qualquer uma bloqueada = 429),
// registra falha nas duas quando a autenticação falha e limpa as duas no
// sucesso. Estado em memória (instância única — mesmo modelo do resto do app);
// um restart zera os contadores, o que é aceitável para o ataque que isto
// mitiga (martelar o endpoint por minutos/horas).

const USER_TIERS = [
  { fails: 15, blockMs: 24 * 60 * 60 * 1000 }, // 15 falhas -> 24h
  { fails: 10, blockMs: 60 * 60 * 1000 }, // 10 falhas -> 1h
  { fails: 5, blockMs: 15 * 60 * 1000 }, // 5 falhas -> 15min
];

const IP_TIERS = [
  { fails: 50, blockMs: 24 * 60 * 60 * 1000 },
  { fails: 35, blockMs: 60 * 60 * 1000 },
  { fails: 20, blockMs: 15 * 60 * 1000 },
];

// Falhas antigas não contam para sempre: se a última falha foi há mais de
// FAIL_WINDOW_MS e não há bloqueio ativo, o contador recomeça do zero.
const FAIL_WINDOW_MS = 30 * 60 * 1000;

// key -> { fails, lastFailAt, blockedUntil }
const entries = new Map();

export function ipKey(ip) {
  return `ip:${String(ip ?? "unknown")}`;
}

export function userKey(name) {
  return `user:${String(name ?? "")
    .trim()
    .toLowerCase()}`;
}

function tiersFor(key) {
  return key.startsWith("ip:") ? IP_TIERS : USER_TIERS;
}

// Bloqueio ativo em alguma das chaves? Não muta nada — o registro de falha é
// decisão do chamador (só depois de a autenticação de fato falhar).
export function checkRateLimit(keys, now = Date.now()) {
  let retryAfterMs = 0;
  for (const key of keys) {
    const entry = entries.get(key);
    if (entry?.blockedUntil && entry.blockedUntil > now) {
      retryAfterMs = Math.max(retryAfterMs, entry.blockedUntil - now);
    }
  }
  return { blocked: retryAfterMs > 0, retryAfterMs };
}

// Registra uma falha de autenticação em cada chave e devolve as chaves que
// acabaram de entrar em bloqueio (para o chamador auditar o lockout).
export function recordFailure(keys, now = Date.now()) {
  const newlyBlocked = [];
  for (const key of keys) {
    let entry = entries.get(key);
    if (
      !entry ||
      (!isBlocked(entry, now) && now - entry.lastFailAt > FAIL_WINDOW_MS)
    ) {
      entry = { fails: 0, lastFailAt: 0, blockedUntil: 0 };
      entries.set(key, entry);
    }
    entry.fails += 1;
    entry.lastFailAt = now;

    const tier = tiersFor(key).find((t) => entry.fails >= t.fails);
    if (tier) {
      const until = now + tier.blockMs;
      if (until > entry.blockedUntil) {
        const wasBlocked =
          isBlocked(entry, now - 1) && entry.blockedUntil !== 0;
        entry.blockedUntil = until;
        if (!wasBlocked) newlyBlocked.push(key);
      }
    }
  }
  return { newlyBlocked };
}

// Autenticação bem-sucedida: o dono provou ser ele; zera o histórico das chaves.
export function clearFailures(keys) {
  for (const key of keys) entries.delete(key);
}

function isBlocked(entry, now) {
  return entry.blockedUntil > now;
}

// Remove entradas mortas (sem bloqueio ativo e sem falha recente) para o Map
// não crescer sem limite. Chamar periodicamente.
export function pruneRateLimits(now = Date.now()) {
  let dropped = 0;
  for (const [key, entry] of entries) {
    if (!isBlocked(entry, now) && now - entry.lastFailAt > FAIL_WINDOW_MS) {
      entries.delete(key);
      dropped += 1;
    }
  }
  return dropped;
}

// Só para testes: estado limpo entre casos.
export function _resetForTests() {
  entries.clear();
}
