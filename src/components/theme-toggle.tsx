import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { type AppTheme, themeOptions } from "../theme";
import { cn } from "../lib/utils";

type ThemeToggleProps = {
  onChange: (theme: AppTheme) => void;
  value: AppTheme;
};

// Collapses the three theme choices behind a single symbol button: it shows
// the active theme's icon and opens a small dropdown to switch.
export function ThemeToggle({ onChange, value }: ThemeToggleProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = themeOptions.find((option) => option.value === value);
  const ActiveIcon = active?.icon;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Tema"
        className="theme-toggle flex h-10 items-center gap-1.5 rounded-2xl border px-2.5 text-xs font-semibold text-[color:var(--muted)] backdrop-blur-xl transition duration-300 hover:text-[color:var(--text)]"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {ActiveIcon ? <ActiveIcon className="h-4 w-4" /> : null}
        <span className="hidden sm:inline">{active?.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div className="theme-toggle-menu animate-pop-in absolute right-0 top-[calc(100%+8px)] z-50 w-40 overflow-hidden rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--panel-strong)] p-1.5 shadow-[0_24px_70px_var(--accent-glow)] backdrop-blur-2xl">
          {themeOptions.map((option) => {
            const Icon = option.icon;
            const selected = option.value === value;

            return (
              <button
                key={option.value}
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium transition duration-150",
                  selected
                    ? "bg-[color:var(--accent-surface)] text-[color:var(--accent-soft)]"
                    : "text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]",
                )}
                role="option"
                aria-selected={selected}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{option.label}</span>
                {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
