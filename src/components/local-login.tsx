import { type FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff, LogIn, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type SessionUser } from "../App";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { LangTerminal } from "./lang-terminal";

type LocalLoginProps = {
  onForgotPassword: () => void;
  onRegister: () => void;
  onUnlock: (user: SessionUser) => void;
  theme: AppTheme;
};

export function LocalLogin({
  onForgotPassword,
  onRegister,
  onUnlock,
  theme,
}: LocalLoginProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    name?: string;
    password?: string;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"password" | "totp">("password");
  const [code, setCode] = useState("");
  const [oauthProviders, setOauthProviders] = useState({
    google: false,
    github: false,
  });

  useEffect(() => {
    let active = true;

    fetch("/api/auth/providers")
      .then((response) => (response.ok ? response.json() : { google: false }))
      .then((data: { google?: boolean; github?: boolean }) => {
        if (active) {
          setOauthProviders({
            google: Boolean(data.google),
            github: Boolean(data.github),
          });
        }
      })
      .catch(() => {
        if (active) {
          setOauthProviders({ google: false, github: false });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth");

    const errorMap: Record<string, string> = {
      google_error: t("login.error_google"),
      google_email_exists: t("login.error_google_email_exists"),
      github_error: t("login.error_github"),
      github_email_exists: t("login.error_github_email_exists"),
    };

    if (!(authError && authError in errorMap)) return;

    setError(errorMap[authError]);
    params.delete("auth");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, [t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: { name?: string; password?: string } = {};
    if (!name.trim()) errors.name = t("login.error_field_required");
    if (!password) errors.password = t("login.error_field_required");
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
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
          setStep("totp");
          return;
        }
        onUnlock(data.user ?? { username: name.trim(), role: "member" });
        return;
      }

      setError(
        response.status === 401
          ? t("login.error_invalid_credentials")
          : t("login.error_failed"),
      );
    } catch {
      setError(t("login.error_no_connection"));
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
        body: JSON.stringify({
          name: name.trim(),
          password,
          code: code.trim(),
        }),
      });

      if (response.ok) {
        const data: { user?: SessionUser } = await response.json();
        onUnlock(data.user ?? { username: name.trim(), role: "member" });
        return;
      }

      setError(
        response.status === 401
          ? t("login.error_invalid_code")
          : response.status === 429
            ? t("login.error_too_many_attempts")
            : t("login.error_failed"),
      );
    } catch {
      setError(t("login.error_no_connection"));
    } finally {
      setSubmitting(false);
    }
  }

  function backToPassword() {
    setStep("password");
    setCode("");
    setError("");
  }

  function startGoogleLogin() {
    window.location.assign("/api/auth/google");
  }

  function startGithubLogin() {
    window.location.assign("/api/auth/github");
  }

  return (
    <main
      className={cn(`theme-${theme}`, "app-shell login-shell min-h-[100dvh]")}
    >
      <div className="login-layout">
        <section className="login-form-panel">
          <LangTerminal />

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

              {step === "password" && (
                <div className="login-brand-circle">
                  <svg
                    viewBox="0 0 200 200"
                    className="login-brand-circle-svg"
                    aria-hidden="true"
                  >
                    <defs>
                      <path
                        id="circleArc"
                        d="M 100,20 A 80,80 0 0,1 180,100 A 80,80 0 0,1 100,180 A 80,80 0 0,1 20,100 A 80,80 0 0,1 100,20 Z"
                      />
                    </defs>
                    <text className="login-brand-circle-text">
                      <textPath
                        href="#circleArc"
                        startOffset="0%"
                        textLength="503"
                        lengthAdjust="spacing"
                        dy="-5"
                      >
                        CONTAS_EXE · CONTAS_EXE · CONTAS_EXE · CONTAS_EXE ·
                      </textPath>
                    </text>
                  </svg>
                  <img
                    src="/logo-square.png"
                    alt="Contas_exe"
                    className="login-brand-logo"
                  />
                </div>
              )}
              {step === "totp" && <h2>{t("login.two_factor_title")}</h2>}
              {step === "totp" && <p>{t("login.two_factor_instruction")}</p>}
            </div>

            {step === "totp" ? (
              <form className="login-form" onSubmit={handleTotpSubmit}>
                <div className="space-y-2">
                  <label className="login-label" htmlFor="login-code">
                    {t("login.verification_code")}
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
                  {submitting ? t("login.verifying") : t("login.verify")}
                </Button>

                <button
                  className="mt-3 w-full text-center text-sm text-[color:var(--muted)] underline-offset-4 hover:underline"
                  type="button"
                  onClick={backToPassword}
                >
                  {t("login.back")}
                </button>
              </form>
            ) : (
              <form className="login-form" noValidate onSubmit={handleSubmit}>
                <div className="animated-field">
                  <input
                    autoFocus
                    autoComplete="username"
                    id="login-user"
                    required
                    maxLength={80}
                    value={name}
                    onFocus={() => setError("")}
                    onChange={(event) => {
                      setName(event.target.value);
                      setFieldErrors((e) => ({ ...e, name: undefined }));
                    }}
                  />
                  <label htmlFor="login-user">
                    {t("login.username")
                      .split("")
                      .map((char, i) => (
                        <span
                          key={i}
                          style={{ transitionDelay: `${i * 50}ms` }}
                        >
                          {char}
                        </span>
                      ))}
                  </label>
                  {fieldErrors.name && (
                    <p className="login-field-error">{fieldErrors.name}</p>
                  )}
                </div>

                <div className="animated-field" style={{ marginBottom: 0 }}>
                  <input
                    autoComplete="off"
                    id="login-password"
                    name="cx_secret"
                    required
                    maxLength={128}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onFocus={() => setError("")}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setFieldErrors((e) => ({ ...e, password: undefined }));
                    }}
                  />
                  <label htmlFor="login-password">
                    {t("login.password")
                      .split("")
                      .map((char, i) => (
                        <span
                          key={i}
                          style={{ transitionDelay: `${i * 50}ms` }}
                        >
                          {char}
                        </span>
                      ))}
                  </label>
                  <button
                    aria-label={
                      showPassword
                        ? t("login.hide_password")
                        : t("login.show_password")
                    }
                    className="animated-field-toggle"
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                  {fieldErrors.password && (
                    <p className="login-field-error">{fieldErrors.password}</p>
                  )}
                </div>

                <div className="flex justify-end mt-2 mb-6">
                  <button
                    className="text-xs text-[color:var(--login-form-muted)] underline-offset-4 hover:underline"
                    type="button"
                    onClick={onForgotPassword}
                  >
                    {t("login.forgot_password")}
                  </button>
                </div>

                {error ? <p className="login-error">{error}</p> : null}

                <button
                  className="login-btn-primary mt-4"
                  type="submit"
                  disabled={submitting}
                >
                  {submitting ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <LogIn className="h-4 w-4" />
                  )}
                  {submitting ? t("login.entering") : t("login.enter")}
                </button>

                <button
                  className="login-btn-ghost mt-4 mx-auto"
                  type="button"
                  onClick={onRegister}
                >
                  <UserPlus className="h-4 w-4" />
                  {t("login.create_account")}
                </button>

                <div className="login-divider" style={{ marginTop: "1.5rem" }}>
                  <span />
                  <span>{t("login.or")}</span>
                  <span />
                </div>

                <div className="login-oauth-group">
                  <button
                    className="login-oauth-btn"
                    type="button"
                    disabled={!oauthProviders.google || submitting}
                    title={
                      oauthProviders.google
                        ? undefined
                        : t("login.google_not_configured")
                    }
                    onClick={startGoogleLogin}
                  >
                    <svg className="login-oauth-icon" viewBox="0 0 24 24">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                    {t("login.continue_google")}
                  </button>

                  <button
                    className="login-oauth-btn"
                    type="button"
                    disabled={!oauthProviders.github || submitting}
                    title={
                      oauthProviders.github
                        ? undefined
                        : t("login.github_not_configured")
                    }
                    onClick={startGithubLogin}
                  >
                    <svg className="login-oauth-icon" viewBox="0 0 24 24">
                      <path
                        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                        fill="currentColor"
                      />
                    </svg>
                    {t("login.continue_github")}
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
