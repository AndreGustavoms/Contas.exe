import { Moon, Sun } from "lucide-react";
import { type AppTheme } from "../theme";

type ThemeToggleProps = {
  menuPlacement?: "down" | "up";
  onChange: (theme: AppTheme) => void;
  value: AppTheme;
};

export function ThemeToggle({ onChange, value }: ThemeToggleProps) {
  const isDark = value === "dark";

  function toggle() {
    onChange(isDark ? "white" : "dark");
  }

  return (
    <div className="theme-switch-wrap">
      <Sun
        className="theme-switch-icon theme-switch-icon--sun"
        width={18}
        height={18}
      />
      <label className="theme-switch">
        <input type="checkbox" checked={isDark} onChange={toggle} />
        <span className="theme-switch-inner" data-on="Dark" data-off="Light" />
      </label>
      <Moon
        className="theme-switch-icon theme-switch-icon--moon"
        width={18}
        height={18}
      />
    </div>
  );
}
