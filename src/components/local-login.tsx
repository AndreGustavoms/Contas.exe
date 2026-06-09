import { type FormEvent, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { type SessionUser } from "../App";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

// O login agora e validado no SERVIDOR: enviamos as credenciais para
// POST /api/auth/login, que confere contra a tabela de usuarios (users.json,
// hashes scrypt) e devolve um cookie de sessao HttpOnly + os dados do usuario
// (username + role). Nenhuma credencial fica no bundle.

type LocalLoginProps = {
  onThemeChange: (theme: AppTheme) => void;
  onUnlock: (user: SessionUser) => void;
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
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password }),
      });

      if (response.ok) {
        const data: { user?: SessionUser } = await response.json();
        // The server always returns the user on success; fall back defensively.
        onUnlock(data.user ?? { username: name.trim(), role: "member" });
        return;
      }

      setError(
        response.status === 401 ? "Dados incorretos." : "Falha ao entrar.",
      );
    } catch {
      setError("Nao foi possivel conectar ao servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      className={cn(
        `theme-${theme}`,
        "app-shell login-shell flex min-h-screen items-center justify-center px-4 py-8",
      )}
    >
      <form
        className="app-panel login-card vault-card animate-pop-in w-full max-w-xl overflow-visible rounded-[34px] border p-6 backdrop-blur-2xl sm:p-8"
        onSubmit={handleSubmit}
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="brand-mark relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border">
              <img
                src="/logo-square.png"
                alt="Contas_exe"
                className="h-full w-full object-contain p-1"
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
          <ThemeToggle
            value={theme}
            onChange={onThemeChange}
            menuPlacement="down"
          />
        </div>

        <div className="mt-9 space-y-6">
          <div className="float-field">
            <Input
              autoFocus
              autoComplete="username"
              className="h-12 rounded-2xl px-4 text-base"
              id="login-user"
              placeholder=" "
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <label htmlFor="login-user">Usuário</label>
          </div>

          <div className="float-field">
            <Input
              autoComplete="current-password"
              className="h-12 rounded-2xl px-4 pr-12 text-base"
              id="login-password"
              placeholder=" "
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <label htmlFor="login-password">Senha</label>
            <button
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              className="icon-soft absolute right-3 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-xl transition"
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
        </div>

        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

        <Button
          className="mt-7 h-12 w-full rounded-2xl text-base"
          variant="neon"
          type="submit"
          disabled={submitting}
        >
          {submitting ? (
            <Spinner className="h-5 w-5" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          {submitting ? "Entrando..." : "Entrar"}
        </Button>
      </form>
    </main>
  );
}
