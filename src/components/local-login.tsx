import { type FormEvent, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

// Credenciais do login local NUNCA ficam hardcoded no codigo (o repo e publico).
// Defina no arquivo .env (que esta no .gitignore) as variaveis:
//   VITE_LOCAL_LOGIN_NAME e VITE_LOCAL_LOGIN_PASSWORD
// Veja .env.example.
export const LOCAL_LOGIN_NAME = import.meta.env.VITE_LOCAL_LOGIN_NAME ?? "";
export const LOCAL_LOGIN_PASSWORD = import.meta.env.VITE_LOCAL_LOGIN_PASSWORD ?? "";
export const LOCAL_SESSION_KEY = "contas_exe.local-session.v1";

type LocalLoginProps = {
  onThemeChange: (theme: AppTheme) => void;
  onUnlock: () => void;
  theme: AppTheme;
};

export function LocalLogin({
  onThemeChange,
  onUnlock,
  theme,
}: LocalLoginProps) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!LOCAL_LOGIN_NAME || !LOCAL_LOGIN_PASSWORD) {
      setError("Login nao configurado. Defina VITE_LOCAL_LOGIN_* no .env.");
      return;
    }

    if (name.trim() === LOCAL_LOGIN_NAME && password === LOCAL_LOGIN_PASSWORD) {
      setError("");
      onUnlock();
      return;
    }

    setError("Dados incorretos.");
  }

  return (
    <main
      className={cn(
        `theme-${theme}`,
        "app-shell login-shell flex min-h-screen items-center justify-center px-4 py-8",
      )}
    >
      <form
        className="app-panel login-card vault-card animate-pop-in w-full max-w-xl overflow-hidden rounded-[34px] border p-6 backdrop-blur-2xl sm:p-8"
        onSubmit={handleSubmit}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="brand-mark relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border">
              <img
                src="/logo.png"
                alt="Contas_exe"
                className="h-full w-full object-cover"
              />
              <span className="status-dot absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border">
                <span className="h-1.5 w-1.5 rounded-full" />
              </span>
            </div>
            <div>
              <p className="font-mono text-base font-semibold tracking-wide text-[color:var(--text)]">
                Contas_exe
              </p>
            </div>
          </div>
          <ThemeToggle value={theme} onChange={onThemeChange} />
        </div>

        <div className="mt-9 space-y-5">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-[color:var(--muted)]">
              Nome
            </span>
            <Input
              autoFocus
              autoComplete="username"
              className="h-12 rounded-2xl px-4 text-base"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-[color:var(--muted)]">
              Senha
            </span>
            <div className="relative">
              <Input
                autoComplete="current-password"
                className="h-12 rounded-2xl px-4 pr-12 text-base"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                className="icon-soft absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl transition"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </label>
        </div>

        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

        <Button
          className="mt-7 h-12 w-full rounded-2xl text-base"
          type="submit"
        >
          <KeyRound className="h-4 w-4" />
          Entrar
        </Button>
      </form>
    </main>
  );
}
