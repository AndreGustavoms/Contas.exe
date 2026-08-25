import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FileDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { adminRequest, type AuditEvent } from "../api";

// Aba "Auditoria": o registro de segurança persistente de quem-fez-o-quê
// (/api/audit, com filtros/paginação/CSV). Os logs operacionais do servidor
// ficam na aba "Segurança".

const PAGE_SIZE = 30;

export function AuditTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-[color:var(--text)]">
          {t("admin.audit.title")}
        </h1>
        <p className="text-sm text-[color:var(--muted)]">
          {t("admin.audit.subtitle")}
        </p>
      </header>
      <AuditPanel />
    </div>
  );
}

function AuditPanel() {
  const { t } = useTranslation();
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
      [
        "timestamp",
        t("admin.audit.csv_user"),
        t("admin.audit.csv_action"),
        t("admin.audit.csv_target"),
      ].join(";"),
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
          placeholder={t("admin.audit.search_placeholder")}
          aria-label={t("admin.audit.search_placeholder")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <input
          type="date"
          className="admin-input"
          aria-label={t("admin.audit.date_from")}
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(0);
          }}
        />
        <input
          type="date"
          className="admin-input"
          aria-label={t("admin.audit.date_to")}
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
            {t("admin.audit.no_events")}
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
            {t("admin.previous")}
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
            {t("admin.next")}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
