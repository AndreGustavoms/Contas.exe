// Buffer de logs do servidor em memória (apenas o painel superadmin lê).
//
// Diferente da auditoria (storage/audit.json, persistente, foco em "quem fez o
// quê"), isto captura eventos operacionais do processo: startup, erros 500,
// falhas de escrita da auditoria, prunes de sessão. É um ring buffer limitado e
// VOLÁTIL — zera a cada restart/deploy. Não guarda segredos: só nível, mensagem
// curta e timestamp. O objetivo é dar visibilidade operacional sem depender de
// abrir o stdout do host.

const MAX_LOGS = 500;

// Anel de { ts, level, message }. Mais antigo no índice 0.
const buffer = [];

const LEVELS = new Set(["info", "warn", "error"]);

// Registra uma linha. `level` ∈ info|warn|error; `message` é texto curto e SEM
// segredos (o chamador é responsável por não passar senha/token/PII).
export function recordLog(level, message) {
  const lvl = LEVELS.has(level) ? level : "info";
  buffer.push({
    ts: new Date().toISOString(),
    level: lvl,
    message: String(message ?? "").slice(0, 500),
  });
  if (buffer.length > MAX_LOGS) buffer.splice(0, buffer.length - MAX_LOGS);
}

// Os mais recentes primeiro, com filtro opcional por nível e limite.
export function recentLogs({ limit = 200, level } = {}) {
  let list = buffer;
  if (level && LEVELS.has(level)) {
    list = list.filter((entry) => entry.level === level);
  }
  const newestFirst = list.slice().reverse();
  const capped = Math.min(Math.max(Number(limit) || 200, 1), MAX_LOGS);
  return { logs: newestFirst.slice(0, capped), total: list.length };
}
