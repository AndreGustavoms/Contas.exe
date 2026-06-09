import { cn } from "../../lib/utils";

// Themed ring spinner (see .spinner in index.css). Size follows font-size, so
// `className="h-4 w-4"` or a text-size class controls it. aria-hidden by default
// since it's decorative next to a textual label like "Entrando…".
export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("spinner", className)} />;
}
