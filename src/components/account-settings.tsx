import { type FormEvent, useEffect, useState } from "react";
import { Copy, KeyRound, ShieldCheck, ShieldOff, X } from "lucide-react";
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
      setError("Não foi possível carregar o status do 2FA.");
    }
  }

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (!isReauthCancelled(err)) setError("Não foi possível iniciar a configuração.");
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
          ? "Código inválido. Confira no app e tente de novo."
          : "Não foi possível ativar o 2FA.",
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
          ? "Código inválido."
          : "Não foi possível desativar o 2FA.",
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
      if (!isReauthCancelled(err)) setError("Não foi possível gerar novos códigos.");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
      <button
        aria-label="Fechar"
        className="absolute inset-0 bg-[color:var(--overlay)] backdrop-blur-md"
        type="button"
        onClick={onClose}
      />
      <section
        aria-modal="true"
        className="app-panel animate-pop-in relative w-full max-w-lg overflow-hidden rounded-[28px] border p-5 backdrop-blur-2xl sm:p-6"
        role="dialog"
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-5 w-5 text-[color:var(--accent)]" />
            <h2 className="text-xl font-semibold tracking-normal text-[color:var(--text)]">
              Minha conta
            </h2>
          </div>
          <Button aria-label="Fechar" size="icon" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <h3 className="mt-5 text-sm font-semibold uppercase tracking-[0.16em] text-[color:var(--accent-muted)]">
          Verificação em duas etapas (2FA)
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
              Salve seus códigos de recuperação
            </p>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Eles aparecem só agora. Cada um serve uma vez, caso você perca o app.
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
              Já salvei
            </Button>
          </div>
        ) : null}

        {/* Setup in progress: show the key to add to the authenticator app. */}
        {setup ? (
          <form className="mt-4 grid gap-3" onSubmit={confirmEnable}>
            <p className="text-sm text-[color:var(--muted)]">
              Adicione esta chave no seu app autenticador (Google Authenticator,
              Authy…) usando "inserir chave manualmente":
            </p>
            <div className="flex items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-sm text-[color:var(--text)]">
                {setup.secret}
              </code>
              <button
                aria-label="Copiar chave"
                className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
                type="button"
                onClick={copySecret}
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            {copied ? (
              <p className="text-xs text-[color:var(--accent)]">Chave copiada.</p>
            ) : null}
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[color:var(--muted)]">
                Digite o código gerado pelo app para confirmar
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
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="neon"
                disabled={busy || !enableCode.trim()}
              >
                {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                Ativar
              </Button>
            </div>
          </form>
        ) : disabling ? (
          <form className="mt-4 grid gap-3" onSubmit={confirmDisable}>
            <p className="text-sm text-[color:var(--muted)]">
              Digite um código do app (ou um código de recuperação) para desativar.
            </p>
            <Input
              autoFocus
              className="h-11 rounded-2xl px-4 tracking-widest"
              placeholder="Código"
              value={disableCode}
              onChange={(event) => setDisableCode(event.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDisabling(false)}
              >
                Cancelar
              </Button>
              <button
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-red-500 px-4 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-50"
                type="submit"
                disabled={busy || !disableCode.trim()}
              >
                <ShieldOff className="h-4 w-4" />
                Desativar
              </button>
            </div>
          </form>
        ) : (
          // Idle: show status + the primary action.
          <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--field)] p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[color:var(--text)]">
                {status?.enabled ? "Ativado" : "Desativado"}
              </p>
              <p className="text-xs text-[color:var(--muted)]">
                {status?.enabled
                  ? `Pedimos um código a cada login. ${status.recoveryCodesRemaining} código(s) de recuperação restante(s).`
                  : "Proteja seu login com um app autenticador."}
              </p>
            </div>
            {status?.enabled ? (
              <div className="flex shrink-0 flex-col gap-2">
                <Button variant="outline" disabled={busy} onClick={regenerate}>
                  <KeyRound className="h-4 w-4" />
                  Novos códigos
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setDisabling(true)}
                >
                  <ShieldOff className="h-4 w-4" />
                  Desativar
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
                Ativar 2FA
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
