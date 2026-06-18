import { useEffect, useState } from "react";
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { cn } from "../../lib/utils";

const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

type HistoryItem = {
  videoId: string | null;
  channelTitle?: string;
  title: string;
  uploadedAt: string;
  publishAt?: string | null;
  privacyStatus?: string;
  thumbnailUrl?: string | null;
};

// ---------------------------------------------------------------------------
// Todo o cálculo de dia/semana/hora é fixado em America/Sao_Paulo via chaves de
// dia "YYYY-MM-DD": determinístico, imune ao fuso de quem abre e ao servidor em
// UTC. A semana é seg→dom (7 dias).
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
const dayShortFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
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
function dayNumber(key: string): number {
  return parseInt(key.slice(8, 10), 10);
}
function fmtDayShort(key: string): string {
  return dayShortFmt.format(keyToNoon(key));
}

function getItemDate(item: HistoryItem): Date {
  return new Date(item.publishAt ?? item.uploadedAt);
}
function isScheduled(item: HistoryItem): boolean {
  return Boolean(item.publishAt && new Date(item.publishAt) > new Date());
}

export function ReportsPanel() {
  const todayKey = spDayKey(new Date());
  const [anchorKey, setAnchorKey] = useState(todayKey);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

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

  const weekStartKey = mondayOfKey(anchorKey);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysKey(weekStartKey, i));
  const weekSet = new Set(weekDays);

  const weekItems = history
    .filter((item) => weekSet.has(spDayKey(getItemDate(item))))
    .sort((a, b) => getItemDate(a).getTime() - getItemDate(b).getTime());
  const scheduledCount = weekItems.filter(isScheduled).length;
  const postedCount = weekItems.length - scheduledCount;

  const weekRange = `${fmtDayShort(weekStartKey)} – ${fmtDayShort(weekDays[6])}`;

  // Todos os agendados futuros (próximos dias/meses), agrupados por mês — vai
  // além da semana visível para você enxergar a fila inteira de programados.
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--border)] bg-[color:var(--field)] text-[color:var(--accent)]">
            <CalendarDays className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[color:var(--text)]">
              Programação de postagens
            </h2>
            <p className="mt-0.5 text-[11px] text-[color:var(--muted)]">
              Uploads feitos pelo app · horário de Brasília
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-2 hidden min-w-[118px] text-center text-[12px] font-semibold text-[color:var(--text)] sm:inline">
            {weekRange}
          </span>
          <button
            type="button"
            aria-label="Semana anterior"
            onClick={() => setAnchorKey((k) => addDaysKey(k, -7))}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setAnchorKey(spDayKey(new Date()))}
            className="rounded-lg px-3 py-2 text-[11px] font-semibold text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)]"
          >
            Hoje
          </button>
          <button
            type="button"
            aria-label="Próxima semana"
            onClick={() => setAnchorKey((k) => addDaysKey(k, 7))}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Atualizar"
            onClick={() => fetchHistory(true)}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)]"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Resumo */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Agendados na semana
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[color:var(--text)]">
            {scheduledCount}
          </p>
        </div>
        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Postados na semana
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[color:var(--text)]">
            {postedCount}
          </p>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
          Não foi possível carregar o histórico do YouTube agora.
        </div>
      )}

      {/* Calendário da semana (seg → dom) */}
      {loading ? (
        <div className="skeleton h-44 rounded-xl" />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[680px] grid-cols-7 gap-2">
            {weekDays.map((dayKey) => {
              const dow = weekdayOfKey(dayKey);
              const isToday = dayKey === todayKey;
              const dayItems = weekItems.filter(
                (item) => spDayKey(getItemDate(item)) === dayKey,
              );

              return (
                <div
                  key={dayKey}
                  className={cn(
                    "flex min-h-[140px] flex-col rounded-xl border",
                    isToday
                      ? "border-[color:var(--accent-border)] bg-[color:var(--accent-surface)]/40"
                      : "border-[color:var(--border)] bg-[color:var(--field)]",
                  )}
                >
                  {/* Cabeçalho do dia */}
                  <div
                    className={cn(
                      "flex items-baseline justify-between border-b px-2.5 py-2",
                      isToday
                        ? "border-[color:var(--accent-border)]"
                        : "border-[color:var(--border)]",
                    )}
                  >
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase",
                        isToday
                          ? "text-[color:var(--accent)]"
                          : "text-[color:var(--muted)]",
                      )}
                    >
                      {DAY_NAMES[dow]}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        isToday
                          ? "text-[color:var(--accent)]"
                          : "text-[color:var(--text)]",
                      )}
                    >
                      {dayNumber(dayKey)}
                    </span>
                  </div>

                  {/* Posts do dia */}
                  <div className="flex flex-1 flex-col gap-1 p-1.5">
                    {dayItems.length === 0 ? (
                      <span className="m-auto text-[11px] text-[color:var(--muted-soft)]">
                        —
                      </span>
                    ) : (
                      dayItems.map((item, i) => {
                        const scheduled = isScheduled(item);
                        const time = spTime(getItemDate(item));
                        const channel = item.channelTitle ?? "";
                        const tooltip = [time, item.title, channel]
                          .filter(Boolean)
                          .join(" · ");
                        const Inner = (
                          <>
                            <span className="flex items-center gap-1">
                              <span
                                className={cn(
                                  "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                                  scheduled
                                    ? "bg-[color:var(--accent)]"
                                    : "bg-emerald-500",
                                )}
                              />
                              <span className="font-mono text-[11px] font-semibold tabular-nums text-[color:var(--text)]">
                                {time}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] leading-tight text-[color:var(--text)]">
                              {item.title}
                            </span>
                            {channel && (
                              <span className="block truncate text-[10px] leading-tight text-[color:var(--muted)]">
                                {channel}
                              </span>
                            )}
                          </>
                        );
                        const cls = cn(
                          "block rounded-lg border px-2 py-1.5 text-left transition-colors",
                          scheduled
                            ? "border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] hover:bg-[color:var(--accent-surface)]"
                            : "border-[color:var(--border)] bg-[color:var(--surface-soft)] hover:border-[color:var(--accent-border)]",
                        );
                        return item.videoId ? (
                          <a
                            key={`${item.videoId}-${i}`}
                            href={`https://studio.youtube.com/video/${item.videoId}/edit`}
                            target="_blank"
                            rel="noreferrer"
                            title={tooltip}
                            className={cls}
                          >
                            {Inner}
                          </a>
                        ) : (
                          <div key={i} title={tooltip} className={cls}>
                            {Inner}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
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
    </div>
  );
}
