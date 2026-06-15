import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown, RefreshCw } from "lucide-react";
import { adminRequest, type AuditEvent, type ServerLog } from "../api";

// Aba "Auditoria & logs": o registro de segurança persistente (/api/audit, com
// filtros/paginação/CSV) e os logs operacionais voláteis do servidor
// (/api/admin-panel/logs).

const PAGE_SIZE = 30;

export function AuditTab() {
  const [view, setView] = useState<"audit" | "logs">("audit");
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[color:var(--text)]">
          Auditoria & logs
        </h1>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setView("audit")}
            className={`admin-tab ${view === "audit" ? "admin-tab-active" : ""}`}
          >
            Auditoria
          </button>
          <button
            type="button"
            onClick={() => setView("logs")}
            className={`admin-tab ${view === "logs" ? "admin-tab-active" : ""}`}
          >
            Logs do servidor
          </button>
        </div>
      </header>
      {view === "audit" ? <AuditPanel /> : <LogsPanel />}
    </div>
  );
}

function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function params(limit: number, offset: number) {
    const p = new URLSearchParams();
    p.set("limit", String(limit));
    p.set("offset", String(offset));
    if (q.trim()) p.set("q", q.trim());
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p;
  }

  async function load() {
    try {
      const data = await adminRequest<{
        events: AuditEvent[];
        total: number;
      }>(`/api/audit?${params(PAGE_SIZE, page * PAGE_SIZE).toString()}`);
      setEvents(data.events);
      setTotal(data.total);
    } catch {
      setEvents([]);
    }
  }

  useEffect(() => {
    const handle = window.setTimeout(load, 250);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, from, to]);

  async function exportCsv() {
    const data = await adminRequest<{ events: AuditEvent[] }>(
      `/api/audit?${params(500, 0).toString()}`,
    );
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = [
      ["timestamp", "usuario", "acao", "alvo"].join(";"),
      ...data.events.map((e) =>
        [e.ts, e.username ?? "", e.action, e.target ?? ""]
          .map((v) => esc(String(v)))
          .join(";"),
      ),
    ].join("\r\n");
    const blob = new Blob([`﻿${lines}`], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input
          className="admin-input"
          placeholder="Buscar usuário, ação, alvo…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <input
          type="date"
          className="admin-input"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(0);
          }}
        />
        <input
          type="date"
          className="admin-input"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(0);
          }}
        />
        <button
          type="button"
          onClick={exportCsv}
          className="admin-chip-btn justify-center"
        >
          <FileDown className="h-3.5 w-3.5" />
          CSV
        </button>
      </div>

      <div className="admin-card divide-y divide-[color:var(--border)]">
        {events.length === 0 ? (
          <p className="px-3 py-4 text-xs text-[color:var(--muted)]">
            Nenhum evento.
          </p>
        ) : (
          events.map((e, i) => (
            <div
              key={`${e.ts}-${i}`}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[color:var(--text)]">
                  <span className="font-mono">{e.action}</span>
                  {e.username ? (
                    <span className="ml-2 text-[color:var(--muted)]">
                      {e.username}
                    </span>
                  ) : null}
                </p>
                {e.target ? (
                  <p className="truncate text-[11px] text-[color:var(--muted)]">
                    {e.target}
                  </p>
                ) : null}
              </div>
              <time className="shrink-0 text-[11px] tabular-nums text-[color:var(--muted)]">
                {new Date(e.ts).toLocaleString()}
              </time>
            </div>
          ))
        )}
      </div>

      {total > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-xs text-[color:var(--muted)]">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="admin-chip-btn disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>
          <span className="tabular-nums">
            {page + 1} / {pages}
          </span>
          <button
            type="button"
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
            className="admin-chip-btn disabled:opacity-30"
          >
            Próxima
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function LogsPanel() {
  const [logs, setLogs] = useState<ServerLog[]>([]);
  const [level, setLevel] = useState("");

  async function load() {
    try {
      const qs = level ? `?level=${level}` : "";
      const data = await adminRequest<{ logs: ServerLog[] }>(
        `/api/admin-panel/logs${qs}`,
      );
      setLogs(data.logs);
    } catch {
      setLogs([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  const color: Record<ServerLog["level"], string> = {
    info: "text-[color:var(--muted)]",
    warn: "text-amber-400",
    error: "text-red-400",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          className="admin-input"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="">Todos os níveis</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <button type="button" onClick={load} className="admin-chip-btn">
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </button>
        <span className="text-[11px] text-[color:var(--muted)]">
          em memória · zera a cada deploy
        </span>
      </div>

      <div className="admin-card max-h-[60vh] overflow-y-auto p-2 font-mono text-xs">
        {logs.length === 0 ? (
          <p className="px-2 py-3 text-[color:var(--muted)]">Sem logs.</p>
        ) : (
          logs.map((l, i) => (
            <div
              key={`${l.ts}-${i}`}
              className="flex gap-2 border-b border-[color:var(--border)] px-2 py-1 last:border-0"
            >
              <span className="shrink-0 text-[color:var(--muted)]">
                {new Date(l.ts).toLocaleTimeString()}
              </span>
              <span className={`shrink-0 uppercase ${color[l.level]}`}>
                {l.level}
              </span>
              <span className="truncate text-[color:var(--text)]">
                {l.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
