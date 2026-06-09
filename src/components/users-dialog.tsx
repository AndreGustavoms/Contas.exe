import { type FormEvent, useEffect, useState } from "react";
import { Download, Shield, Trash2, UserPlus, X } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { Switch } from "./ui/switch";

// Admin-only panel to manage the people who can log in. Talks to the
// /api/users endpoints (all admin-gated server-side). Members never see this.

type ManagedUser = {
  id: string;
  username: string;
  role: "admin" | "member";
  createdAt: string;
};

type UsersDialogProps = {
  // The current admin's username, so we can prevent self-deletion in the UI.
  currentUsername: string;
  onClose: () => void;
};

const API_USERS = "/api/users";

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

export function UsersDialog({ currentUsername, onClose }: UsersDialogProps) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "member">("member");
  const [creating, setCreating] = useState(false);

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

  useEffect(() => {
    void loadUsers();
    // loadUsers is stable enough for a one-shot mount load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setCreating(true);
    try {
      await requestJson<ManagedUser>(API_USERS, {
        method: "POST",
        body: JSON.stringify({
          username: newName.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      setNewName("");
      setNewPassword("");
      setNewRole("member");
      await loadUsers();
    } catch (err) {
      setError(labelForError(err instanceof Error ? err.message : "invalid"));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(user: ManagedUser) {
    setError("");
    try {
      await requestJson(`${API_USERS}/${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      await loadUsers();
    } catch (err) {
      setError(labelForError(err instanceof Error ? err.message : "invalid"));
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
                    </p>
                    <p className="text-xs text-[color:var(--muted)]">
                      {user.role === "admin" ? "Administrador" : "Membro"}
                    </p>
                  </div>
                  <Button
                    aria-label={`Remover ${user.username}`}
                    className={cn(
                      "shrink-0",
                      isSelf && "pointer-events-none opacity-40",
                    )}
                    disabled={isSelf}
                    size="icon"
                    variant="ghost"
                    onClick={() => handleDelete(user)}
                  >
                    <Trash2 className="h-4 w-4 text-red-300" />
                  </Button>
                </div>
              );
            })
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
          <a
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3.5 text-sm font-semibold text-[color:var(--text)] transition hover:border-[color:var(--accent-border)] hover:bg-[color:var(--field-hover)]"
            href="/api/admin/backup"
          >
            <Download className="h-4 w-4" />
            Baixar
          </a>
        </div>
      </section>
    </div>
  );
}
