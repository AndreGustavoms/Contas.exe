import { type FormEvent, useEffect, useState } from "react";
import {
  Download,
  LogOut,
  Monitor,
  ScrollText,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
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

// PT labels for audit action codes (server-side stable codes -> friendly text).
const AUDIT_ACTION_LABELS: Record<string, string> = {
  login_ok: "Entrou",
  login_fail: "Falha de login",
  logout: "Saiu",
  reauth_ok: "Reautenticou",
  reauth_fail: "Falha na reautenticação",
  secret_viewed: "Viu/copiou senha",
  backup_exported: "Exportou backup",
  password_changed: "Trocou senha",
  user_created: "Criou usuário",
  user_deleted: "Removeu usuário",
  group_deleted: "Excluiu grupo",
  session_revoked: "Encerrou sessão",
  sessions_revoked_all: "Encerrou todas as sessões",
  login_2fa_ok: "Entrou (2FA)",
  login_2fa_fail: "Falha no código 2FA",
  recovery_code_used: "Entrou (código de recuperação)",
  "2fa_enabled": "Ativou 2FA",
  "2fa_disabled": "Desativou 2FA",
  "2fa_reset_by_admin": "Resetou 2FA de um usuário",
  recovery_codes_regenerated: "Gerou novos códigos de recuperação",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

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

const ERROR_LABELS: Record<string, string> = {
  username_taken: "Esse usuário já existe.",
  invalid: "Preencha usuário e senha.",
  last_admin: "Não dá para remover o último admin.",
  password_required: "Informe a nova senha.",
};

function labelForError(code: string): string {
  return ERROR_LABELS[code] ?? "Algo deu errado. Tente de novo.";
}

// When the user cancels the re-auth prompt, withReauth re-throws the original
// reauth_required error. Treat that as a silent no-op (not a real failure).
function isReauthCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === "reauth_required";
}

// "há 5 min", "há 2 h", "há 3 d" — coarse relative time for last activity.
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}

// Best-effort short device label from the user-agent string.
function deviceLabel(userAgent: string): string {
  if (!userAgent) return "Dispositivo desconhecido";
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
              : "Navegador";
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
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "member">("member");
  const [creating, setCreating] = useState(false);

  const [sessions, setSessions] = useState<ManagedSession[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);

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
      setError("Não foi possível carregar os usuários.");
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

  async function loadEvents() {
    try {
      const data = await requestJson<{ events: AuditEvent[] }>(API_AUDIT);
      setEvents(data.events);
    } catch {
      // Non-fatal: the activity panel just stays empty.
    }
  }

  useEffect(() => {
    void loadUsers();
    void loadSessions();
    void loadEvents();
    // Loaders are stable enough for a one-shot mount load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function endSession(session: ManagedSession) {
    setError("");
    try {
      await requestJson(`${API_SESSIONS}/${encodeURIComponent(session.sessionId)}`, {
        method: "DELETE",
      });
      await loadSessions();
      await loadEvents();
    } catch {
      setError("Não foi possível encerrar a sessão.");
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
      setError("Não foi possível encerrar as sessões.");
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
      setError(labelForError(err instanceof Error ? err.message : "invalid"));
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
      setError(labelForError(err instanceof Error ? err.message : "invalid"));
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
      setError("Não foi possível resetar o 2FA.");
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
      setError("Não foi possível baixar o backup.");
    }
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
            <Shield className="h-5 w-5 text-[color:var(--accent)]" />
            <h2 className="text-xl font-semibold tracking-normal text-[color:var(--text)]">
              Equipe
            </h2>
          </div>
          <Button
            aria-label="Fechar"
            size="icon"
            variant="ghost"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="mt-1.5 text-sm text-[color:var(--muted)]">
          Crie logins para o time. Cada pessoa vê só os próprios grupos; o admin
          vê todos.
        </p>

        {/* Create user */}
        <form
          className="mt-5 grid gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--field)] p-4"
          onSubmit={handleCreate}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[color:var(--muted)]">
                Usuário
              </span>
              <Input
                autoComplete="off"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-[color:var(--muted)]">
                Senha
              </span>
              <Input
                autoComplete="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[color:var(--text)]">
              <Switch
                checked={newRole === "admin"}
                label="Tornar admin"
                onChange={(event) =>
                  setNewRole(event.target.checked ? "admin" : "member")
                }
              />
              Tornar admin (vê tudo)
            </label>
            <Button
              className="shrink-0"
              variant="neon"
              disabled={creating || !newName.trim() || !newPassword}
              type="submit"
            >
              {creating ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Criar
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
              Carregando…
            </p>
          ) : users.length === 0 ? (
            <p className="py-6 text-center text-sm text-[color:var(--muted)]">
              Nenhum usuário ainda.
            </p>
          ) : (
            users.map((user) => {
              const isSelf = user.username === currentUsername;
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                      {user.username}
                      {isSelf ? (
                        <span className="ml-2 text-xs font-normal text-[color:var(--muted)]">
                          (você)
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
                      {user.role === "admin" ? "Administrador" : "Membro"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {user.twoFactorEnabled ? (
                      <button
                        className="rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
                        type="button"
                        onClick={() => resetUserTwoFactor(user)}
                      >
                        Resetar 2FA
                      </button>
                    ) : null}
                    <Button
                      aria-label={`Remover ${user.username}`}
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
              Sessões ativas
            </h3>
          </div>
          {sessions.length === 0 ? (
            <p className="rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3.5 py-3 text-xs text-[color:var(--muted)]">
              Nenhuma sessão ativa.
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
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                        {user.username}
                        <span className="ml-2 text-xs font-normal text-[color:var(--muted)]">
                          {list.length} sessã{list.length === 1 ? "o" : "es"}
                        </span>
                      </p>
                      <button
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-red-300/80 transition hover:bg-red-500/10 hover:text-red-200"
                        type="button"
                        onClick={() => endAllSessions(user)}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sair de todos
                      </button>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {list.map((session) => (
                        <li
                          key={session.sessionId}
                          className="flex items-center justify-between gap-3 rounded-lg bg-[color:var(--surface-soft)] px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-[color:var(--text)]">
                              {deviceLabel(session.userAgent)}
                              {session.current ? (
                                <span className="ml-2 text-[color:var(--accent)]">
                                  este dispositivo
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate text-[11px] text-[color:var(--muted)]">
                              ativo {relativeTime(session.lastSeenAt)}
                            </p>
                          </div>
                          <button
                            aria-label="Encerrar sessão"
                            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[color:var(--muted)] transition hover:bg-red-500/10 hover:text-red-200"
                            type="button"
                            onClick={() => endSession(session)}
                          >
                            Encerrar
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
        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--field)] p-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[color:var(--text)]">
              Backup completo
            </p>
            <p className="text-xs text-[color:var(--muted)]">
              Baixa todos os grupos e contas. Guarde em local seguro.
            </p>
          </div>
          <button
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3.5 text-sm font-semibold text-[color:var(--text)] transition hover:border-[color:var(--accent-border)] hover:bg-[color:var(--field-hover)]"
            type="button"
            onClick={downloadBackup}
          >
            <Download className="h-4 w-4" />
            Baixar
          </button>
        </div>

        {/* Activity log: recent security-relevant events (who did what, when).
            Contains no secrets — just actions, targets and timestamps. */}
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2.5">
            <ScrollText className="h-4 w-4 text-[color:var(--accent)]" />
            <h3 className="text-sm font-semibold text-[color:var(--text)]">
              Registro de atividade
            </h3>
          </div>
          {events.length === 0 ? (
            <p className="rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3.5 py-3 text-xs text-[color:var(--muted)]">
              Nenhuma atividade registrada.
            </p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] p-2">
              {events.map((event, index) => (
                <li
                  key={`${event.ts}-${index}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-[color:var(--surface-soft)] px-2.5 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-[color:var(--text)]">
                      {auditActionLabel(event.action)}
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
                    {new Date(event.ts).toLocaleString("pt-BR")}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
