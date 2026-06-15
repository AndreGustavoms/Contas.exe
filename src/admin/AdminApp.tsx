import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Database,
  LayoutDashboard,
  Lock,
  LogOut,
  ScrollText,
  ShieldAlert,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { LocalLogin } from "../components/local-login";
import { ThemeToggle } from "../components/theme-toggle";
import { type AppTheme, isAppTheme, THEME_STORAGE_KEY } from "../theme";
import { adminRequest, isReauthRequired } from "./api";
import { OverviewTab } from "./tabs/overview-tab";
import { DataTab } from "./tabs/data-tab";
import { UsersTab } from "./tabs/users-tab";
import { AuditTab } from "./tabs/audit-tab";

// Painel superadmin, montado SOMENTE na rota /admin (ver main.tsx). É um app
// separado do principal: tem seu próprio gate. A barreira real é o servidor —
// toda rota /api/admin-panel/* exige papel superadmin (senão 404) + reauth. Aqui
// o gate de UI espelha isso para não vazar nada: sem sessão -> login; sessão sem
// superadmin -> tela 404 (selado); superadmin -> reauth obrigatório -> painel.

type Phase = "checking" | "login" | "denied" | "reauth" | "ready";
type TabKey = "overview" | "data" | "users" | "audit";

const TABS: { key: TabKey; labelKey: string; icon: typeof LayoutDashboard }[] =
  [
    { key: "overview", labelKey: "admin.tabs.overview", icon: LayoutDashboard },
    { key: "data", labelKey: "admin.tabs.data", icon: Database },
    { key: "users", labelKey: "admin.tabs.users", icon: Users },
    { key: "audit", labelKey: "admin.tabs.audit", icon: ScrollText },
  ];

export type WithReauth = <T>(action: () => Promise<T>) => Promise<T>;

export default function AdminApp() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof window === "undefined") return "white";
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isAppTheme(stored) ? stored : "white";
  });
  const [phase, setPhase] = useState<Phase>("checking");
  const [username, setUsername] = useState("");
  const [tab, setTab] = useState<TabKey>("overview");

  // Estado do modal de reauth (lapsos no meio da sessão; ver withReauth).
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthError, setReauthError] = useState("");
  const reauthResolverRef = useRef<((ok: boolean) => void) | null>(null);
  const reauthPromiseRef = useRef<Promise<boolean> | null>(null);

  function changeTheme(next: AppTheme) {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    setTheme(next);
  }

  // Descobre o papel via /api/auth/status e decide a fase.
  const resolveAccess = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/status");
      const data = (await res.json()) as {
        authenticated?: boolean;
        user?: { username: string; role: string } | null;
      };
      if (!data.authenticated || !data.user) {
        setPhase("login");
        return;
      }
      setUsername(data.user.username);
      if (data.user.role !== "superadmin") {
        setPhase("denied");
        return;
      }
      setPhase("reauth");
    } catch {
      setPhase("login");
    }
  }, []);

  useEffect(() => {
    void resolveAccess();
  }, [resolveAccess]);

  // ----- Reauth (modal de meio de sessão) -----
  function promptReauth(): Promise<boolean> {
    if (reauthPromiseRef.current) return reauthPromiseRef.current;
    setReauthError("");
    setReauthOpen(true);
    const promise = new Promise<boolean>((resolve) => {
      reauthResolverRef.current = resolve;
    });
    reauthPromiseRef.current = promise;
    return promise;
  }

  function settleReauth(ok: boolean) {
    setReauthOpen(false);
    const resolve = reauthResolverRef.current;
    reauthResolverRef.current = null;
    reauthPromiseRef.current = null;
    if (resolve) resolve(ok);
  }

  async function submitReauth(password: string) {
    setReauthError("");
    try {
      await adminRequest("/api/auth/reauth", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      settleReauth(true);
    } catch {
      setReauthError(t("admin.reauth.incorrect_password"));
    }
  }

  // Executa uma ação crítica; em 403 reauth_required abre o modal e tenta de novo
  // uma vez. Compartilhado com as abas via prop.
  const withReauth: WithReauth = useCallback(async (action) => {
    try {
      return await action();
    } catch (error) {
      if (!isReauthRequired(error)) throw error;
      const ok = await promptReauth();
      if (!ok) throw error;
      return action();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function leave() {
    // Sai do painel e da sessão, depois volta ao app principal.
    fetch("/api/auth/logout", { method: "POST" }).finally(() => {
      window.location.href = "/";
    });
  }

  const rootClass = `theme-${theme} admin-root min-h-screen w-full`;

  if (phase === "checking") {
    return <div className={rootClass} />;
  }

  // Sem sessão: login do app (trata 2FA etc.). Após logar, reavalia o papel.
  if (phase === "login") {
    return (
      <div className={rootClass}>
        <div className="fixed right-4 top-4 z-[100]">
          <ThemeToggle value={theme} onChange={changeTheme} />
        </div>
        <LocalLogin
          theme={theme}
          onUnlock={() => {
            setPhase("checking");
            void resolveAccess();
          }}
          onForgotPassword={() => {
            window.location.href = "/";
          }}
          onRegister={() => {
            window.location.href = "/";
          }}
        />
      </div>
    );
  }

  // Logado mas não é superadmin: resposta SELADA (404 genérico). Não revela o
  // painel nem que o acesso foi negado por papel.
  if (phase === "denied") {
    return (
      <div
        className={`${rootClass} flex flex-col items-center justify-center gap-3 px-6 text-center`}
      >
        <p className="text-6xl font-bold text-[color:var(--muted)]">404</p>
        <p className="text-sm text-[color:var(--muted)]">
          {t("admin.not_found")}
        </p>
        <a
          href="/"
          className="mt-2 text-sm font-medium text-[color:var(--accent)] hover:underline"
        >
          {t("admin.back")}
        </a>
      </div>
    );
  }

  // Superadmin confirmado: reauth obrigatório para abrir o painel.
  if (phase === "reauth") {
    return (
      <div
        className={`${rootClass} flex items-center justify-center px-4 py-10`}
      >
        <div className="fixed right-4 top-4 z-[100]">
          <ThemeToggle value={theme} onChange={changeTheme} />
        </div>
        <ReauthGate
          username={username}
          onConfirm={async (password) => {
            try {
              await adminRequest("/api/auth/reauth", {
                method: "POST",
                body: JSON.stringify({ password }),
              });
              setPhase("ready");
              return "";
            } catch {
              return t("admin.reauth.incorrect_password");
            }
          }}
          onCancel={leave}
        />
      </div>
    );
  }

  // ----- Painel -----
  return (
    <div className={`${rootClass} flex flex-col lg:flex-row`}>
      {/* Sidebar / topo */}
      <aside className="flex shrink-0 flex-col gap-1 border-b border-[color:var(--border)] bg-[color:var(--sidebar)] p-3 lg:h-screen lg:w-60 lg:border-b-0 lg:border-r">
        <div className="mb-3 flex items-center gap-2 px-1.5 py-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] text-[color:var(--accent)]">
            <ShieldAlert className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[color:var(--text)]">
              {t("admin.panel")}
            </p>
            <p className="truncate text-[11px] text-[color:var(--muted)]">
              {t("admin.superadmin_user", { username })}
            </p>
          </div>
        </div>

        <nav className="flex gap-1 lg:flex-col">
          {TABS.map(({ key, labelKey, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`admin-tab ${tab === key ? "admin-tab-active" : ""}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="mt-auto hidden gap-2 lg:flex lg:flex-col">
          <ThemeToggle value={theme} onChange={changeTheme} />
          <button
            type="button"
            onClick={leave}
            className="flex h-10 items-center justify-center gap-2 rounded-[6px] border border-[color:var(--border)] bg-[color:var(--field)] px-3 text-sm font-medium text-[color:var(--muted)] transition hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
          >
            <LogOut className="h-4 w-4" />
            {t("admin.leave_panel")}
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:h-screen">
        <div className="mx-auto w-full max-w-5xl">
          {tab === "overview" && <OverviewTab />}
          {tab === "data" && <DataTab withReauth={withReauth} />}
          {tab === "users" && (
            <UsersTab withReauth={withReauth} currentUsername={username} />
          )}
          {tab === "audit" && <AuditTab />}
        </div>
      </main>

      {reauthOpen ? (
        <ReauthOverlay
          error={reauthError}
          onCancel={() => settleReauth(false)}
          onSubmit={submitReauth}
        />
      ) : null}
    </div>
  );
}

// Gate de entrada: card centralizado pedindo a senha antes de abrir o painel.
function ReauthGate({
  username,
  onConfirm,
  onCancel,
}: {
  username: string;
  onConfirm: (password: string) => Promise<string>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const err = await onConfirm(password);
    setBusy(false);
    setError(err);
    if (!err) setPassword("");
  }

  return (
    <form onSubmit={submit} className="admin-card w-full max-w-sm p-6">
      <div className="mb-4 flex items-center gap-2 text-[color:var(--accent)]">
        <Lock className="h-5 w-5" />
        <h1 className="text-lg font-semibold text-[color:var(--text)]">
          {t("admin.reauth.confirm_identity")}
        </h1>
      </div>
      <p className="mb-4 text-sm text-[color:var(--muted)]">
        {t("admin.reauth.owner_only_prefix")}{" "}
        <span className="font-medium text-[color:var(--text)]">{username}</span>{" "}
        {t("admin.reauth.owner_only_suffix")}
      </p>
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("admin.reauth.password")}
        className="admin-input mb-3 w-full"
      />
      {error ? (
        <p className="mb-3 text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-10 flex-1 rounded-[6px] border border-[color:var(--border)] bg-[color:var(--field)] text-sm font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
        >
          {t("admin.reauth.exit")}
        </button>
        <button
          type="submit"
          disabled={busy || !password}
          className="admin-btn-primary h-10 flex-1"
        >
          {busy ? t("admin.reauth.verifying") : t("admin.reauth.open_panel")}
        </button>
      </div>
    </form>
  );
}

// Modal de reauth para lapsos no meio da sessão (sobreposição).
function ReauthOverlay({
  error,
  onCancel,
  onSubmit,
}: {
  error: string;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[color:var(--overlay)] p-4 backdrop-blur-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(password);
        }}
        className="admin-card w-full max-w-sm p-6"
      >
        <div className="mb-3 flex items-center gap-2 text-[color:var(--accent)]">
          <Lock className="h-5 w-5" />
          <h2 className="text-base font-semibold text-[color:var(--text)]">
            {t("admin.reauth.reconfirm_password")}
          </h2>
        </div>
        <p className="mb-3 text-sm text-[color:var(--muted)]">
          {t("admin.reauth.recent_required")}
        </p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("admin.reauth.password")}
          className="admin-input mb-3 w-full"
        />
        {error ? (
          <p className="mb-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 flex-1 rounded-[6px] border border-[color:var(--border)] bg-[color:var(--field)] text-sm font-medium text-[color:var(--muted)] transition hover:text-[color:var(--text)]"
          >
            {t("admin.cancel")}
          </button>
          <button
            type="submit"
            disabled={!password}
            className="admin-btn-primary h-10 flex-1"
          >
            {t("admin.confirm")}
          </button>
        </div>
      </form>
    </div>
  );
}
