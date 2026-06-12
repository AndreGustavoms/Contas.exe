import { type FormEvent, useState } from "react";
import { CheckCircle, Eye, EyeOff, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";
import { PasswordStrengthMeter } from "./ui/password-tools";
import { Spinner } from "./ui/spinner";

type ResetPasswordProps = {
  token: string;
  onDone: () => void;
  theme: AppTheme;
};

const PASSWORD_RULES = [
  { test: (p: string) => p.length >= 8, labelKey: "reset.rule_min" },
  { test: (p: string) => /[A-Z]/.test(p), labelKey: "reset.rule_upper" },
  { test: (p: string) => /[a-z]/.test(p), labelKey: "reset.rule_lower" },
  { test: (p: string) => /[0-9]/.test(p), labelKey: "reset.rule_number" },
  { test: (p: string) => /[^A-Za-z0-9]/.test(p), labelKey: "reset.rule_special" },
];

// Códigos de erro do servidor -> chaves i18n (as regras de senha reutilizam as
// mensagens já traduzidas do cadastro).
const ERROR_I18N_KEYS: Record<string, string> = {
  invalid_or_expired_token: "reset.error_invalid_token",
  password_too_short: "register.error_password_too_short",
  password_no_uppercase: "register.error_password_no_uppercase",
  password_no_lowercase: "register.error_password_no_lowercase",
  password_no_number: "register.error_password_no_number",
  password_no_special: "register.error_password_no_special",
  password_too_common: "register.error_password_too_common",
  too_many_attempts: "register.error_too_many_attempts",
};

export function ResetPassword({ token, onDone, theme }: ResetPasswordProps) {
  const { t } = useTranslation();
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
      const key = ERROR_I18N_KEYS[data.error ?? ""];
      setError(key ? t(key) : t("reset.error_generic"));
    } catch {
      setError(t("login.error_no_connection"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={cn(`theme-${theme}`, "app-shell login-shell min-h-[100dvh]")}>
      <div className="login-layout">
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
              <h2>{t("reset.title")}</h2>
              {!done && <p>{t("reset.subtitle")}</p>}
            </div>

            {done ? (
              <div className="space-y-6">
                <div className="flex flex-col items-center gap-3 rounded-lg border border-[color:var(--login-form-text)]/20 p-6 text-center">
                  <CheckCircle className="h-8 w-8 text-green-500" />
                  <p className="font-medium text-[color:var(--login-form-text)]">
                    {t("reset.success_title")}
                  </p>
                  <p className="text-sm text-[color:var(--login-form-muted)]">
                    {t("reset.success_sessions")}
                  </p>
                </div>
                <button className="login-btn-animated mt-4" type="button" onClick={onDone}>
                  <KeyRound className="h-4 w-4" />
                  {t("reset.go_login")}
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
                      {t("reset.password_label").split("").map((char, i) => (
                        <span key={i} style={{ transitionDelay: `${i * 50}ms` }}>{char}</span>
                      ))}
                    </label>
                    <button
                      aria-label={showPassword ? t("login.hide_password") : t("login.show_password")}
                      className="animated-field-toggle"
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>

                  {password && <PasswordStrengthMeter password={password} />}

                  {password && (
                    <ul className="space-y-1">
                      {PASSWORD_RULES.map((rule) => (
                        <li
                          key={rule.labelKey}
                          className={cn(
                            "flex items-center gap-2 text-xs",
                            rule.test(password)
                              ? "text-green-500"
                              : "text-[color:var(--login-form-muted)]",
                          )}
                        >
                          <span className="text-[10px]">{rule.test(password) ? "✓" : "○"}</span>
                          {t(rule.labelKey)}
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
                  {submitting ? t("reset.saving") : t("reset.submit")}
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
