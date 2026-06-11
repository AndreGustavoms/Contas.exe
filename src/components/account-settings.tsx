import { type FormEvent, useEffect, useState } from "react";
import { Copy, KeyRound, Mail, ShieldCheck, ShieldOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";

// "Minha conta": per-user account settings. This release focuses on the
// Security / 2FA section (TOTP, Riot-style: scan/enter the key, confirm a code to
// enable, save one-time recovery codes). Every state-changing call goes through
// `withReauth` (the parent owns the re-auth modal), so the server's
// reauth_required is handled transparently.

type AccountSettingsProps = {
  onClose: () => void;
  // Runs an action, handling the re-auth prompt+retry centrally (parent vault).
  withReauth: <T>(action: () => Promise<T>) => Promise<T>;
};

const API = "/api/account/2fa";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${response.status}`);
  }
  return response.json() as Promise<T>;
}

function isReauthCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === "reauth_required";
}

type Status = { enabled: boolean; recoveryCodesRemaining: number };

export function AccountSettings({ onClose, withReauth }: AccountSettingsProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Setup flow state.
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [enableCode, setEnableCode] = useState("");
  // Recovery codes shown ONCE right after enabling / regenerating.
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  // Disable flow.
  const [disabling, setDisabling] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [copied, setCopied] = useState(false);

  // Recovery e-mail state.
  const [email, setEmail] = useState("");
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState(false);
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function loadStatus() {
    try {
      setStatus(await requestJson<Status>(API));
    } catch {
      setError(t("account.error_load_status"));
    }
  }

  useEffect(() => {
    void loadStatus();
    // Load current e-mail.
    fetch("/api/account/email")
      .then((r) => (r.ok ? r.json() : { email: null }))
      .then((d: { email: string | null }) => {
        setEmail(d.email ?? "");
        setEmailLoaded(true);
      })
      .catch(() => setEmailLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailSaving(true);
    setEmailError("");
    setEmailSuccess(false);
    try {
      await requestJson("/api/account/email", {
        method: "PUT",
        body: JSON.stringify({ email: email.trim() }),
      });
      setEmailSuccess(true);
      window.setTimeout(() => setEmailSuccess(false), 2500);
    } catch (err) {
      setEmailError(
        err instanceof Error && err.message === "invalid_email"
          ? "E-mail inválido."
          : "Não foi possível salvar.",
      );
    } finally {
      setEmailSaving(false);
    }
  }

  async function beginSetup() {
    setError("");
    setBusy(true);
    try {
      const result = await withReauth(() =>
        requestJson<{ secret: string; otpauthUri: string }>(`${API}/setup`, {
          method: "POST",
        }),
      );
      setSetup(result);
      setFreshCodes(null);
      setEnableCode("");
    } catch (err) {
      if (!isReauthCancelled(err)) setError(t("account.error_start_setup"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await withReauth(() =>
        requestJson<{ recoveryCodes: string[] }>(`${API}/enable`, {
          method: "POST",
          body: JSON.stringify({ code: enableCode.trim() }),
        }),
      );
      setFreshCodes(result.recoveryCodes);
      setSetup(null);
      setEnableCode("");
      await loadStatus();
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setError(
        err instanceof Error && err.message === "invalid_code"
          ? t("account.error_invalid_code")
          : t("account.error_enable"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await withReauth(() =>
        requestJson(`${API}/disable`, {
          method: "POST",
          body: JSON.stringify({ code: disableCode.trim() }),
        }),
      );
      setDisabling(false);
      setDisableCode("");
      setFreshCodes(null);
      await loadStatus();
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setError(
        err instanceof Error && err.message === "invalid_code"
          ? t("account.error_invalid_code")
          : t("account.error_disable"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setError("");
    setBusy(true);
    try {
      const result = await withReauth(() =>
        requestJson<{ recoveryCodes: string[] }>(`${API}/recovery-codes`, {
          method: "POST",
        }),
      );
      setFreshCodes(result.recoveryCodes);
      await loadStatus();
    } catch (err) {
      if (!isReauthCancelled(err)) setError(t("account.error_new_codes"));
    } finally {
      setBusy(false);
    }
  }

  function copySecret() {
    if (!setup) return;
    void navigator.clipboard.writeText(setup.secret).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    // Wrapper rolável + m-auto: o modal centraliza quando cabe e rola desde o
    // topo quando é mais alto que a tela (items-center cortava o início).
    <div className="fixed inset-0 z-50 flex overflow-y-auto overscroll-contain px-4 py-6">
      <button
        aria-label="Fechar"
        className="fixed inset-0 bg-[color:var(--overlay)] backdrop-blur-md"
        type="button"
        onClick={onClose}
      />
      <section
        aria-modal="true"
        className="app-panel animate-pop-in relative m-auto w-full max-w-lg overflow-hidden rounded-[28px] border p-5 backdrop-blur-2xl sm:p-6"
        role="dialog"
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-[color:var(--accent)]" />
            <h2 className="text-xl font-semibold tracking-normal text-[color:var(--text)]">
              {t("account.title")}
            </h2>
          </div>
          <Button aria-label={t("account.close")} size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <h3 className="mt-5 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-muted)]">
          E-mail de recuperação
        </h3>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Usado para redefinir sua senha caso esqueça.
        </p>
        {emailLoaded && (
          <form className="mt-3 flex gap-2" onSubmit={saveEmail}>
            <Input
              type="email"
              autoComplete="email"
              className="h-10 min-w-0 flex-1 rounded-xl px-3"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={emailSaving}
              className="h-10 shrink-0"
            >
              {emailSaving ? <Spinner className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
              Salvar
            </Button>
          </form>
        )}
        {emailSuccess && (
          <p className="mt-1 text-xs text-green-400">E-mail salvo.</p>
        )}
        {emailError && (
          <p className="mt-1 text-xs text-red-300">{emailError}</p>
        )}

        <h3 className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-muted)]">
          {t("account.two_factor")}
        </h3>

        {error ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        {/* Fresh recovery codes — shown once, right after enable/regenerate. */}
        {freshCodes ? (
          <div className="mt-4 rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--field)] p-4">
            <p className="text-sm font-semibold text-[color:var(--text)]">
              {t("account.two_factor_save_codes_title")}
            </p>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              {t("account.two_factor_save_codes_instruction")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm text-[color:var(--text)]">
              {freshCodes.map((c) => (
                <span
                  key={c}
                  className="rounded-lg bg-[color:var(--surface-soft)] px-2.5 py-1.5 text-center"
                >
                  {c}
                </span>
              ))}
            </div>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => setFreshCodes(null)}
            >
              {t("account.two_factor_saved")}
            </Button>
          </div>
        ) : null}

        {/* Setup in progress: show the key to add to the authenticator app. */}
        {setup ? (
          <form className="mt-4 grid gap-3" onSubmit={confirmEnable}>
            <p className="text-sm text-[color:var(--muted)]">
              {t("account.two_factor_manual_key")}
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-sm text-[color:var(--text)]">
                {setup.secret}
              </code>
              <button
                aria-label={t("account.two_factor_copy_key")}
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
                type="button"
                onClick={copySecret}
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {copied ? (
              <p className="text-xs text-[color:var(--accent)]">{t("account.two_factor_key_copied")}</p>
            ) : null}
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[color:var(--muted)]">
                {t("account.two_factor_confirm_label")}
              </span>
              <Input
                autoFocus
                inputMode="numeric"
                className="h-11 rounded-2xl px-4 tracking-widest"
                placeholder="000000"
                value={enableCode}
                onChange={(event) => setEnableCode(event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSetup(null)}
              >
                {t("account.two_factor_cancel")}
              </Button>
              <Button
                type="submit"
                variant="neon"
                disabled={busy || !enableCode.trim()}
              >
                {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                {t("account.two_factor_activate")}
              </Button>
            </div>
          </form>
        ) : disabling ? (
          <form className="mt-4 grid gap-3" onSubmit={confirmDisable}>
            <p className="text-sm text-[color:var(--muted)]">
              {t("account.two_factor_disable_instruction")}
            </p>
            <Input
              autoFocus
              className="h-11 rounded-2xl px-4 tracking-widest"
              placeholder={t("account.two_factor_code")}
              value={disableCode}
              onChange={(event) => setDisableCode(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDisabling(false)}
              >
                {t("account.two_factor_cancel")}
              </Button>
              <button
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-red-500 px-4 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
                type="submit"
                disabled={busy || !disableCode.trim()}
              >
                <ShieldOff className="h-4 w-4" />
                {t("account.two_factor_disable")}
              </button>
            </div>
          </form>
        ) : (
          // Idle: show status + the primary action.
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--field)] p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[color:var(--text)]">
                {status?.enabled ? t("account.two_factor_enabled") : t("account.two_factor_disabled")}
              </p>
              <p className="text-xs text-[color:var(--muted)]">
                {status?.enabled
                  ? t("account.two_factor_description", { count: status.recoveryCodesRemaining })
                  : t("account.two_factor_cta")}
              </p>
            </div>
            {status?.enabled ? (
              <div className="flex shrink-0 flex-col gap-2">
                <Button variant="outline" disabled={busy} onClick={regenerate}>
                  <KeyRound className="h-4 w-4" />
                  {t("account.two_factor_new_codes")}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDisabling(true)}
                >
                  <ShieldOff className="h-4 w-4" />
                  {t("account.two_factor_disable")}
                </Button>
              </div>
            ) : (
              <Button
                className="shrink-0"
                variant="neon"
                disabled={busy}
                onClick={beginSetup}
              >
                {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                {t("account.two_factor_enable")}
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
