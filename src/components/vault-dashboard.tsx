import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  KeyRound,
  AlertTriangle,
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

// Paleta de cores do gráfico (sem vermelho — fora da identidade da marca).
const PLATFORM_PALETTE = [
  "var(--accent)",
  "#60a5fa",
  "#f59e0b",
  "#a78bfa",
  "#34d399",
  "#22d3ee",
  "#94a3b8",
];

type Segment = {
  label: string;
  value: number;
  color: string;
  icon?: React.ReactNode;
};

function DonutChart({
  segments,
  total,
  size = 128,
  thickness = 16,
}: {
  segments: Segment[];
  total: number;
  size?: number;
  thickness?: number;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--surface)"
        strokeWidth={thickness}
      />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => {
            const len = (s.value / total) * c;
            const node = (
              <circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return node;
          })}
      </g>
      <text
        x="50%"
        y="46%"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fill: "var(--text)", fontSize: 24, fontWeight: 700 }}
      >
        {total}
      </text>
      <text
        x="50%"
        y="60%"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fill: "var(--muted)", fontSize: 9, letterSpacing: "0.15em" }}
      >
        TOTAL
      </text>
    </svg>
  );
}

function ChartWithLegend({
  segments,
  emptyLabel,
}: {
  segments: Segment[];
  emptyLabel: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) {
    return (
      <p className="text-sm opacity-40" style={{ color: "var(--text)" }}>
        {emptyLabel}
      </p>
    );
  }
  const pct = (v: number) => Math.round((v / total) * 100);
  return (
    <div className="flex items-center gap-5">
      <DonutChart segments={segments} total={total} />
      <ul className="flex-1 space-y-2">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: s.color }}
            />
            {s.icon && (
              <span className="shrink-0" style={{ color: "var(--muted)" }}>
                {s.icon}
              </span>
            )}
            <span className="flex-1 truncate capitalize" style={{ color: "var(--muted)" }}>
              {s.label}
            </span>
            <span className="tabular-nums font-semibold" style={{ color: "var(--text)" }}>
              {pct(s.value)}%
            </span>
            <span className="w-6 text-right tabular-nums opacity-50" style={{ color: "var(--text)" }}>
              {s.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
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
          <ChartWithLegend
            segments={[
              { label: t("vault.tab_active"), value: stats.active, color: "var(--accent)" },
              { label: t("vault.tab_archived"), value: stats.archived, color: "#60a5fa" },
              { label: t("vault.tab_review"), value: stats.review, color: "#f59e0b" },
              { label: t("vault.tab_disabled"), value: stats.inactive, color: "#94a3b8" },
            ]}
            emptyLabel={t("vault.dashboard_empty")}
          />
        </div>

        {/* platforms */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "var(--panel)", border: "1px solid var(--border)" }}
        >
          <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text)" }}>
            {t("vault.dashboard_by_platform")}
          </p>
          <ChartWithLegend
            segments={stats.topPlatforms.map(([platform, count], i) => ({
              label: platform,
              value: count,
              color: PLATFORM_PALETTE[i % PLATFORM_PALETTE.length],
              icon: <PlatformIcon platform={platform} className="h-3 w-3" />,
            }))}
            emptyLabel={t("vault.dashboard_empty")}
          />
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
