import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  adminRequest,
  type AdminAccount,
  type AdminVault,
  type DataPayload,
} from "../api";
import type { WithReauth } from "../AdminApp";

// Aba "Dados armazenados": navegador de usuários -> grupos -> contas. Senhas
// nunca chegam mascaradas do servidor; revelar uma passa pelo endpoint /secret
// (reauth + auditado). Editar/excluir reusa as rotas que o superadmin herda.

export function DataTab({ withReauth }: { withReauth: WithReauth }) {
  const [data, setData] = useState<DataPayload | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{
    groupId: string;
    account: AdminAccount;
  } | null>(null);

  async function reload() {
    try {
      setData(await adminRequest<DataPayload>("/api/admin-panel/data"));
    } catch {
      setError("Falha ao carregar os dados.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data)
    return <p className="text-sm text-[color:var(--muted)]">Carregando…</p>;

  const needle = query.trim().toLowerCase();

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[color:var(--text)]">
            Dados armazenados
          </h1>
          <p className="text-sm text-[color:var(--muted)]">
            {data.vaults.length} cofre(s). Senhas reveladas sob reauth e
            registradas na auditoria.
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar conta, e-mail, plataforma…"
          className="admin-input w-full sm:w-72"
        />
      </header>

      {data.vaults.map((vault) => (
        <VaultBlock
          key={vault.userId}
          vault={vault}
          needle={needle}
          withReauth={withReauth}
          onChanged={reload}
          onEdit={(groupId, account) => setEditing({ groupId, account })}
        />
      ))}

      {editing ? (
        <EditAccountModal
          groupId={editing.groupId}
          account={editing.account}
          withReauth={withReauth}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}

function VaultBlock({
  vault,
  needle,
  withReauth,
  onChanged,
  onEdit,
}: {
  vault: AdminVault;
  needle: string;
  withReauth: WithReauth;
  onChanged: () => void;
  onEdit: (groupId: string, account: AdminAccount) => void;
}) {
  const [open, setOpen] = useState(true);
  const totalAccounts = vault.groups.reduce((n, g) => n + g.accounts.length, 0);

  return (
    <section className="admin-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-[color:var(--field-hover)]"
      >
        <span className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-[color:var(--muted)]" />
          ) : (
            <ChevronRight className="h-4 w-4 text-[color:var(--muted)]" />
          )}
          <span className="text-sm font-semibold text-[color:var(--text)]">
            {vault.username}
          </span>
          <span className="rounded-[4px] border border-[color:var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[color:var(--muted)]">
            {vault.role}
          </span>
        </span>
        <span className="text-xs tabular-nums text-[color:var(--muted)]">
          {vault.groups.length} grupo(s) · {totalAccounts} conta(s)
        </span>
      </button>

      {open ? (
        <div className="border-t border-[color:var(--border)]">
          {vault.groups.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[color:var(--muted)]">
              Sem grupos.
            </p>
          ) : (
            vault.groups.map((group) => {
              const accounts = needle
                ? group.accounts.filter((a) =>
                    [a.label, a.platform, a.email, a.username, a.role]
                      .join(" ")
                      .toLowerCase()
                      .includes(needle),
                  )
                : group.accounts;
              if (needle && accounts.length === 0) return null;
              return (
                <div key={group.id} className="px-3 py-2">
                  <p className="px-1 py-1 text-xs font-semibold text-[color:var(--muted)]">
                    {group.name}{" "}
                    <span className="font-normal">({accounts.length})</span>
                  </p>
                  <div className="space-y-1">
                    {accounts.map((account) => (
                      <AccountRow
                        key={account.id}
                        groupId={group.id}
                        account={account}
                        withReauth={withReauth}
                        onChanged={onChanged}
                        onEdit={() => onEdit(group.id, account)}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </section>
  );
}

function AccountRow({
  groupId,
  account,
  withReauth,
  onChanged,
  onEdit,
}: {
  groupId: string;
  account: AdminAccount;
  withReauth: WithReauth;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    if (secret !== null) {
      setSecret(null);
      return;
    }
    setBusy(true);
    try {
      const data = await withReauth(() =>
        adminRequest<{ password: string }>(
          `/api/groups/${encodeURIComponent(groupId)}/accounts/${encodeURIComponent(account.id)}/secret`,
        ),
      );
      setSecret(data.password);
    } catch {
      // silencioso: reauth cancelado ou erro de rede
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(`Excluir a conta "${account.label || account.platform}"?`)
    )
      return;
    try {
      await withReauth(() =>
        adminRequest(
          `/api/groups/${encodeURIComponent(groupId)}/accounts/${encodeURIComponent(account.id)}`,
          { method: "DELETE" },
        ),
      );
      onChanged();
    } catch {
      /* cancelado/erro */
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-[6px] border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[color:var(--text)]">
          {account.label || account.platform || "—"}
          <span className="ml-2 rounded-[4px] border border-[color:var(--border)] px-1.5 py-0.5 text-[10px] uppercase text-[color:var(--muted)]">
            {account.status}
          </span>
        </p>
        <p className="truncate text-xs text-[color:var(--muted)]">
          {account.username || account.email || "sem identificador"}
          {secret !== null ? (
            <span className="ml-2 font-mono text-[color:var(--accent)]">
              {secret || "(vazia)"}
            </span>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={busy || !account.hasPassword}
          onClick={reveal}
          title={account.hasPassword ? "Revelar senha" : "Sem senha"}
          className="admin-icon-btn disabled:opacity-30"
        >
          {secret !== null ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={onEdit}
          title="Editar"
          className="admin-icon-btn"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={remove}
          title="Excluir"
          className="admin-icon-btn hover:text-red-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const STATUSES = ["active", "review", "archived", "inactive"];

function EditAccountModal({
  groupId,
  account,
  withReauth,
  onClose,
  onSaved,
}: {
  groupId: string;
  account: AdminAccount;
  withReauth: WithReauth;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    label: account.label,
    platform: account.platform,
    username: account.username,
    email: account.email,
    status: account.status,
    password: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      // Envia o registro completo; senha vazia = mantém a atual (o servidor
      // trata "" como inalterada).
      await withReauth(() =>
        adminRequest(
          `/api/groups/${encodeURIComponent(groupId)}/accounts/${encodeURIComponent(account.id)}`,
          {
            method: "PUT",
            body: JSON.stringify({ ...account, ...form }),
          },
        ),
      );
      onSaved();
    } catch {
      setError("Não foi possível salvar.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-[color:var(--overlay)] p-4 backdrop-blur-sm">
      <form onSubmit={save} className="admin-card w-full max-w-md p-5">
        <h2 className="mb-4 text-base font-semibold text-[color:var(--text)]">
          Editar conta
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Rótulo">
            <input
              className="admin-input w-full"
              value={form.label}
              onChange={(e) => set("label", e.target.value)}
            />
          </Field>
          <Field label="Plataforma">
            <input
              className="admin-input w-full"
              value={form.platform}
              onChange={(e) => set("platform", e.target.value)}
            />
          </Field>
          <Field label="Usuário">
            <input
              className="admin-input w-full"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
            />
          </Field>
          <Field label="E-mail">
            <input
              className="admin-input w-full"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </Field>
          <Field label="Status">
            <select
              className="admin-input w-full"
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nova senha (opcional)">
            <input
              type="text"
              className="admin-input w-full font-mono"
              placeholder="Deixe vazio p/ manter"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </Field>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-[6px] border border-[color:var(--border)] bg-[color:var(--field)] text-sm font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="admin-btn-primary h-10 flex-1"
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-medium text-[color:var(--muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}
