import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Eye,
  ThumbsUp,
  MessageCircle,
  Clock,
  UserPlus,
  ExternalLink,
  RefreshCw,
  Send,
  MoreVertical,
  Loader2,
  CornerDownRight,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Select, type SelectOption } from "../ui/select";

export type VideoRef = {
  videoId: string;
  channelId: string | null;
  title: string;
  thumbnailUrl: string | null;
};

type SeriesPoint = {
  day: string;
  views: number;
  minutesWatched: number;
  likes: number;
  comments: number;
  subscribersGained: number;
};

type Snapshot = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
  commentsDisabled: boolean;
  durationSeconds: number | null;
};

type AnalyticsResp = {
  snapshot: Snapshot | null;
  series: SeriesPoint[];
  totals: Omit<SeriesPoint, "day"> | null;
  analyticsAvailable: boolean;
  rangeDays: number;
};

type Comment = {
  id: string | null;
  text: string;
  author: string;
  authorAvatar: string | null;
  authorChannelUrl: string | null;
  likeCount: number;
  publishedAt: string | null;
};

type Thread = Comment & {
  threadId: string | null;
  canReply: boolean;
  totalReplyCount: number;
  replies: Comment[];
};

const numberFmt = new Intl.NumberFormat("pt-BR");
const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
});
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function fmt(n: number | null | undefined): string {
  return n == null ? "—" : numberFmt.format(n);
}

const METRICS: SelectOption<keyof Omit<SeriesPoint, "day">>[] = [
  { value: "views", label: "Visualizações" },
  { value: "minutesWatched", label: "Tempo de exibição (min)" },
  { value: "subscribersGained", label: "Inscritos ganhos" },
  { value: "likes", label: "Curtidas" },
  { value: "comments", label: "Comentários" },
];

const RANGES: SelectOption<string>[] = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "28", label: "Últimos 28 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "365", label: "Último ano" },
];

export function VideoAnalyticsModal({
  video,
  onClose,
}: {
  video: VideoRef;
  onClose: () => void;
}) {
  const [data, setData] = useState<AnalyticsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [days, setDays] = useState("28");
  const [metric, setMetric] =
    useState<keyof Omit<SeriesPoint, "day">>("views");

  const channelId = video.channelId ?? "";

  const loadAnalytics = useCallback(() => {
    setLoading(true);
    setError(false);
    return fetch(
      `/api/youtube/video/${encodeURIComponent(video.videoId)}/analytics?channelId=${encodeURIComponent(channelId)}&days=${days}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: AnalyticsResp) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [video.videoId, channelId, days]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  // Fecha no Esc e trava o scroll do fundo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const snap = data?.snapshot;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[rgba(2,6,23,0.78)] p-4 backdrop-blur-lg sm:p-6"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[color:var(--accent-border)] shadow-[0_28px_90px_-32px_rgba(0,0,0,0.95),0_0_0_1px_rgba(34,197,94,0.12),inset_0_1px_0_rgba(255,255,255,0.07)]"
        style={{
          // 100% opaco (sem alpha) para nada do fundo vazar; superfície elevada
          // com um leve brilho verde no topo, dentro da identidade.
          background:
            "radial-gradient(130% 80% at 50% -6%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 52%), color-mix(in srgb, var(--page-bg) 90%, #ffffff)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start gap-4 border-b border-[color:var(--border)] p-5">
          <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg border border-[color:var(--border)] bg-black">
            {(snap?.thumbnailUrl ?? video.thumbnailUrl) ? (
              <img
                alt=""
                src={snap?.thumbnailUrl ?? video.thumbnailUrl ?? ""}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
              Análise do vídeo
            </p>
            <h2 className="mt-1 line-clamp-2 text-lg font-bold leading-snug text-[color:var(--text)]">
              {snap?.title || video.title || "(sem título)"}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-[color:var(--muted)]">
              {snap?.publishedAt && (
                <span>
                  Publicado em {dateTimeFmt.format(new Date(snap.publishedAt))}
                </span>
              )}
              <a
                href={`https://studio.youtube.com/video/${video.videoId}/analytics`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[color:var(--accent-soft)] hover:underline"
              >
                Abrir no Studio <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-2">
          {/* ── Coluna esquerda: métricas + gráfico ── */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-2">
              <Stat icon={Eye} label="Views" value={fmt(snap?.views)} />
              <Stat icon={ThumbsUp} label="Curtidas" value={fmt(snap?.likes)} />
              <Stat
                icon={MessageCircle}
                label="Coment."
                value={snap?.commentsDisabled ? "Off" : fmt(snap?.comments)}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Select
                value={metric}
                options={METRICS}
                onChange={setMetric}
                className="w-48"
              />
              <Select
                value={days}
                options={RANGES}
                onChange={setDays}
                className="w-44"
              />
            </div>

            {loading ? (
              <div className="skeleton h-56 rounded-xl" />
            ) : error ? (
              <ChartNotice text="Não foi possível carregar a análise agora.">
                <button
                  type="button"
                  onClick={loadAnalytics}
                  className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[color:var(--accent-soft)] hover:underline"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
                </button>
              </ChartNotice>
            ) : !data?.analyticsAvailable ? (
              <ChartNotice text="O gráfico ao longo do tempo precisa da permissão de Analytics. Reconecte este canal do YouTube para liberar (uma vez só).">
                <a
                  href="/api/youtube/connect"
                  className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[color:var(--accent-soft)] hover:underline"
                >
                  Reconectar canal <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </ChartNotice>
            ) : (
              <LineChart series={data.series} metric={metric} />
            )}

            {data?.analyticsAvailable && data.totals && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniTotal
                  icon={Eye}
                  label="Views no período"
                  value={fmt(data.totals.views)}
                />
                <MiniTotal
                  icon={Clock}
                  label="Min. assistidos"
                  value={fmt(data.totals.minutesWatched)}
                />
                <MiniTotal
                  icon={UserPlus}
                  label="Novos inscritos"
                  value={fmt(data.totals.subscribersGained)}
                />
                <MiniTotal
                  icon={ThumbsUp}
                  label="Curtidas"
                  value={fmt(data.totals.likes)}
                />
              </div>
            )}
          </div>

          {/* ── Coluna direita: comentários ── */}
          <CommentsPanel
            videoId={video.videoId}
            channelId={channelId}
            commentsDisabled={snap?.commentsDisabled ?? false}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ───────────────────────── Gráfico (SVG, sem libs) ───────────────────────── */

function LineChart({
  series,
  metric,
}: {
  series: SeriesPoint[];
  metric: keyof Omit<SeriesPoint, "day">;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520;
  const H = 220;
  const PAD = { top: 16, right: 12, bottom: 26, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const points = useMemo(
    () => series.map((d) => ({ day: d.day, value: d[metric] })),
    [series, metric],
  );

  if (!points.length) {
    return (
      <ChartNotice text="Ainda não há dados no período selecionado." />
    );
  }

  const max = Math.max(1, ...points.map((p) => p.value));
  const n = points.length;
  const x = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
  const areaPath =
    `${linePath} L ${x(n - 1).toFixed(1)} ${(PAD.top + innerH).toFixed(1)}` +
    ` L ${x(0).toFixed(1)} ${(PAD.top + innerH).toFixed(1)} Z`;

  // 3 marcas no eixo Y
  const yTicks = [0, 0.5, 1].map((f) => ({ v: Math.round(max * f), fy: y(max * f) }));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / innerW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const hp = hover != null ? points[hover] : null;

  return (
    <div className="report-neon-card relative rounded-xl border p-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="vchart-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.fy}
              y2={t.fy}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={t.fy + 3}
              textAnchor="end"
              className="fill-[color:var(--muted-soft)]"
              style={{ fontSize: 9 }}
            >
              {numberFmt.format(t.v)}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#vchart-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* primeira/última data */}
        <text
          x={PAD.left}
          y={H - 8}
          className="fill-[color:var(--muted-soft)]"
          style={{ fontSize: 9 }}
        >
          {dateFmt.format(new Date(points[0].day))}
        </text>
        <text
          x={W - PAD.right}
          y={H - 8}
          textAnchor="end"
          className="fill-[color:var(--muted-soft)]"
          style={{ fontSize: 9 }}
        >
          {dateFmt.format(new Date(points[n - 1].day))}
        </text>

        {hp && (
          <g>
            <line
              x1={x(hover!)}
              x2={x(hover!)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--accent)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={x(hover!)}
              cy={y(hp.value)}
              r="3.5"
              fill="var(--accent)"
              stroke="var(--page-bg)"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {hp && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-[color:var(--accent-border)] bg-[color:var(--page-bg)]/95 px-2.5 py-1.5 text-[11px] shadow-lg">
          <span className="font-mono text-[color:var(--muted)]">
            {dateFmt.format(new Date(hp.day))}
          </span>{" "}
          <span className="font-bold text-[color:var(--text)]">
            {numberFmt.format(hp.value)}
          </span>
        </div>
      )}
    </div>
  );
}

function ChartNotice({
  text,
  children,
}: {
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="report-neon-card flex h-56 flex-col items-center justify-center rounded-xl border px-6 text-center">
      <p className="text-[12px] text-[color:var(--muted)]">{text}</p>
      {children}
    </div>
  );
}

/* ───────────────────────── Comentários ───────────────────────── */

function CommentsPanel({
  videoId,
  channelId,
  commentsDisabled,
}: {
  videoId: string;
  channelId: string;
  commentsDisabled: boolean;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(commentsDisabled);
  const [order, setOrder] = useState("time");
  const [newText, setNewText] = useState("");
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return fetch(
      `/api/youtube/video/${encodeURIComponent(videoId)}/comments?channelId=${encodeURIComponent(channelId)}&order=${order}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { threads?: Thread[]; disabled?: boolean }) => {
        setThreads(d.threads ?? []);
        if (d.disabled) setDisabled(true);
      })
      .catch(() => setThreads([]))
      .finally(() => setLoading(false));
  }, [videoId, channelId, order]);

  useEffect(() => {
    load();
  }, [load]);

  async function postComment() {
    const text = newText.trim();
    if (!text || posting) return;
    setPosting(true);
    try {
      const res = await fetch(
        `/api/youtube/video/${encodeURIComponent(videoId)}/comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId, text }),
        },
      );
      if (res.ok) {
        const { thread } = await res.json();
        setThreads((prev) => [thread, ...prev]);
        setNewText("");
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 lg:border-l lg:border-[color:var(--border)] lg:pl-6">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
          <MessageCircle className="h-3.5 w-3.5" /> Comentários
        </p>
        {!disabled && (
          <Select
            value={order}
            options={[
              { value: "time", label: "Mais recentes" },
              { value: "relevance", label: "Mais relevantes" },
            ]}
            onChange={setOrder}
            className="w-40"
          />
        )}
      </div>

      {disabled ? (
        <ChartNotice text="Os comentários estão desativados neste vídeo." />
      ) : (
        <>
          {/* novo comentário */}
          <div className="flex items-start gap-2">
            <textarea
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Escreva um comentário como o canal…"
              rows={2}
              className="min-h-[44px] flex-1 resize-y rounded-lg border border-[color:var(--border)] bg-[color:var(--field)] px-3 py-2 text-[13px] text-[color:var(--text)] outline-none focus:border-[color:var(--accent)]"
            />
            <button
              type="button"
              onClick={postComment}
              disabled={!newText.trim() || posting}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-foreground)] transition disabled:opacity-40"
              aria-label="Comentar"
            >
              {posting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>

          {loading ? (
            <div className="skeleton h-40 rounded-xl" />
          ) : threads.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-[color:var(--muted)]">
              Nenhum comentário ainda.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {threads.map((th) => (
                <CommentThread
                  key={th.threadId ?? th.id}
                  thread={th}
                  channelId={channelId}
                  onRemoved={(id) =>
                    setThreads((prev) =>
                      prev.filter((t) => (t.threadId ?? t.id) !== id),
                    )
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const MOD_ACTIONS: { action: string; label: string; danger?: boolean }[] = [
  { action: "heldForReview", label: "Segurar para revisão" },
  { action: "rejected", label: "Rejeitar" },
  { action: "spam", label: "Marcar como spam" },
  { action: "delete", label: "Excluir", danger: true },
];

function CommentThread({
  thread,
  channelId,
  onRemoved,
}: {
  thread: Thread;
  channelId: string;
  onRemoved: (id: string) => void;
}) {
  const [replies, setReplies] = useState<Comment[]>(thread.replies);
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  async function sendReply() {
    const text = replyText.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/youtube/comments/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, parentId: thread.id, text }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setReplies((prev) => [...prev, comment]);
        setReplyText("");
        setReplying(false);
      }
    } finally {
      setBusy(false);
    }
  }

  async function moderate(action: string) {
    setMenuOpen(false);
    if (!thread.id) return;
    if (action === "delete" && !confirm("Excluir este comentário?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/youtube/comments/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, commentId: thread.id, action }),
      });
      if (res.ok && (action === "delete" || action === "rejected" || action === "spam"))
        onRemoved(thread.threadId ?? thread.id!);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-[color:var(--border)] p-3">
      <CommentRow c={thread} />

      <div className="mt-2 flex items-center gap-3 pl-9">
        <button
          type="button"
          onClick={() => setReplying((v) => !v)}
          className="text-[11px] font-semibold text-[color:var(--muted)] transition hover:text-[color:var(--accent-soft)]"
        >
          Responder
        </button>
        {thread.totalReplyCount > 0 && (
          <span className="text-[11px] text-[color:var(--muted-soft)]">
            {thread.totalReplyCount}{" "}
            {thread.totalReplyCount === 1 ? "resposta" : "respostas"}
          </span>
        )}
        <div ref={menuRef} className="relative ml-auto">
          <button
            type="button"
            aria-label="Moderar"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={busy}
            className="flex h-6 w-6 items-center justify-center rounded text-[color:var(--muted-soft)] transition hover:text-[color:var(--text)] disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MoreVertical className="h-4 w-4" />
            )}
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-lg border border-[color:var(--accent-border)] bg-[color:var(--page-bg)] py-1 shadow-xl">
              {MOD_ACTIONS.map((a) => (
                <button
                  key={a.action}
                  type="button"
                  onClick={() => moderate(a.action)}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-[12px] transition hover:bg-[color:var(--surface-soft)]",
                    a.danger
                      ? "text-red-400 hover:text-red-300"
                      : "text-[color:var(--text)]",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {replying && (
        <div className="mt-2 flex items-start gap-2 pl-9">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Sua resposta…"
            rows={2}
            className="min-h-[40px] flex-1 resize-y rounded-lg border border-[color:var(--border)] bg-[color:var(--field)] px-3 py-1.5 text-[12px] text-[color:var(--text)] outline-none focus:border-[color:var(--accent)]"
          />
          <button
            type="button"
            onClick={sendReply}
            disabled={!replyText.trim() || busy}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--accent-foreground)] transition disabled:opacity-40"
            aria-label="Enviar resposta"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {replies.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2.5 border-l border-[color:var(--border)] pl-3">
          {replies.map((r, i) => (
            <li key={r.id ?? i} className="flex gap-1.5">
              <CornerDownRight className="mt-2 h-3.5 w-3.5 shrink-0 text-[color:var(--muted-soft)]" />
              <div className="flex-1">
                <CommentRow c={r} small />
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function CommentRow({ c, small }: { c: Comment; small?: boolean }) {
  return (
    <div className="flex gap-2.5">
      <span
        className={cn(
          "shrink-0 overflow-hidden rounded-full bg-[color:var(--surface-soft)]",
          small ? "h-6 w-6" : "h-7 w-7",
        )}
      >
        {c.authorAvatar ? (
          <img alt="" src={c.authorAvatar} className="h-full w-full object-cover" />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[12px]">
          {c.authorChannelUrl ? (
            <a
              href={c.authorChannelUrl}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-[color:var(--text)] hover:underline"
            >
              {c.author}
            </a>
          ) : (
            <span className="font-semibold text-[color:var(--text)]">
              {c.author}
            </span>
          )}
          {c.publishedAt && (
            <span className="text-[10px] text-[color:var(--muted-soft)]">
              {dateFmt.format(new Date(c.publishedAt))}
            </span>
          )}
        </p>
        <p className="mt-0.5 whitespace-pre-wrap break-words text-[12.5px] leading-snug text-[color:var(--muted)]">
          {c.text}
        </p>
        <p className="mt-1 flex items-center gap-1 text-[10px] text-[color:var(--muted-soft)]">
          <ThumbsUp className="h-3 w-3" /> {numberFmt.format(c.likeCount)}
        </p>
      </div>
    </div>
  );
}

/* ───────────────────────── átomos ───────────────────────── */

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
}) {
  return (
    <div className="report-neon-card rounded-lg border px-3 py-2.5">
      <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--muted-soft)]">
        <Icon className="h-3 w-3 text-[color:var(--accent)]" />
        {label}
      </p>
      <p className="mt-1 text-lg font-bold tabular-nums leading-none text-[color:var(--text)]">
        {value}
      </p>
    </div>
  );
}

function MiniTotal({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-2.5 py-2">
      <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[color:var(--muted-soft)]">
        <Icon className="h-3 w-3 text-[color:var(--accent)]" />
        {label}
      </p>
      <p className="mt-1 text-[15px] font-bold tabular-nums leading-none text-[color:var(--text)]">
        {value}
      </p>
    </div>
  );
}
