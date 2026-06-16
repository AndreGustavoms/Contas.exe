import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

const DAYS_SHORT = ["D", "S", "T", "Q", "Q", "S", "S"];

const MONTHS_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function parseLocal(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function toLocalIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  min?: string;
}

export function DatePicker({ value, onChange, disabled, placeholder = "dd/mm/aaaa", min }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = parseLocal(value);
  const today = new Date();
  const minDate = min ? parseLocal(min) : null;

  const [cursor, setCursor] = useState<{ year: number; month: number }>(() => {
    const d = selected ?? today;
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openPicker() {
    if (disabled) return;
    const d = selected ?? today;
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setOpen(true);
  }

  function prevMonth() {
    setCursor(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 },
    );
  }

  function nextMonth() {
    setCursor(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 },
    );
  }

  function select(date: Date) {
    const iso = toLocalIso(date);
    onChange(iso);
    setOpen(false);
  }

  function clear() {
    onChange("");
    setOpen(false);
  }

  function goToday() {
    select(today);
  }

  function isDisabled(date: Date) {
    if (!minDate) return false;
    return date < minDate;
  }

  function isSameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  const grid = buildGrid(cursor.year, cursor.month);

  const displayValue = selected
    ? `${String(selected.getDate()).padStart(2, "0")}/${String(selected.getMonth() + 1).padStart(2, "0")}/${selected.getFullYear()}`
    : "";

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        className={cn(
          "flex h-11 w-full items-center gap-2.5 rounded-xl border px-3.5 text-sm transition-all duration-200 outline-none",
          "bg-[color:var(--field)] text-left",
          open
            ? "border-[color:var(--accent)] ring-2 ring-[color:var(--accent)]/20 text-[color:var(--text)]"
            : "border-[color:var(--border)] hover:border-[color:var(--accent-border)] text-[color:var(--text)]",
          disabled && "cursor-not-allowed opacity-50",
          !displayValue && "text-[color:var(--muted)]",
        )}
      >
        <Calendar className={cn("h-4 w-4 shrink-0", open ? "text-[color:var(--accent)]" : "text-[color:var(--muted)]")} />
        <span className="flex-1 tabular-nums">{displayValue || placeholder}</span>
      </button>

      {/* Calendar dropdown */}
      {open && (
        <div className="absolute z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--surface-soft)] shadow-[0_16px_48px_-8px_var(--accent-glow),0_4px_16px_-4px_rgba(0,0,0,.5)] backdrop-blur-xl">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-3">
            <button
              type="button"
              onClick={prevMonth}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--accent-surface)] hover:text-[color:var(--accent)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <span className="text-sm font-semibold text-[color:var(--text)]">
              {MONTHS_PT[cursor.month]}{" "}
              <span className="text-[color:var(--muted)]">{cursor.year}</span>
            </span>

            <button
              type="button"
              onClick={nextMonth}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--muted)] transition hover:bg-[color:var(--accent-surface)] hover:text-[color:var(--accent)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Day labels */}
          <div className="grid grid-cols-7 px-3 pt-3">
            {DAYS_SHORT.map((d, i) => (
              <div
                key={i}
                className="flex h-7 items-center justify-center text-[10px] font-bold uppercase tracking-widest text-[color:var(--muted)]"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Grid */}
          <div className="grid grid-cols-7 gap-y-0.5 px-3 pb-3 pt-1">
            {grid.map((date, i) => {
              if (!date) return <div key={i} />;
              const isSelected = selected ? isSameDay(date, selected) : false;
              const isToday = isSameDay(date, today);
              const isOff = isDisabled(date);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={isOff}
                  onClick={() => select(date)}
                  className={cn(
                    "relative flex h-8 w-full items-center justify-center rounded-lg text-sm font-medium transition-all duration-150",
                    isSelected
                      ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)] shadow-[0_4px_14px_-4px_var(--accent)] font-bold"
                      : isToday
                        ? "border border-[color:var(--accent-border)] text-[color:var(--accent-soft)]"
                        : isOff
                          ? "cursor-not-allowed text-[color:var(--muted)] opacity-30"
                          : "text-[color:var(--text)] hover:bg-[color:var(--accent-surface)] hover:text-[color:var(--accent)]",
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[color:var(--border)] px-4 py-2.5">
            <button
              type="button"
              onClick={clear}
              className="text-[12px] font-semibold text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={goToday}
              className="text-[12px] font-semibold text-[color:var(--accent-soft)] transition hover:text-[color:var(--accent)]"
            >
              Hoje
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
