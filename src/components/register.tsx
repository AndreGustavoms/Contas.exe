import { type FormEvent, useState } from "react";
import { Eye, EyeOff, UserPlus } from "lucide-react";
import { type AppTheme } from "../theme";
import { cn } from "../lib/utils";
import { FormAlert } from "./ui/form-alert";
import { Spinner } from "./ui/spinner";

type RegisterProps = {
  onBack: () => void;
  onDone: (username: string) => void;
  theme: AppTheme;
};

const ERROR_MAP: Record<string, { title: string; message: string }> = {
  username_taken:      { title: "Nome já em uso",       message: "Escolha outro nome de usuário." },
  email_taken:         { title: "E-mail já cadastrado", message: "Este e-mail já possui uma conta." },
  username_too_short:  { title: "Nome muito curto",     message: "Mínimo de 2 caracteres." },
  username_too_long:   { title: "Nome muito longo",     message: "Máximo de 80 caracteres." },
  password_too_short:  { title: "Senha fraca",          message: "Mínimo de 8 caracteres." },
  password_no_uppercase: { title: "Senha fraca",        message: "Inclua ao menos uma letra maiúscula." },
  password_no_lowercase: { title: "Senha fraca",        message: "Inclua ao menos uma letra minúscula." },
  password_no_number:  { title: "Senha fraca",          message: "Inclua ao menos um número." },
  password_no_special: { title: "Senha fraca",          message: "Inclua ao menos um caractere especial." },
  password_too_common: { title: "Senha muito comum",    message: "Escolha uma senha mais segura." },
  forbidden:           { title: "Sem permissão",        message: "Apenas administradores podem criar contas." },
  register_failed:     { title: "Erro ao criar conta",  message: "Não foi possível criar a conta. Tente novamente." },
  too_many_attempts:   { title: "Muitas tentativas",    message: "Aguarde alguns minutos e tente novamente." },
};

export function Register({ onBack, onDone, theme }: RegisterProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError({ title: "Senhas diferentes", message: "As senhas digitadas não coincidem." });
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
      setError(ERROR_MAP[data.error ?? ""] ?? { title: "Erro ao criar conta", message: "Não foi possível criar a conta. Tente novamente." });
    } catch {
      setError({ title: "Sem conexão", message: "Não foi possível conectar ao servidor." });
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
                  <img src="/logo-square.png" alt="Contas_exe" className="h-full w-full object-contain p-1" />
                </div>
                <span>Contas_exe</span>
              </div>
              <h2>Criar conta</h2>
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
                    {"Nome completo".split("").map((char, i) => (
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
                    {"E-mail".split("").map((char, i) => (
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
                    {"Usuário".split("").map((char, i) => (
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
                    {"Senha".split("").map((char, i) => (
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
                    {"Confirmar senha".split("").map((char, i) => (
                      <span key={i} style={{ transitionDelay: `${i * 30}ms` }}>{char}</span>
                    ))}
                  </label>
                  <button
                    aria-label={showConfirm ? "Ocultar senha" : "Mostrar senha"}
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
                {submitting ? "Criando..." : "Criar conta"}
              </button>

              <button
                className="mt-4 w-full text-center text-sm text-[color:var(--login-form-muted)] underline-offset-4 hover:underline"
                type="button"
                onClick={onBack}
              >
                Já tenho conta
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
