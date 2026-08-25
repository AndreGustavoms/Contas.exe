import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { adminRequest, type Overview, type ServerLog } from "../api";

// Aba "Segurança": postura de segurança do site (cripto em repouso, provedores
// de login, registro público, adoção de 2FA) + logs operacionais do servidor.
// Auditoria de quem-fez-o-quê fica na aba "Auditoria".

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between border-b border-[color:var(--border)] py-2 last:border-0">
      <span className="text-sm text-[color:var(--text)]">{label}</span>
      <span
        className={`flex items-center gap-1.5 text-xs font-medium ${
          ok ? "text-[color:var(--accent)]" : "text-[color:var(--muted)]"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            ok ? "bg-[color:var(--accent)]" : "bg-[color:var(--muted)]"
          }`}
        />
        {ok ? t("admin.status.active") : t("admin.status.inactive")}
      </span>
    </div>
  );
}

export function SecurityTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminRequest<Overview>("/api/admin-panel/overview")
      .then(setData)
      .catch(() => setError(t("admin.security.load_error")));
  }, [t]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[color:var(--text)]">
          {t("admin.security.title")}
        </h1>
        <p className="text-sm text-[color:var(--muted)]">
          {t("admin.security.subtitle")}
        </p>
      </header>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {data ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="admin-card p-4">
            <h2 className="mb-2 text-sm font-semibold text-[color:var(--text)]">
              {t("admin.overview.security_integrations")}
            </h2>
            <StatusRow
              label={t("admin.overview.encryption_at_rest")}
              ok={data.system.encryptionEnabled}
            />
            <StatusRow
              label={t("admin.overview.google_login")}
              ok={data.system.providers.google}
            />
            <StatusRow
              label={t("admin.overview.github_login")}
              ok={data.system.providers.github}
            />
            <StatusRow
              label={t("admin.overview.public_registration")}
              ok={data.system.registrationsOpen}
            />
          </div>

          <div className="admin-card p-4">
            <h2 className="mb-2 text-sm font-semibold text-[color:var(--text)]">
              {t("admin.security.adoption")}
            </h2>
            <div className="flex items-center justify-between border-b border-[color:var(--border)] py-2">
              <span className="text-sm text-[color:var(--text)]">
                {t("admin.security.users_with_2fa")}
              </span>
              <span className="text-xs font-medium tabular-nums text-[color:var(--muted)]">
                {data.users.withTwoFactor} / {data.users.total}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-[color:var(--text)]">
                {t("admin.overview.stats.active_sessions")}
              </span>
              <span className="text-xs font-medium tabular-nums text-[color:var(--muted)]">
                {data.sessions.active}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <ServerLogsPanel />
    </div>
  );
}

// Logs operacionais voláteis do servidor (/api/admin-panel/logs).
function ServerLogsPanel() {
  const { t } = useTranslation();
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
        <h2 className="mr-auto text-sm font-semibold text-[color:var(--text)]">
          {t("admin.audit.server_logs")}
        </h2>
        <select
          className="admin-input"
          aria-label={t("admin.audit.level_filter")}
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="">{t("admin.audit.all_levels")}</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <button type="button" onClick={load} className="admin-chip-btn">
          <RefreshCw className="h-3.5 w-3.5" />
          {t("admin.refresh")}
        </button>
      </div>
      <p className="text-[11px] text-[color:var(--muted)]">
        {t("admin.audit.logs_note")}
      </p>

      <div className="admin-card max-h-[55vh] overflow-y-auto p-2 font-mono text-xs">
        {logs.length === 0 ? (
          <p className="px-2 py-3 text-[color:var(--muted)]">
            {t("admin.audit.no_logs")}
          </p>
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
