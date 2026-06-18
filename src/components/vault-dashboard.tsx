import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  ShieldOff,
  KeyRound,
  AlertTriangle,
  Archive,
  Activity,
  Users,
  Layers,
  TrendingUp,
} from "lucide-react";
import { cn } from "../lib/utils";
import type { AccountRecord } from "../data/credential-records";
import {
  FacebookIcon,
  InstagramIcon,
  KwaiIcon,
  TikTokIcon,
  YouTubeIcon,
} from "./platform-icons";

interface Props {
  accounts: AccountRecord[];
  groups: GroupSummary[];
  onNavigate: (groupId: string) => void;
}

function PlatformIcon({ platform, className }: { platform: string; className?: string }) {
  const cls = cn("h-5 w-5", className);
  switch (platform.toLowerCase()) {
    case "instagram": return <InstagramIcon className={cls} />;
    case "facebook":  return <FacebookIcon  className={cls} />;
    case "youtube":   return <YouTubeIcon   className={cls} />;
    case "tiktok":    return <TikTokIcon    className={cls} />;
    case "kwai":      return <KwaiIcon      className={cls} />;
    default:          return <Layers        className={cls} />;
  }
}

interface StatCardProps {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ReactNode;
  accent?: boolean;
  warn?: boolean;
}

function StatCard({ label, value, sub, icon, accent, warn }: StatCardProps) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{
        background: "var(--panel)",
        border: `1px solid ${accent ? "var(--accent-border)" : warn ? "rgba(234,179,8,0.3)" : "var(--border)"}`,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide opacity-50" style={{ color: "var(--text)" }}>
          {label}
        </span>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-xl"
          style={{
            background: accent ? "var(--accent-surface)" : warn ? "rgba(234,179,8,0.1)" : "var(--surface)",
            color: accent ? "var(--accent)" : warn ? "rgb(234,179,8)" : "var(--muted)",
          }}
        >
          {icon}
        </span>
      </div>
      <div>
        <p className="text-3xl font-bold tabular-nums" style={{ color: "var(--text)" }}>
          {value}
        </p>
        {sub && (
          <p className="mt-0.5 text-xs opacity-50" style={{ color: "var(--text)" }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

export interface GroupSummary {
  id: string;
  name: string;
  count: number;
  ownerId: string;
}

export function VaultDashboard({ accounts, groups, onNavigate }: Props) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    const total = accounts.length;
    const with2fa = accounts.filter((a) => a.twoFactor).length;
    const noPassword = accounts.filter((a) => !a.hasPassword && !a.password).length;
    const inactive = accounts.filter((a) => a.status === "inactive").length;
    const review = accounts.filter((a) => a.status === "review").length;
    const active = accounts.filter((a) => a.status === "active").length;
    const archived = accounts.filter((a) => a.status === "archived").length;

    const byPlatform = accounts.reduce<Record<string, number>>((acc, a) => {
      const p = a.platform || "Outros";
      acc[p] = (acc[p] ?? 0) + 1;
      return acc;
    }, {});
    const topPlatforms = Object.entries(byPlatform)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return { total, with2fa, noPassword, inactive, review, active, archived, topPlatforms };
  }, [accounts, groups]);

  const groupStats = useMemo(
    () => [...groups].sort((a, b) => b.count - a.count),
    [groups],
  );

  const pct2fa = stats.total > 0 ? Math.round((stats.with2fa / stats.total) * 100) : 0;

  return (
    <div className="animate-rise space-y-6 px-4 pb-8 pt-4 sm:px-5 sm:pt-5">
      {/* header */}
      <div>
        <h2 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
          {t("vault.dashboard_title")}
        </h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--muted)" }}>
          {t("vault.dashboard_subtitle", { count: stats.total })}
        </p>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("vault.dashboard_total")}
          value={stats.total}
          sub={t("vault.dashboard_groups", { count: groups.length })}
          icon={<Users className="h-4 w-4" />}
          accent
        />
        <StatCard
          label={t("vault.dashboard_2fa")}
          value={`${pct2fa}%`}
          sub={t("vault.dashboard_2fa_sub", { done: stats.with2fa, total: stats.total })}
          icon={<ShieldCheck className="h-4 w-4" />}
          accent={pct2fa >= 80}
        />
        <StatCard
          label={t("vault.dashboard_no_password")}
          value={stats.noPassword}
          sub={t("vault.dashboard_no_password_sub")}
          icon={<KeyRound className="h-4 w-4" />}
          warn={stats.noPassword > 0}
        />
        <StatCard
          label={t("vault.dashboard_review")}
          value={stats.review}
          sub={t("vault.dashboard_review_sub")}
          icon={<AlertTriangle className="h-4 w-4" />}
          warn={stats.review > 0}
        />
      </div>

      {/* status breakdown + platform breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* status */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
        >
          <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text)" }}>
            {t("vault.dashboard_by_status")}
          </p>
          <div className="space-y-3">
            {[
              { label: t("vault.tab_active"),   value: stats.active,   icon: <Activity className="h-3.5 w-3.5" />, color: "var(--accent)" },
              { label: t("vault.tab_archived"),  value: stats.archived, icon: <Archive  className="h-3.5 w-3.5" />, color: "var(--muted)" },
              { label: t("vault.tab_review"),    value: stats.review,   icon: <AlertTriangle className="h-3.5 w-3.5" />, color: "rgb(234,179,8)" },
              { label: t("vault.tab_disabled"),  value: stats.inactive, icon: <ShieldOff className="h-3.5 w-3.5" />, color: "var(--muted)" },
            ].map(({ label, value, icon, color }) => (
              <div key={label} className="flex items-center gap-3">
                <span style={{ color }} className="shrink-0">{icon}</span>
                <div className="flex flex-1 items-center gap-2">
                  <span className="w-24 shrink-0 text-xs" style={{ color: "var(--muted)" }}>{label}</span>
                  <div className="flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface)", height: 6 }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: stats.total > 0 ? `${(value / stats.total) * 100}%` : "0%",
                        background: color,
                        opacity: 0.8,
                      }}
                    />
                  </div>
                  <span className="w-7 text-right text-xs tabular-nums font-medium" style={{ color: "var(--text)" }}>
                    {value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* platforms */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
        >
          <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text)" }}>
            {t("vault.dashboard_by_platform")}
          </p>
          {stats.topPlatforms.length === 0 ? (
            <p className="text-sm opacity-40" style={{ color: "var(--text)" }}>
              {t("vault.dashboard_empty")}
            </p>
          ) : (
            <div className="space-y-3">
              {stats.topPlatforms.map(([platform, count]) => (
                <div key={platform} className="flex items-center gap-3">
                  <span style={{ color: "var(--muted)" }} className="shrink-0">
                    <PlatformIcon platform={platform} className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex flex-1 items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-xs" style={{ color: "var(--muted)" }}>{platform}</span>
                    <div className="flex-1 overflow-hidden rounded-full" style={{ background: "var(--surface)", height: 6 }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: stats.total > 0 ? `${(count / stats.total) * 100}%` : "0%",
                          background: "var(--accent)",
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <span className="w-7 text-right text-xs tabular-nums font-medium" style={{ color: "var(--text)" }}>
                      {count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* groups list */}
      {groupStats.length > 0 && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
        >
          <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text)" }}>
            {t("vault.dashboard_groups_title")}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {groupStats.map((g) => (
              <button
                key={g.id}
                onClick={() => onNavigate(g.id)}
                className="flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-[color:var(--surface)]"
                style={{ borderColor: "var(--border)" }}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold uppercase"
                  style={{ background: "var(--accent-surface)", color: "var(--accent)" }}
                >
                  {g.name.slice(0, 2)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--text)" }}>
                    {g.name}
                  </p>
                  <p className="text-xs opacity-50" style={{ color: "var(--text)" }}>
                    {t("vault.dashboard_group_count", { count: g.count })}
                  </p>
                </div>
                <TrendingUp className="ml-auto h-3.5 w-3.5 shrink-0 opacity-20" style={{ color: "var(--text)" }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
