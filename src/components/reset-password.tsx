import { type FormEvent, useState } from "react";
import { CheckCircle, Eye, EyeOff, KeyRound } from "lucide-react";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { Spinner } from "./ui/spinner";

type ResetPasswordProps = {
  token: string;
  onDone: () => void;
  onThemeChange: (theme: AppTheme) => void;
  theme: AppTheme;
};

const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, label: "Mínimo 8 caracteres" },
  { test: (p: string) => /[A-Z]/.test(p), label: "Uma letra maiúscula" },
  { test: (p: string) => /[a-z]/.test(p), label: "Uma letra minúscula" },
  { test: (p: string) => /[0-9]/.test(p), label: "Um número" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), label: "Um caractere especial" },
];

const ERROR_MESSAGES: Record<string, string> = {
  invalid_or_expired_token: "Link inválido ou expirado. Solicite um novo.",
  password_too_short: "Senha muito curta (mín. 8 caracteres).",
  password_no_uppercase: "Inclua ao menos uma letra maiúscula.",
  password_no_lowercase: "Inclua ao menos uma letra minúscula.",
  password_no_number: "Inclua ao menos um número.",
  password_no_special: "Inclua ao menos um caractere especial.",
  password_too_common: "Senha muito comum. Escolha outra.",
};

export function ResetPassword({ token, onDone, onThemeChange, theme }: ResetPasswordProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const allRulesPass = PASSWORD_RULES.every((r) => r.test(password));

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!allRulesPass) return;
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      if (response.ok) {
        setDone(true);
        // Clean the token from the URL without a page reload.
        window.history.replaceState({}, "", "/");
        return;
      }

      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(ERROR_MESSAGES[data.error ?? ""] ?? "Não foi possível redefinir a senha.");
    } catch {
      setError("Não foi possível conectar ao servidor.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={cn(`theme-${theme}`, "app-shell login-shell min-h-screen")}>
      <div className="login-layout">
        <section className="login-brand-panel">
          <div className="login-brand-content">
            <div className="login-brand-copy">
              <img src="/login-brand-hero.png" alt="" className="login-brand-hero-logo" />
            </div>
          </div>
        </section>

        <section className="login-form-panel">
          <div className="login-form-shell animate-pop-in">
            

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
              <h2>Nova senha</h2>
              {!done && <p>Escolha uma nova senha para sua conta.</p>}
            </div>

            {done ? (
              <div className="space-y-6">
                <div className="flex flex-col items-center gap-3 rounded-lg border border-[color:var(--login-form-text)]/20 p-6 text-center">
                  <CheckCircle className="h-8 w-8 text-green-500" />
                  <p className="font-medium text-[color:var(--login-form-text)]">
                    Senha redefinida com sucesso!
                  </p>
                  <p className="text-sm text-[color:var(--login-form-muted)]">
                    Todas as sessões anteriores foram encerradas por segurança.
                  </p>
                </div>
                <button className="login-btn-animated mt-4" type="button" onClick={onDone}>
                  <KeyRound className="h-4 w-4" />
                  Ir para o login
                </button>
              </div>
            ) : (
              <form className="login-form" onSubmit={handleSubmit}>
                <div className="space-y-5">
                  <div className="animated-field">
                    <input
                      autoFocus
                      autoComplete="new-password"
                      id="reset-password"
                      required
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <label htmlFor="reset-password">
                      {"Nova senha".split("").map((char, i) => (
                        <span key={i} style={{ transitionDelay: `${i * 50}ms` }}>{char}</span>
                      ))}
                    </label>
                    <button
                      aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                      className="animated-field-toggle"
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {password && (
                    <ul className="space-y-1">
                      {PASSWORD_RULES.map((rule) => (
                        <li
                          key={rule.label}
                          className={cn(
                            "flex items-center gap-2 text-xs",
                            rule.test(password)
                              ? "text-green-500"
                              : "text-[color:var(--login-form-muted)]",
                          )}
                        >
                          <span className="text-[10px]">{rule.test(password) ? "✓" : "○"}</span>
                          {rule.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {error ? <p className="login-error">{error}</p> : null}

                <button
                  className="login-btn-animated mt-12"
                  type="submit"
                  disabled={submitting || !allRulesPass}
                >
                  {submitting ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                  {submitting ? "Salvando..." : "Redefinir senha"}
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
