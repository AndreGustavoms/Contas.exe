import * as React from "react";
import { cn } from "../../lib/utils";

// Toggle switch backed by a real checkbox for semantics/keyboard (see .switch in
// index.css). Drop-in for a checkbox: pass checked/onChange like normal.
export interface SwitchProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label?: string;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, label, ...props }, ref) => (
    <span className={cn("switch", className)}>
      <input ref={ref} type="checkbox" aria-label={label} {...props} />
      <span className="switch-track" />
      <span className="switch-thumb" />
    </span>
  ),
);

Switch.displayName = "Switch";
