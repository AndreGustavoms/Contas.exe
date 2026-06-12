import { type FormEvent, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileDown,
  LogOut,
  Monitor,
  ScrollText,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  GeneratePasswordButton,
  PasswordStrengthMeter,
} from "./ui/password-tools";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch";

// Admin-only panel to manage the people who can log in and their active
// sessions. Talks to the /api/users and /api/sessions endpoints (all admin-gated
// server-side). Members never see this.

type ManagedUser = {
  id: string;
  username: string;
  role: "admin" | "member";
  createdAt: string;
  twoFactorEnabled?: boolean;
};

type ManagedSession = {
  sessionId: string;
  userId: string;
  createdAt: string;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
  current: boolean;
};

type AuditEvent = {
  ts: string;
  userId: string | null;
  username: string | null;
  action: string;
  target: string | null;
  ipHash: string;
};

const AUDIT_ACTION_I18N_KEYS: Record<string, string> = {
  login_ok: "team.audit_login_ok",
  login_fail: "team.audit_login_fail",
  login_google_ok: "team.audit_login_ok",
  login_google_fail: "team.audit_login_fail",
  logout: "team.audit_logout",
  reauth_ok: "team.audit_reauth_ok",
  reauth_fail: "team.audit_reauth_fail",
  secret_viewed: "team.audit_secret_viewed",
  backup_exported: "team.audit_backup_exported",
  password_changed: "team.audit_password_changed",
  user_created: "team.audit_user_created",
  user_deleted: "team.audit_user_deleted",
  group_deleted: "team.audit_group_deleted",
  session_revoked: "team.audit_session_revoked",
  sessions_revoked_all: "team.audit_all_sessions_revoked",
  login_2fa_ok: "team.audit_login_ok",
  login_2fa_fail: "team.audit_login_fail",
  recovery_code_used: "team.audit_login_ok",
  "2fa_enabled": "team.audit_2fa_enabled",
  "2fa_disabled": "team.audit_2fa_disabled",
  "2fa_reset_by_admin": "team.audit_2fa_reset",
  recovery_codes_regenerated: "team.audit_recovery_codes_regenerated",
  account_created: "team.audit_account_created",
  rate_limited: "team.audit_rate_limited",
  password_reset_requested: "team.audit_password_reset_requested",
  password_reset_completed: "team.audit_password_reset_completed",
};

const AUDIT_PAGE_SIZE = 25;

type UsersDialogProps = {
  // The current admin's username, so we can prevent self-deletion in the UI.
  currentUsername: string;
  onClose: () => void;
  // Runs a critical action, handling the re-auth prompt+retry centrally (the
  // modal lives in the parent vault). Privileged admin actions go through this.
  withReauth: <T>(action: () => Promise<T>) => Promise<T>;
};

const API_USERS = "/api/users";
const API_SESSIONS = "/api/sessions";
const API_AUDIT = "/api/audit";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `http_${response.status}`);
  }
  return response.json() as Promise<T>;
}

const ERROR_I18N_KEYS: Record<string, string> = {
  username_taken: "team.error_username_taken",
  invalid: "team.error_invalid",
  last_admin: "team.error_last_admin",
  password_required: "team.error_password_required",
  username_too_short: "team.error_username_too_short",
  username_too_long: "team.error_username_too_long",
  password_too_short: "team.error_password_too_short",
  password_too_long: "team.error_password_too_long",
  password_no_uppercase: "team.error_password_no_uppercase",
  password_no_lowercase: "team.error_password_no_lowercase",
  password_no_number: "team.error_password_no_number",
  password_no_special: "team.error_password_no_special",
  password_too_common: "team.error_password_too_common",
  password_same_as_username: "team.error_password_same_as_username",
};

// When the user cancels the re-auth prompt, withReauth re-throws the original
// reauth_required error. Treat that as a silent no-op (not a real failure).
function isReauthCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === "reauth_required";
}

// Tempo relativo via i18n com plural por idioma (mesmas chaves do painel
// Minha conta: account.time_*).
type TFn = (key: string, opts?: Record<string, unknown>) => string;

function relativeTime(ms: number, t: TFn): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return t("account.time_now");
  if (min < 60) return t("account.time_minutes", { count: min });
  const hours = Math.round(min / 60);
  if (hours < 24) return t("account.time_hours", { count: hours });
  return t("account.time_days", { count: Math.round(hours / 24) });
}

// Best-effort short device label from the user-agent string.
function deviceLabel(userAgent: string, t: TFn): string {
  if (!userAgent) return t("team.unknown_device");
  const browser =
    /Edg/.test(userAgent)
      ? "Edge"
      : /OPR|Opera/.test(userAgent)
        ? "Opera"
        : /Chrome/.test(userAgent)
          ? "Chrome"
          : /Firefox/.test(userAgent)
            ? "Firefox"
            : /Safari/.test(userAgent)
              ? "Safari"
              : t("team.generic_browser");
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iOS/.test(userAgent)
        ? "iOS"
        : /Mac/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}

export function UsersDialog({
  currentUsername,
  onClose,
  withReauth,
}: UsersDialogProps) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRole, setNewRole] = useState<"admin" | "member">("member");
  const [creating, setCreating] = useState(false);

  const [sessions, setSessions] = useState<ManagedSession[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(0);
  const [auditAction, setAuditAction] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function loadUsers() {
    try {
      const data = await requestJson<{ users: ManagedUser[] }>(API_USERS);
      setUsers(data.users);
    } catch {
      setError(t("team.error_load_users"));
    } finally {
      setLoading(false);
    }
  }

  async function loadSessions() {
    try {
      const data = await requestJson<{ sessions: ManagedSession[] }>(
        API_SESSIONS,
      );
      setSessions(data.sessions);
    } catch {
      // Non-fatal: the sessions panel just stays empty.
    }
  }

  // Monta a query string dos filtros atuais. `limit`/`offset` variam entre a
  // listagem paginada e o export (que puxa até 500 de uma vez).
  function auditParams(limit: number, offset: number) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (auditAction) params.set("action", auditAction);
    if (auditQuery.trim()) params.set("q", auditQuery.trim());
    if (auditFrom) params.set("from", auditFrom);
    if (auditTo) params.set("to", auditTo);
    return params;
  }

  async function loadEvents(page = auditPage) {
    try {
      const params = auditParams(AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE);
      const data = await requestJson<{ events: AuditEvent[]; total: number }>(
        `${API_AUDIT}?${params.toString()}`,
      );
      setEvents(data.events);
      setAuditTotal(data.total);
    } catch {
      // Non-fatal: the activity panel just stays empty.
    }
  }

  useEffect(() => {
    void loadUsers();
    void loadSessions();
    // Loaders are stable enough for a one-shot mount load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recarrega a auditoria quando filtros ou página mudam. A busca textual é
  // debounced (300ms) para não disparar uma request por tecla.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadEvents(auditPage);
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditPage, auditAction, auditQuery, auditFrom, auditTo]);

  // Exporta os eventos do filtro atual como CSV (separador ; — Excel pt-BR).
  async function exportAudit() {
    try {
      const params = auditParams(500, 0);
      const data = await requestJson<{ events: AuditEvent[] }>(
        `${API_AUDIT}?${params.toString()}`,
      );
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const lines = [
        ["timestamp", "usuario", "acao", "alvo"].join(";"),
        ...data.events.map((e) =>
          [e.ts, e.username ?? "", e.action, e.target ?? ""]
            .map((v) => escape(String(v)))
            .join(";"),
        ),
      ].join("\r\n");
      const blob = new Blob([`﻿${lines}`], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `contas-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("team.error_audit_export"));
    }
  }

  async function endSession(session: ManagedSession) {
    setError("");
    try {
      await requestJson(`${API_SESSIONS}/${encodeURIComponent(session.sessionId)}`, {
        method: "DELETE",
      });
      await loadSessions();
      await loadEvents();
    } catch {
      setError(t("team.error_end_session"));
    }
  }

  async function endAllSessions(user: ManagedUser) {
    setError("");
    try {
      await withReauth(() =>
        requestJson(
          `${API_USERS}/${encodeURIComponent(user.id)}/sessions/revoke`,
          { method: "POST" },
        ),
      );
      await loadSessions();
      await loadEvents();
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setError(t("team.error_end_sessions"));
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreating(true);
    try {
      // withReauth only prompts if the server demands it (creating an admin).
      await withReauth(() =>
        requestJson<ManagedUser>(API_USERS, {
          method: "POST",
          body: JSON.stringify({
            username: newName.trim(),
            password: newPassword,
            role: newRole,
          }),
        }),
      );
      setNewName("");
      setNewPassword("");
      setNewRole("member");
      await loadUsers();
      await loadEvents();
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setError(t(ERROR_I18N_KEYS[err instanceof Error ? err.message : "invalid"] ?? "team.error_invalid"));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(user: ManagedUser) {
    setError("");
    try {
      await withReauth(() =>
        requestJson(`${API_USERS}/${encodeURIComponent(user.id)}`, {
          method: "DELETE",
        }),
      );
      await loadUsers();
      await loadSessions();
      await loadEvents();
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setError(t(ERROR_I18N_KEYS[err instanceof Error ? err.message : "invalid"] ?? "team.error_invalid"));
    }
  }

  // Admin force-reset of a user's 2FA (safety net for someone locked out).
  async function resetUserTwoFactor(target: ManagedUser) {
    setError("");
    try {
      await withReauth(() =>
        requestJson(`${API_USERS}/${encodeURIComponent(target.id)}/2fa/reset`, {
          method: "POST",
        }),
      );
      await loadUsers();
      await loadEvents();
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setError(t("team.error_reset_2fa"));
    }
  }

  // Backup is a file download AND reauth-gated, so a plain <a> won't work (a 403
  // would render as a JSON page). Fetch it through withReauth, then save the blob.
  async function downloadBackup() {
    setError("");
    try {
      const blob = await withReauth(async () => {
        const res = await fetch("/api/admin/backup");
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `http_${res.status}`);
        }
        return res.blob();
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `contas-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      await loadEvents();
    } catch (err) {
      if (isReauthCancelled(err)) return;
      setError(t("team.error_backup"));
    }
  }

  return (
    // Wrapper rolável + m-auto: este é o modal mais alto do app; com
    // items-center o topo ficava cortado e inalcançável no mobile.
    <div className="modal-viewport fixed inset-0 z-50 flex overflow-y-auto overscroll-contain px-4 py-6">
      <button
        aria-label={t("team.close")}
        className="fixed inset-0 bg-[color:var(--overlay)] backdrop-blur-md"
        type="button"
        onClick={onClose}
      />
      <section
        aria-modal="true"
        className="modal-panel modal-panel-lg app-panel animate-pop-in relative m-auto w-full max-w-lg overflow-hidden rounded-[28px] border p-5 backdrop-blur-2xl sm:p-6"
        role="dialog"
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Shield className="h-5 w-5 text-[color:var(--accent)]" />
            <h2 className="text-xl font-semibold tracking-normal text-[color:var(--text)]">
              {t("team.title")}
            </h2>
          </div>
          <Button
            aria-label={t("team.close")}
            size="icon"
            variant="ghost"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="mt-1.5 text-sm text-[color:var(--muted)]">
          {t("team.description")}
        </p>

        {/* Create user */}
        <form
          className="mt-5 grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--field)] p-4"
          onSubmit={handleCreate}
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[color:var(--muted)]">
                {t("team.username_label")}
              </span>
              <Input
                autoComplete="off"
                minLength={2}
                maxLength={80}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[color:var(--muted)]">
                {t("team.password_label")}
              </span>
              <div className="flex items-center gap-2">
                <Input
                  autoComplete="new-password"
                  type={showNewPassword ? "text" : "password"}
                  minLength={8}
                  maxLength={128}
                  className="min-w-0 flex-1"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <GeneratePasswordButton
                  onGenerate={(pw) => {
                    setNewPassword(pw);
                    setShowNewPassword(true);
                  }}
                />
              </div>
              <PasswordStrengthMeter password={newPassword} />
            </label>
          </div>

          <div className="flex flex-col items-stretch justify-between gap-3 min-[430px]:flex-row min-[430px]:items-center">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[color:var(--text)]">
              <Switch
                checked={newRole === "admin"}
                label={t("team.make_admin")}
                onChange={(event) =>
                  setNewRole(event.target.checked ? "admin" : "member")
                }
              />
              {t("team.make_admin")}
            </label>
            <Button
              className="w-full shrink-0 min-[430px]:w-auto"
              variant="neon"
              disabled={creating || !newName.trim() || !newPassword}
              type="submit"
            >
              {creating ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {t("team.create")}
            </Button>
          </div>
        </form>

        {error ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        {/* User list */}
        <div className="mt-5 space-y-2">
          {loading ? (
            <p className="py-6 text-center text-sm text-[color:var(--muted)]">
              {t("team.loading")}
            </p>
          ) : users.length === 0 ? (
            <p className="py-6 text-center text-sm text-[color:var(--muted)]">
              {t("team.no_users")}
            </p>
          ) : (
            users.map((user) => {
              const isSelf = user.username === currentUsername;
              return (
                <div
                  key={user.id}
              className="flex flex-col items-stretch justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3.5 py-2.5 min-[430px]:flex-row min-[430px]:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                      {user.username}
                      {isSelf ? (
                        <span className="ml-2 text-xs font-normal text-[color:var(--muted)]">
                          {t("team.you")}
                        </span>
                      ) : null}
                      {user.twoFactorEnabled ? (
                        <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-[color:var(--accent)]">
                          <ShieldCheck className="h-3 w-3" />
                          2FA
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-[color:var(--muted)]">
                      {user.role === "admin" ? t("team.role_admin") : t("team.role_member")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {user.twoFactorEnabled ? (
                      <button
                        className="rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
                        type="button"
                        onClick={() => resetUserTwoFactor(user)}
                      >
                        {t("team.reset_2fa")}
                      </button>
                    ) : null}
                    <Button
                      aria-label={t("team.remove_user", { username: user.username })}
                      className={cn(isSelf && "pointer-events-none opacity-40")}
                      disabled={isSelf}
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDelete(user)}
                    >
                      <Trash2 className="h-4 w-4 text-red-300" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Active sessions: who is logged in, and the ability to end any session
            or log a user out everywhere. All server-side revocations (real, not
            just UI): the next request from a revoked session falls back to login. */}
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2.5">
            <Monitor className="h-4 w-4 text-[color:var(--accent)]" />
            <h3 className="text-sm font-semibold text-[color:var(--text)]">
              {t("team.active_sessions")}
            </h3>
          </div>
          {sessions.length === 0 ? (
            <p className="rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3.5 py-3 text-xs text-[color:var(--muted)]">
              {t("team.no_sessions")}
            </p>
          ) : (
            <div className="space-y-2">
              {users
                .map((u) => ({
                  user: u,
                  list: sessions.filter((s) => s.userId === u.id),
                }))
                .filter((entry) => entry.list.length > 0)
                .map(({ user, list }) => (
                  <div
                    key={user.id}
                    className="rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] p-3"
                  >
                    <div className="flex flex-col items-stretch justify-between gap-3 min-[430px]:flex-row min-[430px]:items-center">
                      <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                        {user.username}
                        <span className="ml-2 text-xs font-normal text-[color:var(--muted)]">
                          {t("team.sessions_count", { count: list.length })}
                        </span>
                      </p>
                      <button
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200"
                        type="button"
                        onClick={() => endAllSessions(user)}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        {t("team.end_all_sessions")}
                      </button>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {list.map((session) => (
                        <li
                          key={session.sessionId}
                          className="flex flex-col items-stretch justify-between gap-3 rounded-lg bg-[color:var(--surface-soft)] px-2.5 py-2 min-[430px]:flex-row min-[430px]:items-center"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-[color:var(--text)]">
                              {deviceLabel(session.userAgent, t)}
                              {session.current ? (
                                <span className="ml-2 text-[color:var(--accent)]">
                                  {t("team.this_device")}
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate text-[11px] text-[color:var(--muted)]">
                              {t("team.active_since", { time: relativeTime(session.lastSeenAt, t) })}
                            </p>
                          </div>
                          <button
                            aria-label={t("team.end_session_label")}
                            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--muted)] transition hover:bg-red-500/10 hover:text-red-200"
                            type="button"
                            onClick={() => endSession(session)}
                          >
                            {t("team.end_session")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Backup: full export of all groups/accounts (admin only). The browser
            downloads it thanks to the server's Content-Disposition header. */}
        <div className="mt-5 flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--field)] p-4 min-[430px]:flex-row min-[430px]:items-center">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[color:var(--text)]">
              {t("team.backup_title")}
            </p>
            <p className="text-xs text-[color:var(--muted)]">
              {t("team.backup_description")}
            </p>
          </div>
          <button
            className="inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3.5 text-sm font-semibold text-[color:var(--text)] transition hover:border-[color:var(--accent-border)] hover:bg-[color:var(--field-hover)] min-[430px]:w-auto"
            type="button"
            onClick={downloadBackup}
          >
            <Download className="h-4 w-4" />
            {t("team.backup_download")}
          </button>
        </div>

        {/* Activity log: recent security-relevant events (who did what, when).
            Contains no secrets — just actions, targets and timestamps.
            Filters + pagination are server-side; export takes the current filter. */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <ScrollText className="h-4 w-4 text-[color:var(--accent)]" />
              <h3 className="text-sm font-semibold text-[color:var(--text)]">
                {t("team.audit_title")}
              </h3>
            </div>
            <button
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
              type="button"
              onClick={exportAudit}
            >
              <FileDown className="h-3.5 w-3.5" />
              {t("team.audit_export")}
            </button>
          </div>

          {/* Filtros */}
          <div className="mb-2 grid gap-2 md:grid-cols-2">
            <Input
              className="h-9 rounded-xl px-3 text-xs"
              placeholder={t("team.audit_filter_search")}
              value={auditQuery}
              onChange={(e) => {
                setAuditQuery(e.target.value);
                setAuditPage(0);
              }}
            />
            <select
              className="h-9 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3 text-xs text-[color:var(--text)]"
              value={auditAction}
              onChange={(e) => {
                setAuditAction(e.target.value);
                setAuditPage(0);
              }}
            >
              <option value="">{t("team.audit_filter_all_actions")}</option>
              {Object.entries(AUDIT_ACTION_I18N_KEYS).map(([code, key]) => (
                <option key={code} value={code}>
                  {t(key, { defaultValue: code })}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
              {t("team.audit_filter_from")}
              <Input
                type="date"
                className="h-9 flex-1 rounded-xl px-3 text-xs"
                value={auditFrom}
                onChange={(e) => {
                  setAuditFrom(e.target.value);
                  setAuditPage(0);
                }}
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-[color:var(--muted)]">
              {t("team.audit_filter_to")}
              <Input
                type="date"
                className="h-9 flex-1 rounded-xl px-3 text-xs"
                value={auditTo}
                onChange={(e) => {
                  setAuditTo(e.target.value);
                  setAuditPage(0);
                }}
              />
            </label>
          </div>

          {events.length === 0 ? (
            <p className="rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3.5 py-3 text-xs text-[color:var(--muted)]">
              {t("team.no_audit")}
            </p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] p-2">
              {events.map((event, index) => (
                <li
                  key={`${event.ts}-${index}`}
                  className="flex flex-col items-stretch justify-between gap-3 rounded-lg bg-[color:var(--surface-soft)] px-2.5 py-2 min-[430px]:flex-row min-[430px]:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[color:var(--text)]">
                      {t(AUDIT_ACTION_I18N_KEYS[event.action] ?? "team.audit_login_ok", { defaultValue: event.action })}
                      {event.username ? (
                        <span className="ml-2 font-normal text-[color:var(--muted)]">
                          {event.username}
                        </span>
                      ) : null}
                    </p>
                    {event.target ? (
                      <p className="truncate text-[11px] text-[color:var(--muted)]">
                        {event.target}
                      </p>
                    ) : null}
                  </div>
                  <time className="shrink-0 text-[11px] text-[color:var(--muted)]">
                    {new Date(event.ts).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          )}

          {/* Paginação */}
          {auditTotal > AUDIT_PAGE_SIZE ? (
            <div className="mt-2 flex items-center justify-between text-xs text-[color:var(--muted)]">
              <button
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition enabled:hover:bg-[color:var(--field-hover)] enabled:hover:text-[color:var(--text)] disabled:opacity-40"
                type="button"
                disabled={auditPage === 0}
                onClick={() => setAuditPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {t("team.audit_prev")}
              </button>
              <span>
                {t("team.audit_page_of", {
                  page: auditPage + 1,
                  pages: Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE)),
                })}
              </span>
              <button
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-medium transition enabled:hover:bg-[color:var(--field-hover)] enabled:hover:text-[color:var(--text)] disabled:opacity-40"
                type="button"
                disabled={(auditPage + 1) * AUDIT_PAGE_SIZE >= auditTotal}
                onClick={() => setAuditPage((p) => p + 1)}
              >
                {t("team.audit_next")}
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
