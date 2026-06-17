import { useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RefreshCw,
} from "lucide-react";
import { cn } from "../../lib/utils";

type SlotType = "post" | "support";

type Slot = {
  time: string;
  endTime?: string;
  type: SlotType;
};

const WEEK_SCHEDULE: Record<number, Slot[]> = {
  1: [
    { time: "09:00", endTime: "09:30", type: "support" },
    { time: "17:00", endTime: "17:30", type: "support" },
  ],
  2: [
    { time: "09:00", endTime: "09:30", type: "support" },
    { time: "17:00", endTime: "17:30", type: "support" },
  ],
  3: [
    { time: "09:00", endTime: "09:30", type: "support" },
    { time: "17:00", endTime: "17:30", type: "support" },
  ],
  4: [
    { time: "09:00", type: "post" },
    { time: "17:00", type: "post" },
  ],
  5: [
    { time: "09:00", endTime: "09:30", type: "support" },
    { time: "17:00", endTime: "17:30", type: "support" },
  ],
};

const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DAY_NAMES_FULL = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

type HistoryItem = {
  videoId: string | null;
  title: string;
  uploadedAt: string;
  publishAt?: string | null;
  privacyStatus?: string;
  thumbnailUrl?: string | null;
};

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function slotMatchesVideo(slot: Slot, day: Date, item: HistoryItem): boolean {
  const ts = item.publishAt ?? item.uploadedAt;
  const d = new Date(ts);
  if (!isSameDay(d, day)) return false;
  const h = d.getHours();
  const slotH = parseInt(slot.time.split(":")[0], 10);
  const endH = slot.endTime
    ? parseInt(slot.endTime.split(":")[0], 10)
    : slotH + 1;
  return h >= slotH && h < endH;
}

function fmtWeekRange(start: Date): string {
  const end = addDays(start, 4);
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  return `${start.toLocaleDateString("pt-BR", opts)} - ${end.toLocaleDateString("pt-BR", opts)}`;
}

function getSlotLabel(slot: Slot): string {
  return slot.type === "post" ? "Postagem principal" : "Apoio";
}

function getItemDate(item: HistoryItem): Date {
  return new Date(item.publishAt ?? item.uploadedAt);
}

function isScheduled(item: HistoryItem): boolean {
  return Boolean(item.publishAt && new Date(item.publishAt) > new Date());
}

export function ReportsPanel() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;

    function load(silent = false) {
      if (!silent) setLoading(true);
      if (silent) setRefreshing(true);
      fetch("/api/youtube/history")
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d: { items?: HistoryItem[] }) => {
          if (!alive) return;
          setHistory(d.items ?? []);
          setLoadError(false);
        })
        .catch(() => {
          if (!alive) return;
          setHistory([]);
          setLoadError(true);
        })
        .finally(() => {
          if (!alive) return;
          setLoading(false);
          setRefreshing(false);
        });
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
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const workDays = Array.from({ length: 5 }, (_, i) => addDays(weekStart, i));
  const weekItems = history
    .filter((item) => {
      const d = getItemDate(item);
      return d >= weekStart && d < addDays(weekStart, 5);
    })
    .sort((a, b) => getItemDate(a).getTime() - getItemDate(b).getTime());
  const scheduledCount = weekItems.filter(isScheduled).length;
  const postedCount = weekItems.length - scheduledCount;

  function refreshNow() {
    setRefreshing(true);
    fetch("/api/youtube/history")
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

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
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
              Dados reais dos uploads feitos pelo app
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <span className="mr-2 hidden min-w-[118px] text-center text-[12px] font-semibold text-[color:var(--text)] sm:inline">
            {fmtWeekRange(weekStart)}
          </span>
          <button
            type="button"
            aria-label="Semana anterior"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(getWeekStart(new Date()))}
            className="rounded-lg px-3 py-2 text-[11px] font-semibold text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)]"
          >
            Hoje
          </button>
          <button
            type="button"
            aria-label="Próxima semana"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Atualizar programação"
            onClick={refreshNow}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--field)] hover:text-[color:var(--text)]"
          >
            <RefreshCw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
            />
          </button>
        </div>
      </div>

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

      {loading ? (
        <div className="grid gap-2">
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-24 rounded-xl" />
          <div className="skeleton h-24 rounded-xl" />
        </div>
      ) : weekItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--border)] px-4 py-8 text-center">
          <CalendarDays className="mx-auto h-5 w-5 text-[color:var(--muted)]" />
          <p className="mt-3 text-sm font-semibold text-[color:var(--text)]">
            Nenhuma postagem registrada nesta semana
          </p>
          <p className="mt-1 text-[12px] text-[color:var(--muted)]">
            Assim que um vídeo for postado ou agendado pelo app, ele aparece
            aqui.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[color:var(--border)] bg-[color:var(--field)]">
          {workDays.map((day) => {
            const dow = day.getDay();
            const slots = WEEK_SCHEDULE[dow] ?? [];
            const isToday = isSameDay(day, today);
            const dayItems = weekItems.filter((item) =>
              isSameDay(getItemDate(item), day),
            );

            if (dayItems.length === 0) return null;

            return (
              <section
                key={day.toISOString()}
                className="grid gap-0 border-b border-[color:var(--border)] last:border-b-0 md:grid-cols-[150px_1fr]"
              >
                <div
                  className={cn(
                    "flex items-center gap-3 px-4 py-4 md:border-r md:border-[color:var(--border)]",
                    isToday && "bg-[color:var(--accent-surface)]",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg border border-[color:var(--border)] text-center leading-none",
                      isToday
                        ? "border-[color:var(--accent-border)] text-[color:var(--accent)]"
                        : "text-[color:var(--text)]",
                    )}
                  >
                    <span className="text-[9px] font-bold uppercase">
                      {DAY_NAMES[dow]}
                    </span>
                    <span className="text-base font-bold tabular-nums">
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                      {DAY_NAMES_FULL[dow]}
                    </p>
                    {isToday && (
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                        Hoje
                      </p>
                    )}
                  </div>
                </div>

                <div className="divide-y divide-[color:var(--border)]">
                  {dayItems.map((item, index) => {
                    const matchedSlot = slots.find((slot) =>
                      slotMatchesVideo(slot, day, item),
                    );
                    const itemDate = getItemDate(item);
                    const scheduled = isScheduled(item);

                    return (
                      <div
                        key={`${item.videoId ?? item.title}-${item.uploadedAt}-${index}`}
                        className="grid gap-2 px-4 py-3 sm:grid-cols-[120px_1fr_auto] sm:items-center"
                      >
                        <div className="flex items-center gap-2 font-mono text-[12px] font-semibold text-[color:var(--text)]">
                          <Clock3 className="h-3.5 w-3.5 text-[color:var(--muted)]" />
                          {itemDate.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-[color:var(--text)]">
                            {item.title}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-[color:var(--muted)]">
                            {matchedSlot
                              ? getSlotLabel(matchedSlot)
                              : "Postagem fora da grade fixa"}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                            scheduled
                              ? "bg-[color:var(--accent-surface)] text-[color:var(--accent)]"
                              : "bg-[color:var(--surface-soft)] text-[color:var(--muted)]",
                          )}
                        >
                          {scheduled ? (
                            <CalendarDays className="h-3 w-3" />
                          ) : (
                            <CheckCircle2 className="h-3 w-3" />
                          )}
                          {scheduled ? "Agendado" : "Postado"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!loading && weekItems.length > 0 && (
        <div className="rounded-xl border border-[color:var(--border)] bg-transparent px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--muted)]">
            Grade fixa
          </p>
          <div className="mt-2 grid gap-1 text-[12px] text-[color:var(--muted)] sm:grid-cols-2">
            <span>Seg/Ter/Qua/Sex: apoio 09:00 e 17:00</span>
            <span>Quinta: postagem principal 09:00 e 17:00</span>
          </div>
        </div>
      )}
    </div>
  );
}
