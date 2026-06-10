import { type FormEvent, useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
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
  // "password" = user+password; "totp" = the 2FA code step after the server says
  // twoFactorRequired. `code` doubles as a TOTP or a recovery code.
  const [step, setStep] = useState<"password" | "totp">("password");
  const [code, setCode] = useState("");

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
        const data: { user?: SessionUser; twoFactorRequired?: boolean } =
          await response.json();
        if (data.twoFactorRequired) {
          // Password was right; ask for the 2FA code in the next step.
          setStep("totp");
          return;
        }
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

  async function handleTotpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password, code: code.trim() }),
      });

      if (response.ok) {
        const data: { user?: SessionUser } = await response.json();
        onUnlock(data.user ?? { username: name.trim(), role: "member" });
        return;
      }

      setError(
        response.status === 401
          ? "Codigo invalido."
          : response.status === 429
            ? "Muitas tentativas. Aguarde."
            : "Falha ao entrar.",
      );
    } catch {
      setError("Nao foi possivel conectar ao servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  function backToPassword() {
    setStep("password");
    setCode("");
    setError("");
  }

  return (
    <main className={cn(`theme-${theme}`, "app-shell login-shell min-h-screen")}>
      <div className="login-layout">
        <section className="login-brand-panel" aria-label="Contas_exe">
          <div className="login-brand-content">
            <div className="login-brand-lockup">
              <div className="login-brand-mark">
                <img
                  src="/logo-square.png"
                  alt="Contas_exe"
                  className="h-full w-full object-contain p-1"
                />
              </div>
              <p>Contas_exe</p>
            </div>

            <div className="login-brand-copy">
              <h1>Contas_exe</h1>
              <p>Area restrita</p>
            </div>
          </div>

          <p className="login-footer">&copy; 2026 Contas_exe</p>
        </section>

        <section className="login-form-panel">
          <div className="login-form-shell animate-pop-in">
            <div className="login-theme-row">
              <ThemeToggle
                value={theme}
                onChange={onThemeChange}
                menuPlacement="down"
              />
            </div>

            <div className="login-heading">
              <div className="login-mobile-brand">
                <div className="login-mobile-mark">
                  <img
                    src="/logo-square.png"
                    alt="Contas_exe"
                    className="h-full w-full object-contain p-1"
                  />
                </div>
                <span>Contas_exe</span>
              </div>
              <h2>
                {step === "password"
                  ? "Entrar na sua conta"
                  : "Verificação em duas etapas"}
              </h2>
              <p>
                {step === "password"
                  ? "Informe seu usuario e senha para continuar."
                  : "Digite o código do seu app autenticador (ou um código de recuperação)."}
              </p>
            </div>

            {step === "totp" ? (
              <form className="login-form" onSubmit={handleTotpSubmit}>
                <div className="space-y-2">
                  <label className="login-label" htmlFor="login-code">
                    Código de verificação
                  </label>
                  <Input
                    autoFocus
                    autoComplete="one-time-code"
                    inputMode="text"
                    className="login-input h-[52px] rounded-lg px-4 text-base tracking-widest"
                    id="login-code"
                    placeholder="000000"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </div>

                {error ? <p className="login-error">{error}</p> : null}

                <Button
                  className="login-submit mt-7 h-[52px] w-full rounded-lg text-base"
                  variant="default"
                  type="submit"
                  disabled={submitting || !code.trim()}
                >
                  {submitting ? (
                    <Spinner className="h-5 w-5" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  {submitting ? "Verificando..." : "Verificar"}
                </Button>

                <button
                  className="mt-3 w-full text-center text-sm text-[color:var(--muted)] underline-offset-4 hover:underline"
                  type="button"
                  onClick={backToPassword}
                >
                  Voltar
                </button>
              </form>
            ) : (
            <form className="login-form" onSubmit={handleSubmit}>
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="login-label" htmlFor="login-user">
                    Usuario
                  </label>
                  <Input
                    autoFocus
                    autoComplete="username"
                    className="login-input h-[52px] rounded-lg px-4 text-base"
                    id="login-user"
                    placeholder="Digite seu usuario"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="login-label" htmlFor="login-password">
                    Senha
                  </label>
                  <div className="relative">
                    <Input
                      autoComplete="current-password"
                      className="login-input h-[52px] rounded-lg px-4 pr-12 text-base"
                      id="login-password"
                      placeholder="Digite sua senha"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      aria-label={
                        showPassword ? "Ocultar senha" : "Mostrar senha"
                      }
                      className="login-password-toggle"
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
              </div>

              {error ? <p className="login-error">{error}</p> : null}

              <Button
                className="login-submit mt-7 h-[52px] w-full rounded-lg text-base"
                variant="default"
                type="submit"
                disabled={submitting}
              >
                {submitting ? (
                  <Spinner className="h-5 w-5" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {submitting ? "Entrando..." : "Entrar"}
              </Button>
            </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
