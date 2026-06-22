import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Eye,
  ThumbsUp,
  MessageCircle,
  RefreshCw,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Select, type SelectOption } from "../ui/select";
import { VideoAnalyticsModal, type VideoRef } from "./video-analytics-modal";

// Estatísticas REAIS vindas da API do YouTube (videos.list?part=statistics).
type VideoStats = {
  videoId: string;
  channelId: string | null;
  channelTitle: string | null;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  commentsDisabled: boolean;
  live: boolean;
};

// Ordenações disponíveis na lista de vídeos. Default = mais recentes.
type SortKey =
  | "recent"
  | "oldest"
  | "most_views"
  | "least_views"
  | "most_likes"
  | "most_comments";

const SORT_OPTIONS: SelectOption<SortKey>[] = [
  { value: "recent", label: "Mais recentes" },
  { value: "oldest", label: "Mais antigos" },
  { value: "most_views", label: "Mais visualizações" },
  { value: "least_views", label: "Menos visualizações" },
  { value: "most_likes", label: "Mais curtidas" },
  { value: "most_comments", label: "Mais comentários" },
];

const SORT_LABEL: Record<SortKey, string> = {
  recent: "mais recentes",
  oldest: "mais antigos",
  most_views: "visualizações",
  least_views: "menos visualizações",
  most_likes: "curtidas",
  most_comments: "comentários",
};

function publishedTime(v: VideoStats): number {
  const t = v.publishedAt ? Date.parse(v.publishedAt) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

function sortVideos(videos: VideoStats[], key: SortKey): VideoStats[] {
  const copy = [...videos];
  switch (key) {
    case "recent":
      return copy.sort((a, b) => publishedTime(b) - publishedTime(a));
    case "oldest":
      return copy.sort((a, b) => publishedTime(a) - publishedTime(b));
    case "most_views":
      return copy.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
    case "least_views":
      return copy.sort((a, b) => (a.views ?? 0) - (b.views ?? 0));
    case "most_likes":
      return copy.sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0));
    case "most_comments":
      return copy.sort((a, b) => (b.comments ?? 0) - (a.comments ?? 0));
    default:
      return copy;
  }
}

const numberFmt = new Intl.NumberFormat("pt-BR");
const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function fmt(n: number | null): string {
  return n == null ? "—" : numberFmt.format(n);
}

export function AnalyticsPanel() {
  const [videos, setVideos] = useState<VideoStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [selected, setSelected] = useState<VideoRef | null>(null);

  const sortedVideos = useMemo(
    () => sortVideos(videos, sortBy),
    [videos, sortBy],
  );

  function load(silent: boolean) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    return fetch("/api/youtube/analytics")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { videos?: VideoStats[] }) => {
        setVideos(d.videos ?? []);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Totais somando só os vídeos com números vivos da API.
  const liveVideos = videos.filter((v) => v.live);
  const totalViews = liveVideos.reduce((s, v) => s + (v.views ?? 0), 0);
  const totalLikes = liveVideos.reduce((s, v) => s + (v.likes ?? 0), 0);
  const totalComments = liveVideos.reduce((s, v) => s + (v.comments ?? 0), 0);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] text-[color:var(--accent)]">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div className="leading-none">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
              Análises das redes
            </p>
            <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-[color:var(--text)] sm:text-3xl">
              Desempenho dos vídeos
            </h2>
          </div>
        </div>

        <button
          type="button"
          aria-label="Atualizar"
          onClick={() => load(true)}
          className="reports-monthnav-arrow"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </button>
      </div>

      {/* Totais reais */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={Eye}
          label="Visualizações"
          value={loading ? "…" : fmt(totalViews)}
        />
        <StatCard
          icon={ThumbsUp}
          label="Curtidas"
          value={loading ? "…" : fmt(totalLikes)}
        />
        <StatCard
          icon={MessageCircle}
          label="Comentários"
          value={loading ? "…" : fmt(totalComments)}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
          Não foi possível carregar as análises do YouTube agora.
        </div>
      )}

      {/* Lista de vídeos */}
      {loading ? (
        <div className="skeleton h-64 rounded-xl" />
      ) : videos.length === 0 ? (
        <div className="report-neon-card rounded-2xl border px-6 py-12 text-center">
          <p className="text-[13px] text-[color:var(--muted)]">
            Nenhum vídeo encontrado. Conecte um canal do YouTube (ou reconecte,
            se conectou antes da permissão de leitura) para ver as métricas.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
              {videos.length} vídeo{videos.length > 1 ? "s" : ""} · ordenado por{" "}
              {SORT_LABEL[sortBy]}
            </p>
            <div className="flex items-center gap-2">
              <ArrowUpDown className="h-3.5 w-3.5 text-[color:var(--muted-soft)]" />
              <Select
                value={sortBy}
                options={SORT_OPTIONS}
                onChange={setSortBy}
                className="w-52"
              />
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {sortedVideos.map((v) => (
              <VideoCard key={v.videoId} v={v} onOpen={setSelected} />
            ))}
          </div>
        </div>
      )}

      {selected && (
        <VideoAnalyticsModal video={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function VideoCard({
  v,
  onOpen,
}: {
  v: VideoStats;
  onOpen: (video: VideoRef) => void;
}) {
  return (
    <button
      type="button"
      onClick={() =>
        onOpen({
          videoId: v.videoId,
          channelId: v.channelId,
          title: v.title,
          thumbnailUrl: v.thumbnailUrl,
        })
      }
      className="report-neon-card group flex flex-col overflow-hidden rounded-2xl border text-left transition-colors hover:bg-[color:var(--surface-soft)] sm:flex-row"
    >
      {/* thumbnail */}
      <span className="relative aspect-video w-full shrink-0 overflow-hidden border-b border-[color:var(--border)] bg-[color:var(--surface-soft)] sm:w-44 sm:border-b-0 sm:border-r">
        {v.thumbnailUrl ? (
          <img
            alt=""
            src={v.thumbnailUrl}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : null}
      </span>

      {/* corpo */}
      <span className="flex min-w-0 flex-1 flex-col p-3.5">
        <span className="flex items-start gap-2">
          <span className="line-clamp-2 min-w-0 flex-1 text-[13px] font-semibold leading-snug text-[color:var(--text)]">
            {v.title || "(sem título)"}
          </span>
          <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--muted-soft)] opacity-0 transition-opacity group-hover:opacity-100" />
        </span>
        <span className="mt-1 flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
          {v.channelTitle && <span className="truncate">{v.channelTitle}</span>}
          {v.publishedAt && (
            <span className="shrink-0">
              · {dateFmt.format(new Date(v.publishedAt))}
            </span>
          )}
        </span>

        {/* métricas reais */}
        <span className="mt-auto grid grid-cols-3 gap-2 pt-3">
          <MetricBlock icon={Eye} label="Views" value={fmt(v.views)} />
          <MetricBlock icon={ThumbsUp} label="Curtidas" value={fmt(v.likes)} />
          <MetricBlock
            icon={MessageCircle}
            label="Comentários"
            value={v.commentsDisabled ? "Off" : fmt(v.comments)}
          />
        </span>
      </span>
    </button>
  );
}

function MetricBlock({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
}) {
  return (
    <span className="flex flex-col gap-0.5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-2.5 py-2">
      <span className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--muted-soft)]">
        <Icon className="h-3 w-3 text-[color:var(--accent)]" />
        {label}
      </span>
      <span className="text-[15px] font-bold tabular-nums leading-none text-[color:var(--text)]">
        {value}
      </span>
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
}) {
  return (
    <div className="report-neon-card rounded-xl border px-4 py-3.5">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
        <Icon className="h-3.5 w-3.5 text-[color:var(--accent)]" />
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-[color:var(--text)]">
        {value}
      </p>
    </div>
  );
}
