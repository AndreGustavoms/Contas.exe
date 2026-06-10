import { type FormEvent, useState } from "react";
import { ArrowLeft, Globe, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";
import { LANGUAGES, type LangCode } from "../i18n";
import { ThemeToggle } from "./theme-toggle";
import { Spinner } from "./ui/spinner";

type ForgotPasswordProps = {
  onBack: () => void;
  onThemeChange: (theme: AppTheme) => void;
  theme: AppTheme;
};

function LangTerminal() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const currentLang = i18n.language as LangCode;
  const activeLang = LANGUAGES.find((l) => l.code === currentLang) ?? LANGUAGES[0];

  return (
    <div className={cn("login-terminal", !open && "login-terminal--collapsed")}>
      <div
        className="login-terminal-header"
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((v) => !v)}
      >
        <span className="login-terminal-title">
          <Globe width={13} height={13} />
          {open ? "lang" : <span className="login-terminal-active-code">{activeLang.flag} {activeLang.code.toUpperCase()}</span>}
        </span>
        <div className="login-terminal-controls">
          <span className="login-terminal-dot login-terminal-dot--close" />
          <span className="login-terminal-dot login-terminal-dot--min" />
          <span className="login-terminal-dot login-terminal-dot--max" />
        </div>
      </div>
      <div className="login-terminal-body">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            className={cn(
              "login-terminal-lang",
              currentLang === lang.code && "login-terminal-lang--active",
            )}
            type="button"
            onClick={() => { i18n.changeLanguage(lang.code); setOpen(false); }}
          >
            <span>{lang.flag}</span>
            <span>{lang.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ForgotPassword({ onBack, onThemeChange, theme }: ForgotPasswordProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setDone(true);
    } catch {
      setError(t("login.error_no_connection"));
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
          <LangTerminal />

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
              <h2>{t("login.forgot_password")}</h2>
              {!done && <p>{t("login.forgot_instruction")}</p>}
            </div>

            {done ? (
              <div className="space-y-6">
                <div className="flex flex-col items-center gap-3 rounded-lg border border-[color:var(--login-form-text)]/20 p-6 text-center">
                  <Mail className="h-8 w-8 text-[color:var(--login-form-text)]/60" />
                  <p className="text-sm text-[color:var(--login-form-muted)]">
                    {t("login.forgot_sent")}
                  </p>
                </div>
                <button
                  className="mt-2 flex w-full items-center justify-center gap-2 text-sm text-[color:var(--login-form-muted)] underline-offset-4 hover:underline"
                  type="button"
                  onClick={onBack}
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t("login.back_to_login")}
                </button>
              </div>
            ) : (
              <form className="login-form" onSubmit={handleSubmit}>
                <div className="space-y-5">
                  <div className="animated-field">
                    <input
                      autoFocus
                      autoComplete="email"
                      id="forgot-email"
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <label htmlFor="forgot-email">
                      {t("login.email_label").split("").map((char, i) => (
                        <span key={i} style={{ transitionDelay: `${i * 50}ms` }}>{char}</span>
                      ))}
                    </label>
                  </div>
                </div>

                {error ? <p className="login-error">{error}</p> : null}

                <button
                  className="login-btn-animated mt-12"
                  type="submit"
                  disabled={submitting || !email.trim()}
                >
                  {submitting ? <Spinner className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                  {submitting ? t("login.forgot_sending") : t("login.forgot_send")}
                </button>

                <button
                  className="mt-3 flex w-full items-center justify-center gap-2 text-sm text-[color:var(--login-form-muted)] underline-offset-4 hover:underline"
                  type="button"
                  onClick={onBack}
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t("login.back")}
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
