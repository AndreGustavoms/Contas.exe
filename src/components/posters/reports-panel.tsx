import { type ReactNode, useEffect, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  ExternalLink,
  Globe,
  Lock,
  PlayCircle,
  Send,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";

const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type HistoryItem = {
  videoId: string | null;
  channelTitle?: string;
  title: string;
  description?: string;
  durationSeconds?: number | null;
  uploadedAt: string;
  publishAt?: string | null;
  privacyStatus?: string;
  thumbnailUrl?: string | null;
};

// ---------------------------------------------------------------------------
// Todo o cálculo de dia/mês/hora é fixado em America/Sao_Paulo via chaves de
// dia "YYYY-MM-DD": determinístico, imune ao fuso de quem abre e ao servidor em
// UTC. A grade mensal começa na segunda-feira e fecha semanas completas.
// ---------------------------------------------------------------------------
const SP_TZ = "America/Sao_Paulo";

const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: SP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: SP_TZ,
  hour: "2-digit",
  minute: "2-digit",
});
const monthFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: SP_TZ,
  month: "long",
  year: "numeric",
});
const weekdayDayFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: SP_TZ,
  weekday: "short",
  day: "2-digit",
  month: "short",
});
function monthLabel(date: Date): string {
  const s = monthFmt.format(date);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function weekdayDay(date: Date): string {
  return weekdayDayFmt.format(date).replace(".", "");
}

function spDayKey(date: Date): string {
  return dayKeyFmt.format(date);
}
function spTime(date: Date): string {
  return timeFmt.format(date);
}
function keyToNoon(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}
function noonToKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function weekdayOfKey(key: string): number {
  return keyToNoon(key).getUTCDay();
}
function addDaysKey(key: string, n: number): string {
  const d = keyToNoon(key);
  d.setUTCDate(d.getUTCDate() + n);
  return noonToKey(d);
}
function mondayOfKey(key: string): string {
  const wd = weekdayOfKey(key);
  const back = wd === 0 ? 6 : wd - 1;
  return addDaysKey(key, -back);
}
function shiftMonthKey(key: string, delta: number): string {
  const d = keyToNoon(key);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return noonToKey(d);
}
function monthTargetKey(key: string, todayKey: string): string {
  return key.slice(0, 7) === todayKey.slice(0, 7) ? todayKey : key;
}
function dayNumber(key: string): number {
  return parseInt(key.slice(8, 10), 10);
}
function getItemDate(item: HistoryItem): Date {
  return new Date(item.publishAt ?? item.uploadedAt);
}
function isScheduled(item: HistoryItem): boolean {
  return Boolean(item.publishAt && new Date(item.publishAt) > new Date());
}
function studioUrl(videoId: string): string {
  return `https://studio.youtube.com/video/${videoId}/edit`;
}
function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
function formatDuration(seconds?: number | null): string {
  if (!Number.isFinite(seconds) || !seconds || seconds < 0) return "Nao informado";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
function thumbnailCandidates(item: HistoryItem): string[] {
  const urls = item.thumbnailUrl ? [item.thumbnailUrl] : [];
  if (item.videoId) {
    urls.push(
      `https://i.ytimg.com/vi/${item.videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
    );
  }
  return Array.from(new Set(urls));
}
// Duração legível, ou "—" quando o YouTube não informou (mais limpo que texto).
function durationLabel(seconds?: number | null): string {
  const d = formatDuration(seconds);
  return d === "Nao informado" ? "—" : d;
}
function privacyMeta(privacy?: string): { label: string; Icon: typeof Lock } {
  switch ((privacy ?? "").toLowerCase()) {
    case "public":
      return { label: "Público", Icon: Globe };
    case "unlisted":
      return { label: "Não listado", Icon: EyeOff };
    case "private":
      return { label: "Privado", Icon: Lock };
    default:
      return { label: privacy || "—", Icon: Lock };
  }
}

// ── Componentes do modal de detalhes ──

function StatusBadge({ scheduled }: { scheduled: boolean }) {
  if (scheduled) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--muted)]">
        <CalendarClock className="h-3 w-3" />
        Agendado
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--accent-soft)]">
      <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
      Postado
    </span>
  );
}

function VisibilityBadge({ privacy }: { privacy?: string }) {
  const { label, Icon } = privacyMeta(privacy);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--muted)]">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="shrink-0 text-[12px] text-[color:var(--muted)]">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-[13px] font-medium text-[color:var(--text)]">
        {children}
      </span>
    </div>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: typeof Send;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="report-neon-card flex items-center gap-4 rounded-2xl border px-5 py-4">
      <span
        className={cn(
          "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border",
          accent
            ? "border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] text-[color:var(--accent)]"
            : "border-[color:var(--border)] bg-[color:var(--surface-soft)] text-[color:var(--muted)]",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <div className="leading-none">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted)]">
          {label}
        </p>
        <p
          className={cn(
            "mt-2 text-3xl font-bold tabular-nums leading-none",
            accent ? "text-[color:var(--accent)]" : "text-[color:var(--text)]",
          )}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      title="Copiar ID"
      className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--surface-soft)] px-2 py-1 font-mono text-[11px] text-[color:var(--text)] transition hover:bg-[color:var(--accent-surface)]"
    >
      {id}
      {copied ? (
        <Check className="h-3 w-3 text-[color:var(--accent)]" />
      ) : (
        <Copy className="h-3 w-3 text-[color:var(--muted-soft)]" />
      )}
    </button>
  );
}

export function ReportsPanel() {
  const todayKey = spDayKey(new Date());
  const [anchorKey, setAnchorKey] = useState(todayKey);
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<HistoryItem | null>(null);
  const [previewMode, setPreviewMode] = useState<"thumbnail" | "player">("thumbnail");
  const [thumbIndex, setThumbIndex] = useState(0);

  function fetchHistory(silent: boolean) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    return fetch("/api/youtube/history?reconcile=1")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: HistoryItem[] }) => {
        setHistory(d.items ?? []);
        setLoadError(false);
      })
      .catch(() => setLoadError(true))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }

  useEffect(() => {
    let alive = true;
    function load(silent = false) {
      if (!alive) return;
      fetchHistory(silent);
    }
    load();
    const interval = window.setInterval(() => load(true), 30000);
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setPreviewMode("thumbnail");
    setThumbIndex(0);
  }, [selectedEvent]);

  // Mês exibido (anchorKey é qualquer dia dele) montado como grade seg→dom
  // com 6 linhas (42 células), incluindo dias "fora do mês" pra completar.
  const monthYm = anchorKey.slice(0, 7);
  const monthFirstKey = `${monthYm}-01`;
  const gridStartKey = mondayOfKey(monthFirstKey);
  const gridDays = Array.from({ length: 42 }, (_, i) =>
    addDaysKey(gridStartKey, i),
  );

  const monthItems = history
    .filter((item) => spDayKey(getItemDate(item)).slice(0, 7) === monthYm)
    .sort((a, b) => getItemDate(a).getTime() - getItemDate(b).getTime());
  const scheduledCount = monthItems.filter(isScheduled).length;
  const postedCount = monthItems.length - scheduledCount;

  const monthTitle = monthLabel(keyToNoon(monthFirstKey));
  const isCurrentMonth = monthYm === todayKey.slice(0, 7);

  // Posts do dia selecionado (painel de detalhe ao lado da grade).
  const selectedItems = history
    .filter((item) => spDayKey(getItemDate(item)) === selectedKey)
    .sort((a, b) => getItemDate(a).getTime() - getItemDate(b).getTime());


  // Todos os agendados futuros, agrupados por mês.
  const upcoming = history
    .filter(isScheduled)
    .sort((a, b) => getItemDate(a).getTime() - getItemDate(b).getTime());
  const upcomingMonths: { label: string; items: HistoryItem[] }[] = [];
  const monthIndex = new Map<string, number>();
  for (const item of upcoming) {
    const label = monthLabel(getItemDate(item));
    let mi = monthIndex.get(label);
    if (mi === undefined) {
      mi = upcomingMonths.length;
      monthIndex.set(label, mi);
      upcomingMonths.push({ label, items: [] });
    }
    upcomingMonths[mi].items.push(item);
  }

  // Preview dos próximos 4 meses (a partir do mês seguinte ao âncora). Cada card
  // mostra quantos posts estão agendados naquele mês e, ao clicar, abre o mês.
  const monthPreviews = Array.from({ length: 4 }, (_, i) => {
    const base = keyToNoon(anchorKey);
    base.setUTCDate(1);
    base.setUTCMonth(base.getUTCMonth() + i + 1);
    const firstKey = noonToKey(base);
    const ym = firstKey.slice(0, 7);
    const count = upcoming.filter(
      (it) => spDayKey(getItemDate(it)).slice(0, 7) === ym,
    ).length;
    return { key: firstKey, label: monthLabel(base), count };
  });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] text-[color:var(--accent)]">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div className="leading-none">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
              Programação de postagens
            </p>
            <h2 className="mt-1.5 text-2xl font-bold capitalize tracking-tight text-[color:var(--text)] sm:text-3xl">
              {monthTitle}
            </h2>
          </div>
        </div>

        {/* Navegação por mês: setas anterior/próximo + "Hoje" quando fora do
            mês atual. */}
        <div className="reports-nav flex items-center gap-2">
          <button
            type="button"
            aria-label="Mês anterior"
            onClick={() => {
              const next = shiftMonthKey(anchorKey, -1);
              setAnchorKey(next);
              setSelectedKey(monthTargetKey(next, todayKey));
            }}
            className="reports-monthnav-arrow"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Próximo mês"
            onClick={() => {
              const next = shiftMonthKey(anchorKey, 1);
              setAnchorKey(next);
              setSelectedKey(monthTargetKey(next, todayKey));
            }}
            className="reports-monthnav-arrow"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => {
                setAnchorKey(todayKey);
                setSelectedKey(todayKey);
              }}
              className="reports-today-btn ml-1"
            >
              Hoje
            </button>
          )}
        </div>
      </div>

      {/* Resumo do mês */}
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryStat
          icon={CalendarClock}
          label="Agendados no mês"
          value={scheduledCount}
        />
        <SummaryStat
          icon={Send}
          label="Postados no mês"
          value={postedCount}
          accent
        />
      </div>

      {loadError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
          Não foi possível carregar o histórico do YouTube agora.
        </div>
      )}

      {/* Calendário do mês + detalhe do dia selecionado */}
      {loading ? (
        <div className="skeleton h-80 rounded-xl" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          {/* Grade do mês */}
          <div className="report-neon-card flex flex-col rounded-2xl border p-3">
            <div className="reports-month-dow">
              {[1, 2, 3, 4, 5, 6, 0].map((i) => (
                <span key={i}>{DAY_NAMES[i]}</span>
              ))}
            </div>
            <div className="reports-month-grid">
              {gridDays.map((dayKey) => {
                const inMonth = dayKey.slice(0, 7) === monthYm;
                const isToday = dayKey === todayKey;
                const isSelected = dayKey === selectedKey;
                const dayItems = history
                  .filter((it) => spDayKey(getItemDate(it)) === dayKey)
                  .sort(
                    (a, b) => getItemDate(a).getTime() - getItemDate(b).getTime(),
                  );
                const count = dayItems.length;
                const previewItems = dayItems.slice(0, 2);
                const extraCount = Math.max(0, count - previewItems.length);
                const countLabel = String(count);
                return (
                  <button
                    key={dayKey}
                    type="button"
                    onClick={() => setSelectedKey(dayKey)}
                    className={cn(
                      "reports-day-cell",
                      !inMonth && "reports-day-cell-out",
                      isToday && "reports-day-cell-today",
                      isSelected && "reports-day-cell-selected",
                    )}
                  >
                    <span className="reports-day-num">{dayNumber(dayKey)}</span>
                    {count > 0 && (
                      <>
                        <span className="reports-day-posts">
                          {previewItems.map((item, i) => (
                            <span
                              key={`${item.videoId ?? "item"}-${i}`}
                              role="button"
                              tabIndex={0}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedEvent(item);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setSelectedEvent(item);
                                }
                              }}
                              className="reports-day-post-pill"
                            >
                              <span className="reports-day-post-time">
                                {spTime(getItemDate(item))}
                              </span>
                              <span className="reports-day-post-title">
                                {item.title}
                              </span>
                            </span>
                          ))}
                        </span>
                        <span className="reports-day-count-badge">{countLabel}</span>
                        {extraCount > 0 && (
                          <span className="reports-day-extra">+{extraCount}</span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Detalhe do dia selecionado */}
          <aside className="report-neon-card flex flex-col rounded-2xl border">
            <div className="border-b border-[color:var(--accent-border)] px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
                {selectedKey === todayKey ? "Hoje" : "Dia selecionado"}
              </p>
              <p className="mt-1 text-base font-bold capitalize text-[color:var(--text)]">
                {weekdayDay(keyToNoon(selectedKey))}
              </p>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
              {selectedItems.length === 0 ? (
                <span className="m-auto py-8 text-[12px] text-[color:var(--muted-soft)]">
                  Nenhum post neste dia.
                </span>
              ) : (
                selectedItems.map((item, i) => {
                  const scheduled = isScheduled(item);
                  const time = spTime(getItemDate(item));
                  const channel = item.channelTitle ?? "";
                  const Inner = (
                    <>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                            scheduled
                              ? "bg-[color:var(--accent)]"
                              : "bg-emerald-500",
                          )}
                        />
                        <span className="font-mono text-[12px] font-semibold tabular-nums text-[color:var(--text)]">
                          {time}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--muted-soft)]">
                          {scheduled ? "agendado" : "postado"}
                        </span>
                      </span>
                      <span className="mt-1 block text-[13px] font-medium leading-snug text-[color:var(--text)]">
                        {item.title}
                      </span>
                      {channel && (
                        <span className="mt-0.5 block truncate text-[11px] text-[color:var(--muted)]">
                          {channel}
                        </span>
                      )}
                    </>
                  );
                  const cls =
                    "block w-full rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-3 py-2.5 text-left transition-colors hover:border-[color:var(--accent-border)]";
                  return (
                    <button
                      key={`${item.videoId ?? "event"}-${i}`}
                      type="button"
                      className={cls}
                      onClick={() => setSelectedEvent(item)}
                    >
                      {Inner}
                    </button>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Preview dos próximos meses. */}
      {!loading && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
            <CalendarDays className="h-3.5 w-3.5" />
            Próximos meses
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {monthPreviews.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setAnchorKey(m.key);
                  setSelectedKey(monthTargetKey(m.key, todayKey));
                }}
                className="month-preview-card group flex flex-col items-start gap-1.5 rounded-xl border px-4 py-4 text-left"
              >
                <span className="text-sm font-semibold capitalize text-[color:var(--text)]">
                  {m.label}
                </span>
                <span className="text-[11px] text-[color:var(--muted)]">
                  {m.count > 0
                    ? `${m.count} agendado${m.count > 1 ? "s" : ""}`
                    : "Sem agendamentos"}
                </span>
                <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--accent)] opacity-0 transition-opacity group-hover:opacity-100">
                  Ver mês
                  <ChevronRight className="h-3 w-3" />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Fila de agendados (próximos dias e meses) */}
      {!loading && upcoming.length > 0 && (
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--field)]">
          <p className="flex items-center gap-2 border-b border-[color:var(--border)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
            <CalendarClock className="h-3.5 w-3.5" />
            Próximos agendados · {upcoming.length}
          </p>
          <div className="divide-y divide-[color:var(--border)]">
            {upcomingMonths.map((month) => (
              <div key={month.label} className="px-4 py-3">
                <p className="mb-2 text-[11px] font-semibold text-[color:var(--accent)]">
                  {month.label}
                </p>
                <ul className="grid gap-1.5">
                  {month.items.map((item, i) => {
                    const date = getItemDate(item);
                    const row = (
                      <>
                        <span className="flex w-[150px] shrink-0 items-center gap-2 text-[12px] text-[color:var(--text)]">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--accent)]" />
                          <span className="font-medium capitalize">{weekdayDay(date)}</span>
                          <span className="font-mono tabular-nums text-[color:var(--muted)]">
                            {spTime(date)}
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium text-[color:var(--text)]">
                            {item.title}
                          </span>
                          {item.channelTitle && (
                            <span className="block truncate text-[10px] text-[color:var(--muted)]">
                              {item.channelTitle}
                            </span>
                          )}
                        </span>
                      </>
                    );
                    const cls =
                      "flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-[color:var(--surface-soft)]";
                    return item.videoId ? (
                      <a
                        key={`${item.videoId}-${i}`}
                        href={`https://studio.youtube.com/video/${item.videoId}/edit`}
                        target="_blank"
                        rel="noreferrer"
                        className={cls}
                      >
                        {row}
                      </a>
                    ) : (
                      <li key={i} className={cls}>
                        {row}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedEvent && (
        <div
          className="reports-event-modal-backdrop"
          role="presentation"
          onClick={() => setSelectedEvent(null)}
        >
          <section
            className="reports-event-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Detalhes do post"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="reports-event-modal-head">
              <div>
                <p className="reports-event-kicker">
                  {isScheduled(selectedEvent) ? "Post agendado" : "Post publicado"}
                </p>
                <h3>{selectedEvent.title}</h3>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <StatusBadge scheduled={isScheduled(selectedEvent)} />
                  {selectedEvent.privacyStatus && (
                    <VisibilityBadge privacy={selectedEvent.privacyStatus} />
                  )}
                </div>
              </div>
              <button
                type="button"
                className="reports-event-close"
                aria-label="Fechar"
                onClick={() => setSelectedEvent(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {(() => {
              const thumbs = thumbnailCandidates(selectedEvent);
              const thumbSrc = thumbs[thumbIndex] ?? null;
              const canShowPlayer = Boolean(selectedEvent.videoId);
              return (
            <div className="reports-event-body">
              <div className="reports-event-video">
                {previewMode === "player" && selectedEvent.videoId ? (
                  <iframe
                    title={selectedEvent.title}
                    src={`https://www.youtube.com/embed/${selectedEvent.videoId}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                ) : thumbSrc ? (
                  <>
                    <img
                      src={thumbSrc}
                      alt=""
                      onError={() => {
                        setThumbIndex((index) =>
                          index + 1 < thumbs.length ? index + 1 : index,
                        );
                      }}
                    />
                    <div className="reports-event-video-shade" />
                    <div className="reports-event-video-actions">
                      {canShowPlayer && (
                        <button
                          type="button"
                          onClick={() => setPreviewMode("player")}
                        >
                          <PlayCircle className="h-5 w-5" />
                          Tentar reproduzir
                        </button>
                      )}
                      {selectedEvent.videoId && (
                        <a
                          href={watchUrl(selectedEvent.videoId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="h-4 w-4" />
                          YouTube
                        </a>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="reports-event-video-placeholder">
                    <CalendarClock className="h-8 w-8" />
                    <span>Prévia do vídeo</span>
                    <strong>Sem preview</strong>
                  </div>
                )}
              </div>

              <div className="reports-event-info">
                <div className="flex flex-col divide-y divide-[color:var(--border)]">
                  <InfoRow
                    label={
                      isScheduled(selectedEvent) ? "Agendado para" : "Publicado em"
                    }
                  >
                    {`${weekdayDay(getItemDate(selectedEvent))} às ${spTime(getItemDate(selectedEvent))}`}
                  </InfoRow>
                  <InfoRow label="Canal">
                    {selectedEvent.channelTitle ?? "Sem canal"}
                  </InfoRow>
                  {selectedEvent.videoId && (
                    <InfoRow label="ID do vídeo">
                      <CopyableId id={selectedEvent.videoId} />
                    </InfoRow>
                  )}
                  <InfoRow label="Duração">
                    {durationLabel(selectedEvent.durationSeconds)}
                  </InfoRow>
                </div>

                {selectedEvent.description?.trim() ? (
                  <div className="mt-4">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[color:var(--muted-soft)]">
                      Descrição
                    </span>
                    <p className="whitespace-pre-wrap break-words rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-3 text-[13px] leading-relaxed text-[color:var(--muted)]">
                      {selectedEvent.description}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
              );
            })()}

            <div className="reports-event-actions">
              <button type="button" onClick={() => setSelectedEvent(null)}>
                Fechar
              </button>
              {selectedEvent.videoId && (
                <>
                  <a
                    href={watchUrl(selectedEvent.videoId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Ver no YouTube
                  </a>
                  <a
                    href={studioUrl(selectedEvent.videoId)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Abrir no Studio
                  </a>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
