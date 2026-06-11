import { useEffect } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "../../lib/utils";

// Animated feedback toast (see .toast in index.css). Fixed bottom-center, auto
// dismisses after `duration` ms. `tone` picks the icon/accent: success or error.
type ToastProps = {
  message: string;
  tone?: "success" | "error";
  duration?: number;
  onDismiss: () => void;
};

export function Toast({
  message,
  tone = "success",
  duration = 3200,
  onDismiss,
}: ToastProps) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(id);
  }, [message, duration, onDismiss]);

  const Icon = tone === "error" ? AlertTriangle : CheckCircle2;

  return (
    // bottom respeita o home indicator (safe-area) em iPhone/Android gesture nav.
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] z-[60] flex justify-center px-4"
    >
      <div
        className={cn(
          "toast app-panel pointer-events-auto flex max-w-full items-center gap-3 rounded-2xl border px-4 py-3 shadow-[0_24px_70px_var(--accent-glow)] backdrop-blur-2xl",
        )}
        role="status"
      >
        <Icon
          className={cn(
            "h-5 w-5 shrink-0",
            tone === "error" ? "text-red-300" : "text-[color:var(--accent)]",
          )}
        />
        <span className="min-w-0 break-words text-sm font-medium text-[color:var(--text)]">
          {message}
        </span>
        <button
          aria-label="Fechar"
          className="ml-1 rounded-lg p-1 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
          type="button"
          onClick={onDismiss}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
