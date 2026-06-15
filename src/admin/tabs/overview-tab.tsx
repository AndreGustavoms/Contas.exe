import { useEffect, useState } from "react";
import { adminRequest, type Overview } from "../api";

// Aba "Visão geral": métricas e status do site. Somente leitura.

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="admin-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-[color:var(--text)]">
        {value}
      </p>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-[color:var(--border)] py-2 last:border-0">
      <span className="text-sm text-[color:var(--text)]">{label}</span>
      <span
        className={`flex items-center gap-1.5 text-xs font-medium ${
          ok ? "text-[color:var(--accent)]" : "text-[color:var(--muted)]"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            ok ? "bg-[color:var(--accent)]" : "bg-[color:var(--muted)]"
          }`}
        />
        {ok ? "Ativo" : "Inativo"}
      </span>
    </div>
  );
}

export function OverviewTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    adminRequest<Overview>("/api/admin-panel/overview")
      .then(setData)
      .catch(() => setError("Falha ao carregar a visão geral."));
  }, []);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!data)
    return <p className="text-sm text-[color:var(--muted)]">Carregando…</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-[color:var(--text)]">
          Visão geral
        </h1>
        <p className="text-sm text-[color:var(--muted)]">
          Estado atual do site em tempo real.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Usuários" value={data.users.total} />
        <Stat label="Admins" value={data.users.admins} />
        <Stat label="Membros" value={data.users.members} />
        <Stat label="Com 2FA" value={data.users.withTwoFactor} />
        <Stat label="Grupos" value={data.vaults.groups} />
        <Stat label="Contas" value={data.vaults.accounts} />
        <Stat label="Sessões ativas" value={data.sessions.active} />
        <Stat label="Eventos 24h" value={data.audit.recent24h} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="admin-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-[color:var(--text)]">
            Segurança & integrações
          </h2>
          <StatusRow
            label="Criptografia em repouso"
            ok={data.system.encryptionEnabled}
          />
          <StatusRow label="Login Google" ok={data.system.providers.google} />
          <StatusRow label="Login GitHub" ok={data.system.providers.github} />
          <StatusRow
            label="Registro aberto ao público"
            ok={data.system.registrationsOpen}
          />
        </div>

        <div className="admin-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-[color:var(--text)]">
            Sistema
          </h2>
          <div className="flex items-center justify-between border-b border-[color:var(--border)] py-2">
            <span className="text-sm text-[color:var(--text)]">
              Tempo no ar
            </span>
            <span className="text-xs font-medium tabular-nums text-[color:var(--muted)]">
              {formatUptime(data.system.uptimeSeconds)}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-[color:var(--border)] py-2">
            <span className="text-sm text-[color:var(--text)]">Node.js</span>
            <span className="text-xs font-medium tabular-nums text-[color:var(--muted)]">
              {data.system.nodeVersion}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-[color:var(--text)]">
              Eventos de auditoria
            </span>
            <span className="text-xs font-medium tabular-nums text-[color:var(--muted)]">
              {data.audit.total}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
