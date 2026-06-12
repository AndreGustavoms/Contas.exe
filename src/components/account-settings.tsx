import { type FormEvent, useEffect, useState } from "react";
import {
  Copy,
  Download,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  Monitor,
  Settings,
  ShieldCheck,
  ShieldOff,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  GeneratePasswordButton,
  PasswordStrengthMeter,
} from "./ui/password-tools";
import { Spinner } from "./ui/spinner";
import { cn } from "../lib/utils";
import { type AppTheme } from "../theme";
import { type SessionUser } from "../App";
import { LANGUAGES } from "../i18n";
import i18n from "../i18n";

type Tab = "perfil" | "segurança" | "sessões" | "preferências" | "conta";

type AccountSettingsProps = {
  onClose: () => void;
  withReauth: <T>(action: () => Promise<T>) => Promise<T>;
  theme: AppTheme;
  onThemeChange: (t: AppTheme) => void;
  user: SessionUser | null;
};

type Profile = {
  id: string;
  username: string;
  fullName: string | null;
  email: string | null;
  role: "admin" | "member";
  createdAt: string | null;
  linkedProviders: { google: boolean; github: boolean };
};

type SessionInfo = {
  sessionId: string;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  userAgent: string;
};

type TfaStatus = { enabled: boolean; recoveryCodesRemaining: number };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}

function isReauthCancelled(err: unknown): boolean {
  return err instanceof Error && err.message === "reauth_required";
}

// Tempo relativo via i18n com pluralização correta por idioma (i18next resolve
// _one/_other a partir do count — "há 1 minuto" vs "há 2 minutos", "1分钟前"…).
type TFn = (key: string, opts?: Record<string, unknown>) => string;

function timeAgo(iso: string, t: TFn): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("account.time_now");
  if (m < 60) return t("account.time_minutes", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("account.time_hours", { count: h });
  return t("account.time_days", { count: Math.floor(h / 24) });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function parseBrowser(ua: string, t: TFn): string {
  if (!ua) return t("account.unknown_device");
  if (/mobile/i.test(ua)) {
    if (/android/i.test(ua)) return "Android";
    if (/iphone|ipad/i.test(ua)) return "iPhone / iPad";
    return "Mobile";
  }
  if (/edg\//i.test(ua)) return "Edge";
  if (/chrome/i.test(ua)) return "Chrome";
  if (/firefox/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua)) return "Safari";
  return t("account.generic_browser");
}

const NAV: { tab: Tab; icon: typeof User; labelKey: string }[] = [
  { tab: "perfil", icon: User, labelKey: "account.nav_perfil" },
  { tab: "segurança", icon: Lock, labelKey: "account.nav_security" },
  { tab: "sessões", icon: Monitor, labelKey: "account.nav_sessions" },
  { tab: "preferências", icon: Settings, labelKey: "account.nav_preferences" },
  { tab: "conta", icon: Settings, labelKey: "account.nav_account" },
];

export function AccountSettings({
  onClose,
  withReauth,
  theme,
  onThemeChange,
  user,
}: AccountSettingsProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("perfil");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label={t("account.close")}
        className="fixed inset-0 bg-[color:var(--overlay)] backdrop-blur-md"
        type="button"
        onClick={onClose}
      />
      <section
        aria-modal="true"
        role="dialog"
        className="account-settings-panel app-panel animate-pop-in relative flex w-full overflow-hidden rounded-[28px] border backdrop-blur-2xl"
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent" />

        {/* Sidebar */}
        <nav className="account-settings-nav flex w-52 shrink-0 flex-col border-r border-[color:var(--border)] p-4 pt-5">
          <div className="mb-5 flex items-center justify-between">
            <span className="text-sm font-semibold text-[color:var(--text)]">
              {t("account.title")}
            </span>
            <Button aria-label={t("account.close")} size="icon" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {NAV.map(({ tab: id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                tab === id
                  ? "bg-[color:var(--accent)] text-white"
                  : "text-[color:var(--muted)] hover:bg-[color:var(--field)] hover:text-[color:var(--text)]",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="account-settings-content flex-1 overflow-y-auto p-6">
          {tab === "perfil" && (
            <PerfilTab withReauth={withReauth} user={user} />
          )}
          {tab === "segurança" && (
            <SegurancaTab withReauth={withReauth} />
          )}
          {tab === "sessões" && (
            <SessoesTab />
          )}
          {tab === "preferências" && (
            <PreferenciasTab theme={theme} onThemeChange={onThemeChange} />
          )}
          {tab === "conta" && (
            <ContaTab withReauth={withReauth} user={user} onClose={onClose} />
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Perfil ──────────────────────────────────────────────────────────────────

function PerfilTab({
  withReauth,
  user,
}: {
  withReauth: AccountSettingsProps["withReauth"];
  user: SessionUser | null;
}) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState("");

  const [email, setEmail] = useState("");
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    api<Profile>("/api/account/me")
      .then((p) => {
        setProfile(p);
        setFullName(p.fullName ?? "");
      })
      .catch(() => {});

    fetch("/api/account/email")
      .then((r) => (r.ok ? r.json() : { email: null }))
      .then((d: { email: string | null }) => {
        setEmail(d.email ?? "");
        setEmailLoaded(true);
      })
      .catch(() => setEmailLoaded(true));
  }, []);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setSavingName(true);
    setNameError("");
    setNameSaved(false);
    try {
      await api("/api/account/profile", {
        method: "PUT",
        body: JSON.stringify({ fullName: fullName.trim() || null }),
      });
      setNameSaved(true);
      window.setTimeout(() => setNameSaved(false), 2500);
    } catch {
      setNameError(t("account.error_save"));
    } finally {
      setSavingName(false);
    }
  }

  async function saveEmail(e: FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    setEmailError("");
    setEmailSaved(false);
    try {
      await api("/api/account/email", {
        method: "PUT",
        body: JSON.stringify({ email: email.trim() }),
      });
      setEmailSaved(true);
      window.setTimeout(() => setEmailSaved(false), 2500);
    } catch (err) {
      setEmailError(
        err instanceof Error && err.message === "invalid_email"
          ? t("account.error_invalid_email")
          : t("account.error_save"),
      );
    } finally {
      setSavingEmail(false);
    }
  }

  const initials = (profile?.fullName ?? user?.username ?? "?")
    .split(" ")
    .map((w) => w[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-[color:var(--text)]">
        {t("account.nav_perfil")}
      </h2>

      {/* Avatar + identity */}
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)] text-xl font-bold text-white">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-[color:var(--text)]">
            {profile?.fullName ?? user?.username}
          </p>
          <p className="text-sm text-[color:var(--muted)]">@{profile?.username ?? user?.username}</p>
          <span
            className={cn(
              "mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
              (profile?.role ?? user?.role) === "admin"
                ? "bg-[color:var(--accent)] text-white"
                : "bg-[color:var(--field)] text-[color:var(--muted)]",
            )}
          >
            {(profile?.role ?? user?.role) === "admin" ? t("account.role_admin") : t("account.role_member")}
          </span>
          {profile?.createdAt && (
            <p className="mt-0.5 text-xs text-[color:var(--muted)]">
              {t("account.member_since", { date: fmtDate(profile.createdAt) })}
            </p>
          )}
        </div>
      </div>

      {/* Full name */}
      <form onSubmit={saveName} className="grid gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted)]">
          {t("account.full_name_label")}
        </label>
        <div className="flex flex-col gap-2 min-[430px]:flex-row">
          <Input
            className="h-10 flex-1 rounded-xl px-3"
            placeholder={t("account.full_name_placeholder")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <Button type="submit" variant="outline" disabled={savingName} className="h-10 w-full shrink-0 min-[430px]:w-auto">
            {savingName ? <Spinner className="h-4 w-4" /> : t("account.save")}
          </Button>
        </div>
        {nameSaved && <p className="text-xs text-green-400">{t("account.saved")}</p>}
        {nameError && <p className="text-xs text-red-300">{nameError}</p>}
      </form>

      {/* Recovery email */}
      <form onSubmit={saveEmail} className="grid gap-1.5">
        <label className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted)]">
          <Mail className="mr-1 inline h-3.5 w-3.5" />
          {t("account.recovery_email")}
        </label>
        <p className="text-xs text-[color:var(--muted)]">{t("account.recovery_email_desc")}</p>
        {emailLoaded && (
          <div className="flex flex-col gap-2 min-[430px]:flex-row">
            <Input
              type="email"
              className="h-10 flex-1 rounded-xl px-3"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={savingEmail} className="h-10 w-full shrink-0 min-[430px]:w-auto">
              {savingEmail ? <Spinner className="h-4 w-4" /> : t("account.save")}
            </Button>
          </div>
        )}
        {emailSaved && <p className="text-xs text-green-400">{t("account.saved")}</p>}
        {emailError && <p className="text-xs text-red-300">{emailError}</p>}
      </form>

      {/* Linked providers */}
      {profile && (
        <div className="grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted)]">
            {t("account.linked_providers")}
          </p>
          <div className="flex flex-wrap gap-3">
            <ProviderChip
              linked={profile.linkedProviders.google}
              label="Google"
              icon={
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
              }
            />
            <ProviderChip
              linked={profile.linkedProviders.github}
              label="GitHub"
              icon={
                <svg className="h-4 w-4" viewBox="0 0 24 24">
                  <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" fill="currentColor"/>
                </svg>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderChip({
  linked,
  label,
  icon,
}: {
  linked: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm",
        linked
          ? "border-[color:var(--accent-border)] text-[color:var(--text)]"
          : "border-[color:var(--border)] text-[color:var(--muted)] opacity-60",
      )}
    >
      {icon}
      <span>{label}</span>
      {linked ? (
        <span className="ml-1 h-2 w-2 rounded-full bg-green-400" />
      ) : (
        <span className="ml-1 h-2 w-2 rounded-full bg-[color:var(--muted)] opacity-40" />
      )}
    </div>
  );
}

// ─── Segurança ───────────────────────────────────────────────────────────────

function SegurancaTab({
  withReauth,
}: {
  withReauth: AccountSettingsProps["withReauth"];
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState("");

  // 2FA state
  const [tfaStatus, setTfaStatus] = useState<TfaStatus | null>(null);
  const [tfaError, setTfaError] = useState("");
  const [tfaBusy, setTfaBusy] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [enableCode, setEnableCode] = useState("");
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [codesCopied, setCodesCopied] = useState(false);

  useEffect(() => {
    api<TfaStatus>("/api/account/2fa")
      .then(setTfaStatus)
      .catch(() => setTfaError(t("account.error_load_status")));
  }, [t]);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setSavingPw(true);
    setPwError("");
    setPwSuccess(false);
    try {
      await withReauth(() =>
        api("/api/account/password", {
          method: "PUT",
          body: JSON.stringify({ current, password: newPw }),
        }),
      );
      setCurrent("");
      setNewPw("");
      setPwSuccess(true);
      window.setTimeout(() => setPwSuccess(false), 3000);
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setPwError(
        err instanceof Error
          ? err.message === "invalid_current_password"
            ? t("account.error_invalid_current_password")
            : t(`team.error_${err.message}`) || t("account.error_change_password")
          : t("account.error_change_password"),
      );
    } finally {
      setSavingPw(false);
    }
  }

  async function beginSetup() {
    setTfaError("");
    setTfaBusy(true);
    try {
      const result = await withReauth(() =>
        api<{ secret: string; otpauthUri: string }>("/api/account/2fa/setup", { method: "POST" }),
      );
      setSetup(result);
      setFreshCodes(null);
      setEnableCode("");
    } catch (err) {
      if (!isReauthCancelled(err)) setTfaError(t("account.error_start_setup"));
    } finally {
      setTfaBusy(false);
    }
  }

  async function confirmEnable(e: FormEvent) {
    e.preventDefault();
    setTfaError("");
    setTfaBusy(true);
    try {
      const result = await withReauth(() =>
        api<{ recoveryCodes: string[] }>("/api/account/2fa/enable", {
          method: "POST",
          body: JSON.stringify({ code: enableCode.trim() }),
        }),
      );
      setFreshCodes(result.recoveryCodes);
      setSetup(null);
      setEnableCode("");
      const s = await api<TfaStatus>("/api/account/2fa");
      setTfaStatus(s);
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setTfaError(
        err instanceof Error && err.message === "invalid_code"
          ? t("account.error_invalid_code")
          : t("account.error_enable"),
      );
    } finally {
      setTfaBusy(false);
    }
  }

  async function confirmDisable(e: FormEvent) {
    e.preventDefault();
    setTfaError("");
    setTfaBusy(true);
    try {
      await withReauth(() =>
        api("/api/account/2fa/disable", {
          method: "POST",
          body: JSON.stringify({ code: disableCode.trim() }),
        }),
      );
      setDisabling(false);
      setDisableCode("");
      setFreshCodes(null);
      const s = await api<TfaStatus>("/api/account/2fa");
      setTfaStatus(s);
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setTfaError(
        err instanceof Error && err.message === "invalid_code"
          ? t("account.error_invalid_code")
          : t("account.error_disable"),
      );
    } finally {
      setTfaBusy(false);
    }
  }

  async function regenerate() {
    setTfaError("");
    setTfaBusy(true);
    try {
      const result = await withReauth(() =>
        api<{ recoveryCodes: string[] }>("/api/account/2fa/recovery-codes", { method: "POST" }),
      );
      setFreshCodes(result.recoveryCodes);
      const s = await api<TfaStatus>("/api/account/2fa");
      setTfaStatus(s);
    } catch (err) {
      if (!isReauthCancelled(err)) setTfaError(t("account.error_new_codes"));
    } finally {
      setTfaBusy(false);
    }
  }

  function copySecret() {
    if (!setup) return;
    void navigator.clipboard.writeText(setup.secret).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); },
      () => {},
    );
  }

  // Backup offline dos códigos: baixa um .txt simples (cabeçalho + um código por
  // linha) que também serve para imprimir.
  function downloadCodes() {
    if (!freshCodes) return;
    const lines = [
      t("account.two_factor_file_header"),
      new Date().toLocaleString(),
      "",
      ...freshCodes,
      "",
    ].join("\n");
    const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contas-exe-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyCodes() {
    if (!freshCodes) return;
    void navigator.clipboard.writeText(freshCodes.join("\n")).then(
      () => { setCodesCopied(true); window.setTimeout(() => setCodesCopied(false), 1500); },
      () => {},
    );
  }

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold text-[color:var(--text)]">
        {t("account.nav_security")}
      </h2>

      {/* Change password */}
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted)]">
          {t("account.change_password")}
        </p>
        <form onSubmit={changePassword} className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs text-[color:var(--muted)]">{t("account.current_password_label")}</span>
            <Input
              type="password"
              className="h-10 rounded-xl px-3"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-[color:var(--muted)]">{t("account.new_password_label")}</span>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  type={showNewPw ? "text" : "password"}
                  className="h-10 rounded-xl px-3 pr-10"
                  autoComplete="new-password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                />
                <button
                  aria-label={showNewPw ? t("login.hide_password") : t("login.show_password")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
                  type="button"
                  onClick={() => setShowNewPw((v) => !v)}
                >
                  {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <GeneratePasswordButton
                onGenerate={(pw) => {
                  setNewPw(pw);
                  setShowNewPw(true);
                }}
              />
            </div>
            <PasswordStrengthMeter password={newPw} />
          </label>
          {pwSuccess && <p className="text-xs text-green-400">{t("account.password_changed_ok")}</p>}
          {pwError && <p className="text-xs text-red-300">{pwError}</p>}
          <Button
            type="submit"
            variant="outline"
            disabled={savingPw || !current || !newPw}
            className="h-10 w-fit"
          >
            {savingPw ? <Spinner className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            {t("account.change_password_btn")}
          </Button>
        </form>
      </section>

      {/* 2FA */}
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted)]">
          {t("account.two_factor")}
        </p>
        {tfaError && <p className="text-sm text-red-300">{tfaError}</p>}

        {freshCodes ? (
          <div className="rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--field)] p-4">
            <p className="text-sm font-semibold text-[color:var(--text)]">
              {t("account.two_factor_save_codes_title")}
            </p>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              {t("account.two_factor_save_codes_instruction")}
            </p>
            <div className="mt-3 grid grid-cols-1 gap-2 font-mono text-sm text-[color:var(--text)] md:grid-cols-2">
              {freshCodes.map((c) => (
                <span key={c} className="rounded-lg bg-[color:var(--surface-soft)] px-2.5 py-1.5 text-center">
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" onClick={downloadCodes}>
                <Download className="h-4 w-4" />
                {t("account.two_factor_download_codes")}
              </Button>
              <Button variant="outline" onClick={copyCodes}>
                <Copy className="h-4 w-4" />
                {codesCopied
                  ? t("account.two_factor_codes_copied")
                  : t("account.two_factor_copy_codes")}
              </Button>
              <Button variant="outline" onClick={() => setFreshCodes(null)}>
                {t("account.two_factor_saved")}
              </Button>
            </div>
          </div>
        ) : setup ? (
          <form className="grid gap-3" onSubmit={confirmEnable}>
            <p className="text-sm text-[color:var(--muted)]">{t("account.two_factor_manual_key")}</p>
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
            {copied && <p className="text-xs text-[color:var(--accent)]">{t("account.two_factor_key_copied")}</p>}
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
                onChange={(e) => setEnableCode(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Button type="button" variant="outline" onClick={() => setSetup(null)}>
                {t("account.two_factor_cancel")}
              </Button>
              <Button type="submit" variant="neon" disabled={tfaBusy || !enableCode.trim()}>
                {tfaBusy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                {t("account.two_factor_activate")}
              </Button>
            </div>
          </form>
        ) : disabling ? (
          <form className="grid gap-3" onSubmit={confirmDisable}>
            <p className="text-sm text-[color:var(--muted)]">{t("account.two_factor_disable_instruction")}</p>
            <Input
              autoFocus
              className="h-11 rounded-2xl px-4 tracking-widest"
              placeholder={t("account.two_factor_code")}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value)}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Button type="button" variant="outline" onClick={() => setDisabling(false)}>
                {t("account.two_factor_cancel")}
              </Button>
              <button
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                type="submit"
                disabled={tfaBusy || !disableCode.trim()}
              >
                <ShieldOff className="h-4 w-4" />
                {t("account.two_factor_disable")}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--field)] p-4 min-[430px]:flex-row min-[430px]:items-center">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[color:var(--text)]">
                {tfaStatus?.enabled ? t("account.two_factor_enabled") : t("account.two_factor_disabled")}
              </p>
              <p className="text-xs text-[color:var(--muted)]">
                {tfaStatus?.enabled
                  ? t("account.two_factor_description", { count: tfaStatus.recoveryCodesRemaining })
                  : t("account.two_factor_cta")}
              </p>
            </div>
            {tfaStatus?.enabled ? (
              <div className="flex shrink-0 flex-col gap-2">
                <Button variant="outline" disabled={tfaBusy} onClick={regenerate}>
                  <KeyRound className="h-4 w-4" />
                  {t("account.two_factor_new_codes")}
                </Button>
                <Button variant="outline" disabled={tfaBusy} onClick={() => setDisabling(true)}>
                  <ShieldOff className="h-4 w-4" />
                  {t("account.two_factor_disable")}
                </Button>
              </div>
            ) : (
              <Button className="w-full shrink-0 min-[430px]:w-auto" variant="neon" disabled={tfaBusy} onClick={beginSetup}>
                {tfaBusy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                {t("account.two_factor_enable")}
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Sessões ─────────────────────────────────────────────────────────────────

function SessoesTab() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ sessions: SessionInfo[] }>("/api/account/sessions");
      setSessions(data.sessions);
    } catch {
      setError(t("account.error_load_sessions"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function revoke(sid: string) {
    setRevoking(sid);
    setError("");
    try {
      await api(`/api/account/sessions/${encodeURIComponent(sid)}`, { method: "DELETE" });
      setSessions((s) => s.filter((x) => x.sessionId !== sid));
    } catch {
      setError(t("account.error_revoke_session"));
    } finally {
      setRevoking(null);
    }
  }

  async function revokeAll() {
    setError("");
    const others = sessions.filter((s) => !s.current);
    for (const s of others) await revoke(s.sessionId);
  }

  const others = sessions.filter((s) => !s.current);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 min-[430px]:flex-row min-[430px]:items-center min-[430px]:justify-between">
        <h2 className="text-lg font-semibold text-[color:var(--text)]">
          {t("account.nav_sessions")}
        </h2>
        {others.length > 0 && (
          <Button variant="outline" className="h-8 text-xs" onClick={revokeAll}>
            <LogOut className="h-3.5 w-3.5" />
            {t("account.revoke_all_sessions")}
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-5 w-5" />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-[color:var(--muted)]">{t("account.no_sessions")}</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div
              key={s.sessionId}
              className="flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--field)] p-4 min-[430px]:flex-row min-[430px]:items-center"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4 shrink-0 text-[color:var(--muted)]" />
                  <p className="text-sm font-medium text-[color:var(--text)]">
                    {parseBrowser(s.userAgent, t)}
                  </p>
                  {s.current && (
                    <span className="rounded-full bg-[color:var(--accent)] px-2 py-0.5 text-xs font-semibold text-white">
                      {t("account.current_session")}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-[color:var(--muted)]">
                  {t("account.session_last_active", { time: timeAgo(s.lastSeenAt, t) })}
                  {" · "}
                  {t("account.session_created", { time: timeAgo(s.createdAt, t) })}
                </p>
              </div>
              {!s.current && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={revoking === s.sessionId}
                  onClick={() => revoke(s.sessionId)}
                  className="shrink-0"
                >
                  {revoking === s.sessionId ? (
                    <Spinner className="h-3.5 w-3.5" />
                  ) : (
                    <LogOut className="h-3.5 w-3.5" />
                  )}
                  {t("account.revoke_session")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Preferências ────────────────────────────────────────────────────────────

function PreferenciasTab({
  theme,
  onThemeChange,
}: {
  theme: AppTheme;
  onThemeChange: (t: AppTheme) => void;
}) {
  const { t } = useTranslation();
  const currentLang = i18n.language as string;

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold text-[color:var(--text)]">
        {t("account.nav_preferences")}
      </h2>

      {/* Theme */}
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted)]">
          {t("account.theme_label")}
        </p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(["white", "dark"] as const).map((th) => (
            <button
              key={th}
              type="button"
              onClick={() => onThemeChange(th)}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl border-2 py-5 text-sm font-medium transition",
                theme === th
                  ? "border-[color:var(--accent)] text-[color:var(--accent)]"
                  : "border-[color:var(--border)] text-[color:var(--muted)] hover:border-[color:var(--accent-muted)]",
              )}
            >
              <div
                className={cn(
                  "h-8 w-14 rounded-lg border",
                  th === "white"
                    ? "border-gray-300 bg-white"
                    : "border-gray-700 bg-gray-900",
                )}
              />
              {th === "white" ? t("account.theme_light") : t("account.theme_dark")}
            </button>
          ))}
        </div>
      </section>

      {/* Language */}
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted)]">
          <Globe className="mr-1 inline h-3.5 w-3.5" />
          {t("account.language_label")}
        </p>
        <div className="grid grid-cols-1 gap-2">
          {LANGUAGES.map(({ code, label, flag }) => (
            <button
              key={code}
              type="button"
              onClick={() => void i18n.changeLanguage(code)}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition",
                currentLang === code
                  ? "border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--text)]"
                  : "border-[color:var(--border)] text-[color:var(--muted)] hover:border-[color:var(--accent-muted)] hover:text-[color:var(--text)]",
              )}
            >
              <span className="text-lg">{flag}</span>
              <span>{label}</span>
              {currentLang === code && (
                <span className="ml-auto h-2 w-2 rounded-full bg-[color:var(--accent)]" />
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// ─── Conta ───────────────────────────────────────────────────────────────────

function ContaTab({
  withReauth,
  user,
  onClose,
}: {
  withReauth: AccountSettingsProps["withReauth"];
  user: SessionUser | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // Change username
  const [newUsername, setNewUsername] = useState("");
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameSuccess, setUsernameSuccess] = useState("");
  const [usernameError, setUsernameError] = useState("");

  // Delete account
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function changeUsername(e: FormEvent) {
    e.preventDefault();
    setSavingUsername(true);
    setUsernameError("");
    setUsernameSuccess("");
    try {
      await withReauth(() =>
        api("/api/account/username", {
          method: "PUT",
          body: JSON.stringify({ username: newUsername.trim() }),
        }),
      );
      setUsernameSuccess(t("account.username_changed"));
      setNewUsername("");
      window.setTimeout(() => setUsernameSuccess(""), 3000);
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setUsernameError(
        err instanceof Error && err.message === "username_taken"
          ? t("account.error_username_taken")
          : t("account.error_change_username"),
      );
    } finally {
      setSavingUsername(false);
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (confirmInput !== user?.username) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await withReauth(() => api("/api/account", { method: "DELETE" }));
      onClose();
      window.location.reload();
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setDeleteError(
        err instanceof Error && err.message === "last_admin"
          ? t("account.error_delete_last_admin")
          : t("account.error_delete_account"),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold text-[color:var(--text)]">
        {t("account.nav_account")}
      </h2>

      {/* Change username */}
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--muted)]">
          {t("account.change_username")}
        </p>
        <p className="text-xs text-[color:var(--muted)]">
          {t("account.username_currently", { username: user?.username })}
        </p>
        <form onSubmit={changeUsername} className="grid gap-3">
          <Input
            className="h-10 rounded-xl px-3"
            placeholder={t("account.new_username_label")}
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
          />
          {usernameSuccess && <p className="text-xs text-green-400">{usernameSuccess}</p>}
          {usernameError && <p className="text-xs text-red-300">{usernameError}</p>}
          <Button
            type="submit"
            variant="outline"
            disabled={savingUsername || !newUsername.trim()}
            className="h-10 w-fit"
          >
            {savingUsername ? <Spinner className="h-4 w-4" /> : null}
            {t("account.change_username_btn")}
          </Button>
        </form>
      </section>

      {/* Danger zone */}
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-red-500">
          {t("account.danger_zone")}
        </p>
        <div className="rounded-2xl border border-red-600/30 bg-red-600/5 p-4">
          <p className="text-sm font-semibold text-[color:var(--text)]">
            {t("account.delete_account")}
          </p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {t("account.delete_account_desc")}
          </p>
          <form onSubmit={deleteAccount} className="mt-4 grid gap-3">
            <label className="grid gap-1.5">
              <span className="text-xs text-[color:var(--muted)]">
                {t("account.delete_confirm_label", { username: user?.username })}
              </span>
              <Input
                className="h-10 rounded-xl border-red-600/30 px-3"
                placeholder={user?.username}
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
              />
            </label>
            {deleteError && <p className="text-xs text-red-300">{deleteError}</p>}
            <button
              type="submit"
              disabled={deleting || confirmInput !== user?.username}
              className="flex h-10 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {deleting ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              {t("account.delete_confirm_btn")}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
