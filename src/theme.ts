import { Moon, Sun, type LucideIcon } from "lucide-react";

export type AppTheme = "dark" | "white";

export const THEME_STORAGE_KEY = "contas_exe.theme.v1";

export const themeOptions: Array<{
  icon: LucideIcon;
  label: string;
  value: AppTheme;
}> = [
  { icon: Moon, label: "Dark", value: "dark" },
  { icon: Sun, label: "White", value: "white" },
];

export function isAppTheme(value: string | null): value is AppTheme {
  return value === "dark" || value === "white";
}
