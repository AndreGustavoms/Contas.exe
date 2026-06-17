import {
  type ComponentType,
  type CSSProperties,
  useEffect,
  useState,
} from "react";
import { CalendarDays, Lock, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import {
  FacebookIcon,
  InstagramIcon,
  KwaiIcon,
  TikTokIcon,
  YouTubeIcon,
} from "./platform-icons";
import { YouTubePoster } from "./posters/youtube-poster";
import { ReportsPanel } from "./posters/reports-panel";

type IconProps = { className?: string; style?: CSSProperties };

type Network = {
  id: string;
  label: string;
  Icon: ComponentType<IconProps>;
  accent: string;
  Panel?: ComponentType;
  comingSoon?: true;
  dividerBefore?: true;
};

const NETWORKS: Network[] = [
  {
    id: "youtube",
    label: "YouTube",
    Icon: YouTubeIcon,
    accent: "#FF0000",
    Panel: YouTubePoster,
  },
  {
    id: "instagram",
    label: "Instagram",
    Icon: InstagramIcon,
    accent: "#E1306C",
    comingSoon: true,
  },
  {
    id: "tiktok",
    label: "TikTok",
    Icon: TikTokIcon,
    accent: "#69C9D0",
    comingSoon: true,
  },
  {
    id: "facebook",
    label: "Facebook",
    Icon: FacebookIcon,
    accent: "#1877F2",
    comingSoon: true,
  },
  {
    id: "kwai",
    label: "Kwai",
    Icon: KwaiIcon,
    accent: "#FF6A00",
    comingSoon: true,
  },
  {
    id: "reports",
    label: "Programação",
    Icon: CalendarDays,
    accent: "var(--accent)",
    Panel: ReportsPanel,
    dividerBefore: true,
  },
];

export function SocialPoster({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(NETWORKS[0].id);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const current = NETWORKS.find((n) => n.id === active) ?? NETWORKS[0];
  const Panel = current.Panel;

  return (
    <section className="vault-card animate-rise relative flex min-h-[calc(100dvh-150px)] overflow-hidden">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent" />

      {/* Menu de redes */}
      <nav className="account-settings-nav flex w-52 shrink-0 flex-col border-r border-[color:var(--border)] p-4 pt-5">
        <div className="mb-5 flex items-center gap-2 px-1">
          <Send className="h-4 w-4 text-[color:var(--accent)]" />
          <span className="text-sm font-semibold text-[color:var(--text)]">
            {t("post.title")}
          </span>
        </div>
        <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]">
          {t("post.networks")}
        </p>
        {NETWORKS.map(({ id, label, Icon, accent, comingSoon, dividerBefore }) => {
          const isActive = active === id && !comingSoon;
          return (
            <div key={id}>
            {dividerBefore && <div className="my-2 border-t border-[color:var(--border)]" />}
            <button
              key={id}
              type="button"
              onClick={() => !comingSoon && setActive(id)}
              aria-disabled={comingSoon}
              className={cn(
                "group relative flex w-full items-center gap-2.5 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                comingSoon
                  ? "cursor-default pr-3 text-[color:var(--muted)] opacity-55 hover:bg-[color:var(--field)] hover:opacity-100 focus-visible:bg-[color:var(--field)]"
                  : isActive
                    ? "bg-[color:var(--field)] text-[color:var(--text)]"
                    : "text-[color:var(--muted)] hover:bg-[color:var(--field)] hover:text-[color:var(--text)]",
              )}
            >
              {isActive && (
                <span
                  className="absolute left-0 top-0 h-full w-0.5 rounded-r"
                  style={{
                    background: accent,
                    boxShadow: `0 0 8px ${accent}99`,
                  }}
                />
              )}
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all duration-200",
                  isActive
                    ? "opacity-100"
                    : "opacity-60 group-hover:opacity-80",
                )}
              >
                <Icon className="h-4 w-4" style={{ color: accent }} />
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
              {comingSoon && (
                <span className="pointer-events-none absolute right-2 flex items-center gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--card)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[color:var(--muted)] opacity-0 shadow-sm transition-all duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Lock className="h-2.5 w-2.5" />
                  em breve
                </span>
              )}
            </button>
            </div>
          );
        })}
      </nav>

      {/* Painel da rede selecionada */}
      <div className="account-settings-content min-w-0 flex-1 overflow-y-auto p-6">
        {Panel && <Panel />}
      </div>

      <button
        aria-label={t("post.close")}
        className="absolute right-4 top-4 rounded-lg p-1.5 text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)]"
        type="button"
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </button>
    </section>
  );
}
