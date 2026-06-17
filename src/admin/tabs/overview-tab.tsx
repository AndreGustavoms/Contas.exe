import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Clock3,
  Database,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Monitor,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  UserCog,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  adminRequest,
  type AdminUser,
  type DataPayload,
  type ManagedSession,
  type Overview,
} from "../api";

type OverviewTabKey =
  | "overview"
  | "users"
  | "sessions"
  | "security"
  | "audit"
  | "data";

type OverviewDashboard = {
  overview: Overview;
  users: AdminUser[];
  sessions: ManagedSession[];
  data: DataPayload;
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(value: string | number): string {
  return new Date(value).toLocaleString();
}

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="admin-card p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
          {label}
        </p>
        <Icon className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
      </div>
      <p className="text-xl font-semibold tabular-nums text-[color:var(--text)] sm:text-2xl">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-[color:var(--muted)]">
        {detail}
      </p>
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[6px] border px-2 py-1 text-xs font-semibold ${
        ok
          ? "border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] text-[color:var(--accent)]"
          : "border-[color:var(--border)] bg-[color:var(--surface-soft)] text-[color:var(--muted)]"
      }`}
    >
      {ok ? (
        <ShieldCheck className="h-3.5 w-3.5" />
      ) : (
        <ShieldOff className="h-3.5 w-3.5" />
      )}
      {label}
    </span>
  );
}

export function OverviewTab({
  onOpenTab,
}: {
  onOpenTab: (tab: OverviewTabKey) => void;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<OverviewDashboard | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const [overview, users, sessions, stored] = await Promise.all([
        adminRequest<Overview>("/api/admin-panel/overview"),
        adminRequest<{ users: AdminUser[] }>("/api/users"),
        adminRequest<{ sessions: ManagedSession[] }>("/api/sessions"),
        adminRequest<DataPayload>("/api/admin-panel/data"),
      ]);
      setData({
        overview,
        users: users.users,
        sessions: sessions.sessions,
        data: stored,
      });
    } catch {
      setError(t("admin.overview.load_error"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const userById = useMemo(
    () => new Map(data?.users.map((u) => [u.id, u]) ?? []),
    [data?.users],
  );

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data)
    return (
      <p className="text-sm text-[color:var(--muted)]">{t("admin.loading")}</p>
    );

  const { overview } = data;
  const twoFactorPct = pct(overview.users.withTwoFactor, overview.users.total);
  const recentUsers = [...data.users]
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 5);
  const recentSessions = [...data.sessions]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .slice(0, 5);
  const vaultRows = data.data.vaults
    .map((vault) => ({
      ...vault,
      accounts: vault.groups.reduce((n, g) => n + g.accounts.length, 0),
    }))
    .sort((a, b) => b.accounts - a.accounts)
    .slice(0, 6);

  const quickActions: {
    tab: OverviewTabKey;
    icon: typeof Users;
    title: string;
    desc: string;
  }[] = [
    {
      tab: "users",
      icon: UserCog,
      title: t("admin.overview.actions.manage_users"),
      desc: t("admin.overview.actions.manage_users_desc"),
    },
    {
      tab: "sessions",
      icon: Monitor,
      title: t("admin.overview.actions.check_sessions"),
      desc: t("admin.overview.actions.check_sessions_desc"),
    },
    {
      tab: "data",
      icon: Database,
      title: t("admin.overview.actions.inspect_data"),
      desc: t("admin.overview.actions.inspect_data_desc"),
    },
    {
      tab: "audit",
      icon: ScrollText,
      title: t("admin.overview.actions.audit"),
      desc: t("admin.overview.actions.audit_desc"),
    },
  ];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[color:var(--text)]">
            {t("admin.overview.title")}
          </h1>
          <p className="text-sm text-[color:var(--muted)] sm:block">
            {t("admin.overview.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="admin-chip-btn justify-center"
        >
          <Activity className="h-3.5 w-3.5" />
          {t("admin.refresh")}
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <Stat
          icon={Users}
          label={t("admin.overview.stats.users")}
          value={overview.users.total}
          detail={t("admin.overview.user_mix", {
            admins: overview.users.admins,
            members: overview.users.members,
          })}
        />
        <Stat
          icon={Database}
          label={t("admin.overview.stats.accounts")}
          value={overview.vaults.accounts}
          detail={t("admin.overview.vault_mix", {
            groups: overview.vaults.groups,
          })}
        />
        <Stat
          icon={Monitor}
          label={t("admin.overview.stats.active_sessions")}
          value={overview.sessions.active}
          detail={t("admin.overview.sessions_detail")}
        />
        <Stat
          icon={ScrollText}
          label={t("admin.overview.stats.events_24h")}
          value={overview.audit.recent24h}
          detail={t("admin.overview.audit_total", {
            total: overview.audit.total,
          })}
        />
      </div>

      <div className="grid gap-2 sm:gap-3 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="admin-card p-3 sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[color:var(--text)]">
                {t("admin.overview.command_center")}
              </h2>
              <p className="text-xs text-[color:var(--muted)]">
                {t("admin.overview.command_center_desc")}
              </p>
            </div>
            <KeyRound className="h-4 w-4 text-[color:var(--accent)]" />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {quickActions.map(({ tab, icon: Icon, title, desc }) => (
              <button
                key={tab}
                type="button"
                onClick={() => onOpenTab(tab)}
                className="group flex min-h-[64px] items-start gap-2 rounded-[6px] border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-2.5 text-left transition hover:border-[color:var(--accent-border)] hover:bg-[color:var(--field-hover)] sm:min-h-[84px] sm:gap-3 sm:p-3"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[color:var(--accent-surface)] text-[color:var(--accent)]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-sm font-semibold text-[color:var(--text)]">
                    {title}
                    <ExternalLink className="h-3.5 w-3.5 opacity-0 transition group-hover:opacity-100" />
                  </span>
                  <span className="mt-1 hidden text-xs leading-5 text-[color:var(--muted)] sm:block">
                    {desc}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="admin-card p-3 sm:p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[color:var(--text)]">
                {t("admin.overview.security_integrations")}
              </h2>
              <p className="text-xs text-[color:var(--muted)]">
                {t("admin.overview.two_factor_adoption", {
                  percent: twoFactorPct,
                })}
              </p>
            </div>
            <LockKeyhole className="h-4 w-4 text-[color:var(--accent)]" />
          </div>
          <div className="mb-4 h-2 overflow-hidden rounded-full bg-[color:var(--surface-soft)]">
            <div
              className="h-full rounded-full bg-[color:var(--accent)]"
              style={{ width: `${twoFactorPct}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill
              ok={overview.system.encryptionEnabled}
              label={t("admin.overview.encryption_at_rest")}
            />
            <StatusPill
              ok={overview.system.providers.google}
              label={t("admin.overview.google_login")}
            />
            <StatusPill
              ok={overview.system.providers.github}
              label={t("admin.overview.github_login")}
            />
            <StatusPill
              ok={overview.system.registrationsOpen}
              label={t("admin.overview.public_registration")}
            />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-1.5 text-xs sm:gap-2">
            <div className="rounded-[6px] border border-[color:var(--border)] p-2">
              <p className="text-[color:var(--muted)]">
                {t("admin.overview.uptime")}
              </p>
              <p className="font-semibold text-[color:var(--text)]">
                {formatUptime(overview.system.uptimeSeconds)}
              </p>
            </div>
            <div className="rounded-[6px] border border-[color:var(--border)] p-2">
              <p className="text-[color:var(--muted)]">Node.js</p>
              <p className="font-semibold text-[color:var(--text)]">
                {overview.system.nodeVersion}
              </p>
            </div>
            <div className="rounded-[6px] border border-[color:var(--border)] p-2">
              <p className="text-[color:var(--muted)]">
                {t("admin.audit.server_logs")}
              </p>
              <p className="font-semibold text-[color:var(--text)]">
                {overview.system.serverLogs}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-2 sm:gap-3 xl:grid-cols-3">
        <section className="admin-card overflow-hidden">
          <PanelHeader
            title={t("admin.overview.recent_users")}
            action={t("admin.overview.open_users")}
            onClick={() => onOpenTab("users")}
          />
          <div className="divide-y divide-[color:var(--border)]">
            {recentUsers.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                    {u.username}
                  </p>
                  <p className="truncate text-xs text-[color:var(--muted)]">
                    {u.email || t("admin.users.no_email")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="rounded-[4px] border border-[color:var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[color:var(--muted)]">
                    {u.role}
                  </span>
                  {u.twoFactorEnabled ? (
                    <span className="rounded-[4px] bg-[color:var(--accent-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--accent)]">
                      2FA
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="admin-card overflow-hidden">
          <PanelHeader
            title={t("admin.overview.recent_sessions")}
            action={t("admin.overview.open_sessions")}
            onClick={() => onOpenTab("sessions")}
          />
          <div className="divide-y divide-[color:var(--border)]">
            {recentSessions.length === 0 ? (
              <p className="p-3 text-sm text-[color:var(--muted)]">
                {t("admin.sessions.no_sessions")}
              </p>
            ) : (
              recentSessions.map((s) => (
                <div key={s.sessionId} className="p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                      {userById.get(s.userId)?.username ??
                        t("admin.sessions.unknown_user")}
                    </p>
                    {s.current ? (
                      <span className="rounded-[4px] bg-[color:var(--accent-surface)] px-1.5 py-0.5 text-[10px] text-[color:var(--accent)]">
                        {t("admin.users.this_device")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-[color:var(--muted)]">
                    {s.location ?? t("admin.sessions.location_unknown")}
                    {s.ip ? ` · ${s.ip}` : ""}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-[color:var(--muted)]">
                    <Clock3 className="h-3 w-3" />
                    {formatDate(s.lastSeenAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="admin-card overflow-hidden">
          <PanelHeader
            title={t("admin.overview.vaults")}
            action={t("admin.overview.open_data")}
            onClick={() => onOpenTab("data")}
          />
          <div className="divide-y divide-[color:var(--border)]">
            {vaultRows.map((vault) => (
              <div
                key={vault.userId}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                    {vault.username}
                  </p>
                  <p className="text-xs text-[color:var(--muted)]">
                    {t("admin.data.vault_counts", {
                      groups: vault.groups.length,
                      accounts: vault.accounts,
                    })}
                  </p>
                </div>
                <span className="rounded-[4px] border border-[color:var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[color:var(--muted)]">
                  {vault.role}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function PanelHeader({
  title,
  action,
  onClick,
}: {
  title: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-3 py-2.5">
      <h2 className="text-sm font-semibold text-[color:var(--text)]">
        {title}
      </h2>
      <button type="button" onClick={onClick} className="admin-chip-btn h-8">
        {action}
      </button>
    </div>
  );
}
