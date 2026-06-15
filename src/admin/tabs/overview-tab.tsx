import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { adminRequest, type Overview } from "../api";

// Aba "Visão geral": métricas e status do site. Somente leitura.

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="admin-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[color:var(--text)]">
        {value}
      </p>
    </div>
  );
}

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

export function OverviewTab() {
  const { t } = useTranslation();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminRequest<Overview>("/api/admin-panel/overview")
      .then(setData)
      .catch(() => setError(t("admin.overview.load_error")));
  }, [t]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data)
    return (
      <p className="text-sm text-[color:var(--muted)]">{t("admin.loading")}</p>
    );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[color:var(--text)]">
          {t("admin.overview.title")}
        </h1>
        <p className="text-sm text-[color:var(--muted)]">
          {t("admin.overview.subtitle")}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat
          label={t("admin.overview.stats.users")}
          value={data.users.total}
        />
        <Stat
          label={t("admin.overview.stats.admins")}
          value={data.users.admins}
        />
        <Stat
          label={t("admin.overview.stats.members")}
          value={data.users.members}
        />
        <Stat
          label={t("admin.overview.stats.with_2fa")}
          value={data.users.withTwoFactor}
        />
        <Stat
          label={t("admin.overview.stats.groups")}
          value={data.vaults.groups}
        />
        <Stat
          label={t("admin.overview.stats.accounts")}
          value={data.vaults.accounts}
        />
        <Stat
          label={t("admin.overview.stats.active_sessions")}
          value={data.sessions.active}
        />
        <Stat
          label={t("admin.overview.stats.events_24h")}
          value={data.audit.recent24h}
        />
      </div>

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
            {t("admin.overview.system")}
          </h2>
          <div className="flex items-center justify-between border-b border-[color:var(--border)] py-2">
            <span className="text-sm text-[color:var(--text)]">
              {t("admin.overview.uptime")}
            </span>
            <span className="text-xs font-medium tabular-nums text-[color:var(--muted)]">
              {formatUptime(data.system.uptimeSeconds)}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-[color:var(--border)] py-2">
            <span className="text-sm text-[color:var(--text)]">Node.js</span>
            <span className="text-xs font-medium tabular-nums text-[color:var(--muted)]">
              {data.system.nodeVersion}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-[color:var(--text)]">
              {t("admin.overview.audit_events")}
            </span>
            <span className="text-xs font-medium tabular-nums text-[color:var(--muted)]">
              {data.audit.total}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
