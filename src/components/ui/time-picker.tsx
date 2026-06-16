import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "../../lib/utils";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const ITEM_H = 36;

interface TimePickerProps {
  value: string;       // "HH:MM" or ""
  onChange: (value: string) => void;
  disabled?: boolean;
}

function parseTime(v: string): { h: string; m: string } {
  const [h, m] = (v ?? "").split(":");
  return {
    h: HOURS.includes(h) ? h : "00",
    m: MINUTES.includes(m) ? m : "00",
  };
}

function Column({
  items,
  selected,
  onSelect,
}: {
  items: string[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = items.indexOf(selected);

  // Scroll to selected on open / change
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: idx * ITEM_H, behavior: "smooth" });
  }, [idx]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const nearest = Math.round(el.scrollTop / ITEM_H);
    const clamped = Math.max(0, Math.min(items.length - 1, nearest));
    if (items[clamped] !== selected) onSelect(items[clamped]);
  }

  return (
    <div className="relative flex-1">
      {/* highlight strip */}
      <div
        className="pointer-events-none absolute inset-x-0 rounded-lg border border-[color:var(--accent-border)] bg-[color:var(--accent-surface)]"
        style={{ top: "50%", transform: "translateY(-50%)", height: ITEM_H }}
      />
      {/* fade top */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-[color:var(--page-bg)] to-transparent z-10" />
      {/* fade bottom */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[color:var(--page-bg)] to-transparent z-10" />

      <div
        ref={ref}
        onScroll={onScroll}
        className="scrollbar-none overflow-y-scroll"
        style={{ height: ITEM_H * 5, scrollSnapType: "y mandatory" }}
      >
        {/* padding so first/last items can center */}
        <div style={{ height: ITEM_H * 2 }} />
        {items.map((item) => (
          <div
            key={item}
            onClick={() => onSelect(item)}
            style={{ height: ITEM_H, scrollSnapAlign: "center" }}
            className={cn(
              "flex cursor-pointer items-center justify-center text-sm font-semibold tabular-nums transition-all duration-150 select-none",
              item === selected
                ? "text-[color:var(--accent-soft)] scale-110"
                : "text-[color:var(--muted)] hover:text-[color:var(--text)]",
            )}
          >
            {item}
          </div>
        ))}
        <div style={{ height: ITEM_H * 2 }} />
      </div>
    </div>
  );
}

export function TimePicker({ value, onChange, disabled }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { h, m } = parseTime(value);
  const [selH, setSelH] = useState(h);
  const [selM, setSelM] = useState(m);

  // Sync from outside value
  useEffect(() => {
    const parsed = parseTime(value);
    setSelH(parsed.h);
    setSelM(parsed.m);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        commit();
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { commit(); setOpen(false); }
      if (e.key === "Enter") { commit(); setOpen(false); }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selH, selM]);

  function commit() {
    onChange(`${selH}:${selM}`);
  }

  function handleH(v: string) { setSelH(v); onChange(`${v}:${selM}`); }
  function handleM(v: string) { setSelM(v); onChange(`${selH}:${v}`); }

  const display = value ? `${h}:${m}` : "";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={cn(
          "flex h-11 w-full items-center gap-2.5 rounded-xl border px-3.5 text-sm transition-all duration-200 outline-none",
          "bg-[color:var(--field)] text-left",
          open
            ? "border-[color:var(--accent)] ring-2 ring-[color:var(--accent)]/20 text-[color:var(--text)]"
            : "border-[color:var(--border)] hover:border-[color:var(--accent-border)] text-[color:var(--text)]",
          disabled && "cursor-not-allowed opacity-50",
          !display && "text-[color:var(--muted)]",
        )}
      >
        <Clock className={cn("h-4 w-4 shrink-0", open ? "text-[color:var(--accent)]" : "text-[color:var(--muted)]")} />
        <span className="flex-1 tabular-nums">{display || "hh:mm"}</span>
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-2 w-64 overflow-hidden rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--page-bg)] shadow-[0_20px_56px_-8px_var(--accent-glow),0_8px_24px_-4px_rgba(0,0,0,.7)]">
          {/* separator label */}
          <div className="flex items-center border-b border-[color:var(--border)] px-4 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--muted)]">Hora</span>
            <span className="mx-auto text-xs font-bold text-[color:var(--muted)]">:</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--muted)]">Min</span>
          </div>

          <div className="flex gap-0 px-3 py-1">
            <Column items={HOURS} selected={selH} onSelect={handleH} />
            <div className="flex items-center self-stretch px-1 text-lg font-bold text-[color:var(--muted)]">:</div>
            <Column items={MINUTES} selected={selM} onSelect={handleM} />
          </div>

          <div className="border-t border-[color:var(--border)] px-4 py-2.5 flex justify-end">
            <button
              type="button"
              onClick={() => { commit(); setOpen(false); }}
              className="text-[12px] font-semibold text-[color:var(--accent-soft)] transition hover:text-[color:var(--accent)]"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
