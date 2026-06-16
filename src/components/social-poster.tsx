import {
  type ComponentType,
  type CSSProperties,
  useEffect,
  useState,
} from "react";
import { Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { YouTubeIcon } from "./platform-icons";
import { YouTubePoster } from "./posters/youtube-poster";

// "Postar": hub de publicação nas redes sociais. Um menu lateral lista as redes
// disponíveis e cada uma tem seu próprio painel, com o contexto daquela rede.
// Por enquanto só o YouTube; adicionar uma rede é só somar uma entrada em
// NETWORKS e o painel correspondente.

type IconProps = { className?: string; style?: CSSProperties };

type Network = {
  id: string;
  label: string;
  Icon: ComponentType<IconProps>;
  accent: string;
  Panel: ComponentType;
};

const NETWORKS: Network[] = [
  {
    id: "youtube",
    label: "YouTube",
    Icon: YouTubeIcon,
    accent: "#FF0000",
    Panel: YouTubePoster,
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

  // Página (não modal): preenche a área de conteúdo do cofre, ao lado da sidebar.
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
        {NETWORKS.map(({ id, label, Icon, accent }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActive(id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              active === id
                ? "bg-[color:var(--field)] text-[color:var(--text)]"
                : "text-[color:var(--muted)] hover:bg-[color:var(--field)] hover:text-[color:var(--text)]",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" style={{ color: accent }} />
            {label}
          </button>
        ))}
      </nav>

      {/* Painel da rede selecionada */}
      <div className="account-settings-content min-w-0 flex-1 overflow-y-auto p-6">
        <Panel />
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
