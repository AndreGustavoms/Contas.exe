import { type FormEvent, useEffect, useState } from "react";
import { KeyRound, LogOut, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { adminRequest, type AdminUser, type ManagedSession } from "../api";
import type { WithReauth } from "../AdminApp";

// Aba "Usuários & sessões": gestão de pessoas e sessões ativas. Reusa as rotas
// admin (/api/users, /api/sessions) que o superadmin herda. O próprio dono
// (superadmin) aparece protegido — sem ações destrutivas sobre ele.

export function UsersTab({
  withReauth,
  currentUsername,
}: {
  withReauth: WithReauth;
  currentUsername: string;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sessions, setSessions] = useState<ManagedSession[]>([]);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [creating, setCreating] = useState(false);

  async function reload() {
    try {
      const [u, s] = await Promise.all([
        adminRequest<{ users: AdminUser[] }>("/api/users"),
        adminRequest<{ sessions: ManagedSession[] }>("/api/sessions"),
      ]);
      setUsers(u.users);
      setSessions(s.sessions);
    } catch {
      setError("Falha ao carregar usuários/sessões.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await withReauth(() =>
        adminRequest("/api/users", {
          method: "POST",
          body: JSON.stringify({ username: name.trim(), password, role }),
        }),
      );
      setName("");
      setPassword("");
      setRole("member");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar.");
    } finally {
      setCreating(false);
    }
  }

  async function removeUser(u: AdminUser) {
    if (!window.confirm(`Remover o usuário "${u.username}"?`)) return;
    setError("");
    try {
      await withReauth(() =>
        adminRequest(`/api/users/${encodeURIComponent(u.id)}`, {
          method: "DELETE",
        }),
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao remover.");
    }
  }

  async function resetPassword(u: AdminUser) {
    const pw = window.prompt(`Nova senha para "${u.username}":`);
    if (!pw) return;
    setError("");
    try {
      await withReauth(() =>
        adminRequest(`/api/users/${encodeURIComponent(u.id)}/password`, {
          method: "PUT",
          body: JSON.stringify({ password: pw }),
        }),
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao redefinir.");
    }
  }

  async function reset2fa(u: AdminUser) {
    if (!window.confirm(`Resetar o 2FA de "${u.username}"?`)) return;
    setError("");
    try {
      await withReauth(() =>
        adminRequest(`/api/users/${encodeURIComponent(u.id)}/2fa/reset`, {
          method: "POST",
        }),
      );
      await reload();
    } catch {
      setError("Erro ao resetar 2FA.");
    }
  }

  async function revokeSession(sid: string) {
    try {
      await adminRequest(`/api/sessions/${encodeURIComponent(sid)}`, {
        method: "DELETE",
      });
      await reload();
    } catch {
      setError("Erro ao encerrar sessão.");
    }
  }

  async function revokeAll(u: AdminUser) {
    try {
      await withReauth(() =>
        adminRequest(`/api/users/${encodeURIComponent(u.id)}/sessions/revoke`, {
          method: "POST",
        }),
      );
      await reload();
    } catch {
      /* cancelado */
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[color:var(--text)]">
          Usuários & sessões
        </h1>
        <p className="text-sm text-[color:var(--muted)]">
          {users.length} usuário(s) · {sessions.length} sessão(ões) ativa(s).
        </p>
      </header>

      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {/* Criar usuário */}
      <form
        onSubmit={createUser}
        className="admin-card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end"
      >
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-[color:var(--muted)]">
            Usuário
          </span>
          <input
            className="admin-input w-full"
            value={name}
            minLength={2}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-[color:var(--muted)]">
            Senha
          </span>
          <input
            className="admin-input w-full"
            type="text"
            value={password}
            minLength={8}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-medium text-[color:var(--muted)]">
            Papel
          </span>
          <select
            className="admin-input"
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={creating || !name.trim() || !password}
          className="admin-btn-primary h-[42px] gap-2"
        >
          <UserPlus className="h-4 w-4" />
          Criar
        </button>
      </form>

      {/* Lista de usuários */}
      <div className="space-y-2">
        {users.map((u) => {
          const isSelf = u.username === currentUsername;
          const isOwner = u.role === "superadmin";
          const userSessions = sessions.filter((s) => s.userId === u.id);
          return (
            <div key={u.id} className="admin-card p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[color:var(--text)]">
                    {u.username}
                    <span className="ml-2 rounded-[4px] border border-[color:var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[color:var(--muted)]">
                      {u.role}
                    </span>
                    {u.twoFactorEnabled ? (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-[color:var(--accent)]">
                        <ShieldCheck className="h-3 w-3" />
                        2FA
                      </span>
                    ) : null}
                    {isSelf ? (
                      <span className="ml-2 text-[10px] text-[color:var(--muted)]">
                        (você)
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-[color:var(--muted)]">
                    {u.email ?? "sem e-mail"} · {userSessions.length}{" "}
                    sessão(ões)
                  </p>
                </div>
                {isOwner ? (
                  <span className="text-[11px] text-[color:var(--muted)]">
                    conta protegida
                  </span>
                ) : (
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {userSessions.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => revokeAll(u)}
                        className="admin-chip-btn"
                        title="Encerrar todas as sessões"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Sessões
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => resetPassword(u)}
                      className="admin-chip-btn"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Senha
                    </button>
                    {u.twoFactorEnabled ? (
                      <button
                        type="button"
                        onClick={() => reset2fa(u)}
                        className="admin-chip-btn"
                      >
                        2FA
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={isSelf}
                      onClick={() => removeUser(u)}
                      className="admin-icon-btn hover:text-red-400 disabled:opacity-30"
                      title="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              {userSessions.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t border-[color:var(--border)] pt-2">
                  {userSessions.map((s) => (
                    <li
                      key={s.sessionId}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="truncate text-[color:var(--muted)]">
                        {shortUa(s.userAgent)}
                        {s.current ? (
                          <span className="ml-2 text-[color:var(--accent)]">
                            este dispositivo
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        onClick={() => revokeSession(s.sessionId)}
                        className="shrink-0 rounded-[4px] px-2 py-0.5 text-[color:var(--muted)] transition hover:text-red-400"
                      >
                        encerrar
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function shortUa(ua: string): string {
  if (!ua) return "dispositivo desconhecido";
  const browser = /Edg/.test(ua)
    ? "Edge"
    : /Chrome/.test(ua)
      ? "Chrome"
      : /Firefox/.test(ua)
        ? "Firefox"
        : /Safari/.test(ua)
          ? "Safari"
          : "navegador";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} · ${os}` : browser;
}
