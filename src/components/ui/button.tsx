import * as React from "react";
import { cn } from "../../lib/utils";

const baseClasses =
  "inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--page-bg)] disabled:pointer-events-none disabled:opacity-50";

const variantClasses = {
  default:
    "border-[color:var(--accent-border)] bg-[color:var(--accent)] text-[color:var(--accent-foreground)] shadow-[0_0_34px_var(--accent-glow)] hover:-translate-y-0.5 hover:border-[color:var(--accent-soft)] hover:bg-[color:var(--accent-hover)]",
  outline:
    "border-[color:var(--border)] bg-[color:var(--surface-soft)] text-[color:var(--text)] backdrop-blur hover:-translate-y-0.5 hover:border-[color:var(--accent-border)] hover:bg-[color:var(--accent-surface)]",
  ghost:
    "border-transparent bg-transparent text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]",
  secondary:
    "border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] text-[color:var(--accent-soft)] hover:border-[color:var(--accent)] hover:bg-[color:var(--accent-surface-strong)]",
  danger: "border-red-700 bg-red-700 text-white hover:bg-red-800",
  // Animated neon border (see .btn-neon in index.css). Flat themed fill with a
  // sweeping glow ring; lifts slightly on hover like the other variants.
  neon: "btn-neon border-transparent bg-[color:var(--accent)] text-[color:var(--accent-foreground)] hover:-translate-y-0.5",
} as const;

const sizeClasses = {
  sm: "h-9 px-3",
  md: "h-10 px-4",
  icon: "h-10 w-10 p-0",
} as const;

type ButtonVariant = keyof typeof variantClasses;
type ButtonSize = keyof typeof sizeClasses;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      className={cn(
        baseClasses,
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);

Button.displayName = "Button";
