import { type FormEvent, useState } from "react";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";
import { FormAlert } from "./ui/form-alert";
import { PasswordStrengthMeter } from "./ui/password-tools";
import { Spinner } from "./ui/spinner";
import { LangTerminal } from "./lang-terminal";

type RegisterProps = {
  onBack: () => void;
  onDone: (username: string) => void;
  theme: AppTheme;
};

export function Register({ onBack, onDone, theme }: RegisterProps) {
  const { t } = useTranslation();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const ERROR_MAP: Record<string, { title: string; message: string }> = {
    username_taken:        { title: t("register.error_username_taken_title"),        message: t("register.error_username_taken") },
    email_taken:           { title: t("register.error_email_taken_title"),           message: t("register.error_email_taken") },
    username_too_short:    { title: t("register.error_username_too_short_title"),    message: t("register.error_username_too_short") },
    username_too_long:     { title: t("register.error_username_too_long_title"),     message: t("register.error_username_too_long") },
    password_too_short:    { title: t("register.error_password_too_short_title"),    message: t("register.error_password_too_short") },
    password_no_uppercase: { title: t("register.error_password_no_uppercase_title"), message: t("register.error_password_no_uppercase") },
    password_no_lowercase: { title: t("register.error_password_no_lowercase_title"), message: t("register.error_password_no_lowercase") },
    password_no_number:    { title: t("register.error_password_no_number_title"),    message: t("register.error_password_no_number") },
    password_no_special:   { title: t("register.error_password_no_special_title"),   message: t("register.error_password_no_special") },
    password_too_common:   { title: t("register.error_password_too_common_title"),   message: t("register.error_password_too_common") },
    forbidden:             { title: t("register.error_forbidden_title"),             message: t("register.error_forbidden") },
    register_failed:       { title: t("register.error_generic_title"),               message: t("register.error_generic") },
    too_many_attempts:     { title: t("register.error_too_many_attempts_title"),     message: t("register.error_too_many_attempts") },
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError({ title: t("register.error_passwords_mismatch_title"), message: t("register.error_passwords_mismatch") });
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          fullName: fullName.trim(),
          email: email.trim(),
          password,
        }),
      });

      if (response.ok) {
        onDone(username.trim());
        return;
      }

      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(ERROR_MAP[data.error ?? ""] ?? { title: t("register.error_generic_title"), message: t("register.error_generic") });
    } catch {
      setError({ title: t("register.error_no_connection_title"), message: t("register.error_no_connection") });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={cn(`theme-${theme}`, "app-shell login-shell min-h-[100dvh]")}>
      <div className="login-layout">
        <section className="login-form-panel">
          <LangTerminal />
          <div className="login-form-shell animate-pop-in">
            <div className="login-heading">
              <div className="login-mobile-brand">
                <div className="login-mobile-mark">
                  <img src="/logo-square.png" alt="Contas_exe" className="h-full w-full object-contain p-1" />
                </div>
                <span>Contas_exe</span>
              </div>
              <h2>{t("register.title")}</h2>
            </div>

            <form className="login-form" onSubmit={handleSubmit}>
              <div className="flex flex-col [&_.animated-field]:mb-0 gap-4">
                <div className="animated-field">
                  <input
                    autoFocus
                    autoComplete="name"
                    id="reg-fullname"
                    required
                    minLength={2}
                    maxLength={120}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                  <label htmlFor="reg-fullname">
                    {t("register.full_name").split("").map((char, i) => (
                      <span key={i} style={{ transitionDelay: `${i * 40}ms` }}>{char}</span>
                    ))}
                  </label>
                </div>

                <div className="animated-field">
                  <input
                    autoComplete="email"
                    id="reg-email"
                    required
                    type="email"
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <label htmlFor="reg-email">
                    {t("register.email").split("").map((char, i) => (
                      <span key={i} style={{ transitionDelay: `${i * 50}ms` }}>{char}</span>
                    ))}
                  </label>
                </div>

                <div className="animated-field">
                  <input
                    autoComplete="username"
                    id="reg-username"
                    required
                    minLength={2}
                    maxLength={80}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                  <label htmlFor="reg-username">
                    {t("register.username").split("").map((char, i) => (
                      <span key={i} style={{ transitionDelay: `${i * 50}ms` }}>{char}</span>
                    ))}
                  </label>
                </div>

                <div className="animated-field">
                  <input
                    autoComplete="new-password"
                    id="reg-password"
                    required
                    minLength={8}
                    maxLength={128}
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <label htmlFor="reg-password">
                    {t("register.password").split("").map((char, i) => (
                      <span key={i} style={{ transitionDelay: `${i * 50}ms` }}>{char}</span>
                    ))}
                  </label>
                  <button
                    aria-label={showPassword ? t("register.hide_password") : t("register.show_password")}
                    className="animated-field-toggle"
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                {password && <PasswordStrengthMeter password={password} />}

                <div className="animated-field">
                  <input
                    autoComplete="new-password"
                    id="reg-confirm"
                    required
                    minLength={8}
                    maxLength={128}
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <label htmlFor="reg-confirm">
                    {t("register.confirm_password").split("").map((char, i) => (
                      <span key={i} style={{ transitionDelay: `${i * 30}ms` }}>{char}</span>
                    ))}
                  </label>
                  <button
                    aria-label={showConfirm ? t("register.hide_password") : t("register.show_password")}
                    className="animated-field-toggle"
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && <FormAlert variant="error" title={error.title} message={error.message} />}

              <button className="login-btn-animated mt-8" type="submit" disabled={submitting}>
                {submitting ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {submitting ? t("register.submitting") : t("register.submit")}
              </button>

              <button
                className="mt-4 w-full text-center text-sm text-[color:var(--login-form-muted)] underline-offset-4 hover:underline"
                type="button"
                onClick={onBack}
              >
                {t("register.already_have_account")}
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
