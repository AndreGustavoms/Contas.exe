import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Filter,
  FolderPlus,
  Globe,
  Layers,
  Copy,
  KeyRound,
  Settings,
  Trash,
  UserCog,
  Users,
  Mail,
  Pencil,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  type AccountDraft,
  type AccountRecord,
  type AccountStatus,
  emptyAccountDraft,
  platformOptions,
  roleOptions,
  statusLabel,
} from "../data/credential-records";
import type { SessionUser } from "../App";
import { cn } from "../lib/utils";
import { type AppTheme } from "../theme";
import {
  FacebookIcon,
  InstagramIcon,
  KwaiIcon,
  TikTokIcon,
  YouTubeIcon,
} from "./platform-icons";
import { Badge } from "./ui/badge";
import { Spinner } from "./ui/spinner";
import { Toast } from "./ui/toast";
import { UsersDialog } from "./users-dialog";
import { AccountSettings } from "./account-settings";
import { Button } from "./ui/button";
import { ThemeToggle } from "./theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";

// Account data is NEVER cached in the browser: it holds secrets (passwords,
// recovery emails, phones, notes) and persisting it to localStorage would leak
// them to anyone with access to the machine. The API is the source of truth and
// is fetched fresh on each mount. We only remember the (non-secret) selected
// group id, namespaced per user so a shared browser doesn't bleed one teammate's
// choice into the next. "anon" is only used before login resolves.
function activeGroupKey(username: string | undefined) {
  return `contas_exe.activeGroup.v1:${username || "anon"}`;
}
const API_GROUPS = "/api/groups";
const ALL = "all";
// A revealed password re-hides itself after this long so it doesn't linger on
// screen (shoulder-surfing / abandoned tab).
const REVEAL_TIMEOUT_MS = 15_000;
// A copied secret is wiped from the clipboard after this long (best-effort: only
// works while this tab still owns the clipboard and stays focused).
const CLIPBOARD_CLEAR_MS = 20_000;

type GroupSummary = {
  id: string;
  name: string;
  ownerId: string;
  count: number;
};

// Picks which group to make active given the visible groups and the last choice
// remembered in localStorage: prefer the remembered one if still visible, else
// the first group, else "" (no groups yet).
function pickActiveGroup(groups: GroupSummary[], preferredId: string): string {
  if (preferredId && groups.some((group) => group.id === preferredId)) {
    return preferredId;
  }
  return groups[0]?.id ?? "";
}

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "grupo"
  );
}

const WIZARD_STEPS = [
  "Nome",
  "Rede",
  "Função",
  "Email",
  "Usuário",
  "Senha",
  "2FA",
  "Confirmar",
];
const CONFIRM_STEP = WIZARD_STEPS.length - 1;

const selectTriggerClass =
  "group flex h-10 w-full items-center justify-between gap-2 rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] px-3 text-sm font-medium text-[color:var(--text)] shadow-[inset_0_1px_0_var(--inset-light),0_16px_34px_var(--field-shadow)] outline-none backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-[color:var(--accent-border)] hover:bg-[color:var(--field-hover)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--focus-ring)]";

const textCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

type GlyphIcon = (props: {
  className?: string;
  style?: CSSProperties;
}) => ReactNode;

type PlatformMeta = {
  // Exact official brand color (hex). Used as the glyph color and glow tint.
  color: string;
  // Optional CSS gradient for brands whose logo is a gradient (Instagram).
  gradient?: string;
  // When true the glyph background is painted solid (not a faint tint) so
  // multi-color marks like TikTok keep their contrast on any theme.
  solidBackground?: boolean;
  icon: GlyphIcon;
};

const defaultPlatformMeta: PlatformMeta = {
  color: "#22d3ee",
  icon: Globe,
};

const platformMeta: Record<string, PlatformMeta> = {
  YouTube: {
    color: "#FF0000",
    icon: YouTubeIcon,
  },
  Instagram: {
    color: "#E1306C",
    gradient:
      "linear-gradient(45deg,#F58529 0%,#FEDA77 20%,#DD2A7B 50%,#8134AF 75%,#515BD4 100%)",
    icon: InstagramIcon,
  },
  TikTok: {
    // Dark brand background (like the official app icon) so the cyan/magenta
    // glitch note reads correctly on the solid sidebar badge.
    color: "#111114",
    gradient: "linear-gradient(140deg,#27272b,#0a0a0c)",
    solidBackground: true,
    icon: TikTokIcon,
  },
  Facebook: {
    color: "#1877F2",
    icon: FacebookIcon,
  },
  Kwai: {
    color: "#FF6A00",
    icon: KwaiIcon,
  },
  Email: {
    color: "#3B82F6",
    icon: Mail,
  },
  Estrela: {
    color: "#FBBF24",
    icon: SharpStarIcon,
  },
};

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `account-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Error carrying the HTTP status and the server's `error` code, so callers can
// branch on specific failures (notably 403 reauth_required).
class RequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code || "request_failed");
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new RequestError(response.status, body.error ?? "request_failed");
  }

  return response.json() as Promise<T>;
}

// Recognizes a reauth_required failure. Matches our RequestError.code and also a
// plain Error whose message is the code (the users-dialog uses its own thin
// requestJson that throws Error(body.error)).
function isReauthRequired(error: unknown): boolean {
  if (error instanceof RequestError) return error.code === "reauth_required";
  return error instanceof Error && error.message === "reauth_required";
}

function isAccountStatus(value: unknown): value is AccountStatus {
  return (
    value === "active" ||
    value === "review" ||
    value === "archived" ||
    value === "inactive"
  );
}

function isAccountRecord(value: unknown): value is AccountRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<AccountRecord>;

  return (
    typeof record.id === "string" &&
    typeof record.platform === "string" &&
    typeof record.role === "string" &&
    typeof record.owner === "string" &&
    typeof record.label === "string" &&
    typeof record.email === "string" &&
    typeof record.username === "string" &&
    typeof record.password === "string" &&
    typeof record.recoveryEmail === "string" &&
    typeof record.phone === "string" &&
    isAccountStatus(record.status) &&
    typeof record.twoFactor === "boolean" &&
    typeof record.postDay === "string" &&
    typeof record.niche === "string" &&
    typeof record.notes === "string" &&
    typeof record.updatedAt === "string"
  );
}

function toDraft(account: AccountRecord): AccountDraft {
  return {
    platform: normalizeLegacyOption(account.platform, "Estrela"),
    role: normalizeLegacyOption(account.role, roleOptions[0]),
    owner: account.owner,
    label: account.label,
    email: account.email,
    username: account.username,
    password: account.password,
    recoveryEmail: account.recoveryEmail,
    phone: account.phone,
    status: account.status,
    twoFactor: account.twoFactor,
    postDay: account.postDay,
    niche: account.niche,
    notes: account.notes,
  };
}

function normalizeDraft(draft: AccountDraft): AccountDraft {
  return {
    ...draft,
    platform: normalizeLegacyOption(draft.platform, "Estrela"),
    role: normalizeLegacyOption(draft.role, roleOptions[0]),
    owner: draft.owner.trim() || "Andre",
    label: draft.label.trim(),
    email: draft.email.trim(),
    username: draft.username.trim(),
    recoveryEmail: draft.recoveryEmail.trim(),
    phone: draft.phone.trim(),
    postDay: draft.postDay.trim(),
    niche: draft.niche.trim(),
    notes: draft.notes.trim(),
  };
}

function normalizeLegacyOption(value: string, fallback: string) {
  const normalized = value.trim();

  if (!normalized) {
    return fallback;
  }

  if (["Outra", "Outro", "Outros"].includes(normalized)) {
    return "Estrela";
  }

  return normalized;
}

function migrateAccount(account: AccountRecord): AccountRecord {
  return {
    ...account,
    platform: normalizeLegacyOption(account.platform, "Estrela"),
    role: normalizeLegacyOption(account.role, roleOptions[0]),
  };
}

function titleFor(account: AccountRecord) {
  return (
    account.label ||
    account.username ||
    account.email ||
    `${account.platform} sem nome`
  );
}

function compareText(a: string, b: string) {
  return textCollator.compare(a, b);
}

function alphabetize(items: string[]) {
  return [...items].sort(compareText);
}

// Accounts are ordered alphabetically by email (primary key), then by the
// remaining fields so that accounts sharing an email keep a stable order.
function sortAccounts(accounts: AccountRecord[]) {
  return [...accounts].sort(
    (first, second) =>
      compareText(first.email, second.email) ||
      compareText(titleFor(first), titleFor(second)) ||
      compareText(first.platform, second.platform) ||
      compareText(first.role, second.role) ||
      compareText(first.username, second.username),
  );
}

function platformIconFor(platform: string) {
  return platformMeta[platform]?.icon ?? defaultPlatformMeta.icon;
}

function metaForPlatform(platform: string) {
  return platformMeta[platform] ?? defaultPlatformMeta;
}

function labelFor(options: SelectOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value;
}

type AccountVaultProps = {
  onLock?: () => void;
  onThemeChange: (theme: AppTheme) => void;
  theme: AppTheme;
  user: SessionUser | null;
};

export function AccountVault({
  onLock,
  onThemeChange,
  theme,
  user,
}: AccountVaultProps) {
  const isAdmin = user?.role === "admin";
  // Per-user key for the (non-secret) selected group. Stable for this mount; a
  // different user means a different AccountVault mount with a different key.
  const activeGroupStorageKey = activeGroupKey(user?.username);
  // Accounts start empty and are loaded from the API on mount — they are never
  // read from or written to localStorage (they carry secrets; see activeGroupKey).
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  // Re-auth modal state. When a critical action gets 403 reauth_required, we open
  // this modal; the resolver is fulfilled once the user re-authenticates so the
  // pending action can retry. `reauthError` shows a wrong-password message.
  const reauthResolverRef = useRef<((ok: boolean) => void) | null>(null);
  // The single in-flight reauth prompt, shared by concurrent callers so a second
  // request doesn't orphan the first's resolver.
  const reauthPromiseRef = useRef<Promise<boolean> | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthError, setReauthError] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string>(
    () => window.localStorage.getItem(activeGroupStorageKey) ?? "",
  );
  const [draft, setDraft] = useState<AccountDraft>(emptyAccountDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [platformFilter, setPlatformFilter] = useState(ALL);
  const [roleFilter, setRoleFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<AccountStatus | typeof ALL>(
    ALL,
  );
  const [showPassword, setShowPassword] = useState(false);
  // Whether the quick-view password is currently revealed (it starts masked).
  const [quickViewReveal, setQuickViewReveal] = useState(false);
  // The password fetched on demand from the reauth-gated /secret endpoint. Held
  // only in memory, only while revealed; never persisted.
  const [quickViewSecret, setQuickViewSecret] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [groupDialog, setGroupDialog] = useState<{
    mode: "create" | "rename";
    value: string;
  } | null>(null);
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(false);
  const [usersDialogOpen, setUsersDialogOpen] = useState(false);
  const [accountSettingsOpen, setAccountSettingsOpen] = useState(false);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState(0);
  const [quickViewAccount, setQuickViewAccount] =
    useState<AccountRecord | null>(null);
  const [message, setMessage] = useState("");
  // Transient feedback toast (success/error), separate from the inline `message`
  // used in some contextual spots.
  const [toast, setToast] = useState<{
    text: string;
    tone: "success" | "error";
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  function notify(text: string, tone: "success" | "error" = "success") {
    setToast({ text, tone });
  }

  // Stable identity so the Toast's auto-dismiss timer isn't reset on every parent
  // re-render (e.g. while typing in the search box).
  const dismissToast = useCallback(() => setToast(null), []);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  );

  // Persist the active-group choice locally whenever it changes.
  useEffect(() => {
    if (activeGroupId) {
      window.localStorage.setItem(activeGroupStorageKey, activeGroupId);
    } else {
      window.localStorage.removeItem(activeGroupStorageKey);
    }
  }, [activeGroupId, activeGroupStorageKey]);

  // Auto-hide a revealed password after a short window so it doesn't stay on
  // screen. Covers both the edit-form field and the quick-view. Re-arms on each
  // reveal; clears the timer on hide/unmount.
  useEffect(() => {
    if (!showPassword) return;
    const timer = window.setTimeout(
      () => setShowPassword(false),
      REVEAL_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [showPassword]);

  useEffect(() => {
    if (!quickViewReveal) return;
    const timer = window.setTimeout(() => {
      setQuickViewReveal(false);
      setQuickViewSecret(""); // drop the fetched secret when it re-hides
    }, REVEAL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [quickViewReveal]);

  // The quick-view always opens with the password masked and no secret loaded.
  useEffect(() => {
    setQuickViewReveal(false);
    setQuickViewSecret("");
  }, [quickViewAccount]);

  useEffect(() => {
    let ignore = false;

    async function loadGroups() {
      try {
        const data = await requestJson<{ groups: GroupSummary[] }>(API_GROUPS);

        if (ignore) {
          return;
        }

        setGroups(data.groups);
        // Keep the remembered selection if it's still visible; otherwise fall
        // back to the first group the user can see.
        setActiveGroupId((current) => pickActiveGroup(data.groups, current));
      } catch {
        setMessage("API offline");
      }
    }

    void loadGroups();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!activeGroupId) {
      // No group selected (e.g. the last group was just deleted): clear the
      // account list and its cache so stale rows from the old group don't linger.
      setAccountList([]);
      return;
    }

    let ignore = false;

    async function loadAccountsForGroup() {
      try {
        const loaded = await requestJson<AccountRecord[]>(
          `${API_GROUPS}/${encodeURIComponent(activeGroupId)}/accounts`,
        );

        if (ignore) {
          return;
        }

        setAccountList(loaded.filter(isAccountRecord));
      } catch {
        setMessage("API offline");
      }
    }

    void loadAccountsForGroup();

    return () => {
      ignore = true;
    };
  }, [activeGroupId]);

  function setAccountList(nextAccounts: AccountRecord[]) {
    // In-memory only: accounts hold secrets and must not be persisted to the
    // browser. They are re-fetched from the API on the next mount.
    setAccounts(sortAccounts(nextAccounts.map(migrateAccount)));
  }

  const accountsBase = activeGroupId
    ? `${API_GROUPS}/${encodeURIComponent(activeGroupId)}/accounts`
    : "";

  async function refreshGroups() {
    try {
      const data = await requestJson<{ groups: GroupSummary[] }>(API_GROUPS);

      setGroups(data.groups);
      return data;
    } catch {
      setMessage("API offline");
      return null;
    }
  }

  function bumpActiveGroupCount(delta: number) {
    setGroups((current) =>
      current.map((group) =>
        group.id === activeGroupId
          ? { ...group, count: Math.max(0, group.count + delta) }
          : group,
      ),
    );
  }

  function selectGroup(id: string) {
    if (id === activeGroupId) {
      return;
    }

    // The active group is purely client state now; the localStorage effect
    // above persists the choice.
    setActiveGroupId(id);
    setQuickViewAccount(null);
    setIsAccountModalOpen(false);
  }

  function createGroup() {
    setGroupDialog({ mode: "create", value: "" });
  }

  function renameGroup() {
    if (!activeGroup) {
      return;
    }

    setGroupDialog({ mode: "rename", value: activeGroup.name });
  }

  async function submitGroupDialog() {
    if (!groupDialog) {
      return;
    }

    const name = groupDialog.value.trim();

    if (!name) {
      return;
    }

    try {
      if (groupDialog.mode === "create") {
        const created = await requestJson<GroupSummary>(API_GROUPS, {
          method: "POST",
          body: JSON.stringify({ name }),
        });

        await refreshGroups();
        setActiveGroupId(created.id);
      } else if (activeGroup) {
        await requestJson(
          `${API_GROUPS}/${encodeURIComponent(activeGroup.id)}`,
          {
            method: "PUT",
            body: JSON.stringify({ name }),
          },
        );
        await refreshGroups();
      }

      setGroupDialog(null);
    } catch {
      notify("Erro ao salvar grupo", "error");
    }
  }

  function deleteGroup() {
    // Deleting is allowed as long as a group is selected — even the last one.
    // The server accepts it and the UI falls back to the empty state (no active
    // group), from which "Criar novo grupo" is still reachable.
    if (!activeGroup) {
      return;
    }

    setConfirmDeleteGroup(true);
  }

  async function confirmDeleteGroupNow() {
    if (!activeGroup) {
      return;
    }

    try {
      const data = await withReauth(() =>
        requestJson<{ groups: GroupSummary[] }>(
          `${API_GROUPS}/${encodeURIComponent(activeGroup.id)}`,
          { method: "DELETE" },
        ),
      );

      setGroups(data.groups);
      // The deleted group was active; pick another visible one (or none).
      setActiveGroupId(pickActiveGroup(data.groups, ""));
      setConfirmDeleteGroup(false);
      notify("Grupo excluído");
    } catch (error) {
      if (isReauthRequired(error)) return; // user cancelled re-auth
      notify("Erro ao excluir grupo", "error");
    }
  }

  const accountPlatforms = useMemo(
    () =>
      alphabetize(
        Array.from(new Set(accounts.map((account) => account.platform))),
      ),
    [accounts],
  );

  const accountRoles = useMemo(
    () =>
      alphabetize(Array.from(new Set(accounts.map((account) => account.role)))),
    [accounts],
  );

  const sidebarPlatforms = useMemo(
    () =>
      alphabetize(
        Array.from(new Set([...platformOptions, ...accountPlatforms])),
      ),
    [accountPlatforms],
  );

  const platformCounts = useMemo(
    () =>
      accounts.reduce<Record<string, number>>((counts, account) => {
        counts[account.platform] = (counts[account.platform] ?? 0) + 1;
        return counts;
      }, {}),
    [accounts],
  );

  const filteredAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return sortAccounts(
      accounts.filter((account) => {
        const matchesPlatform =
          platformFilter === ALL || account.platform === platformFilter;
        const matchesRole = roleFilter === ALL || account.role === roleFilter;
        const matchesStatus =
          statusFilter === ALL || account.status === statusFilter;
        const searchable = [
          account.platform,
          account.role,
          account.owner,
          account.label,
          account.email,
          account.username,
          account.recoveryEmail,
          account.phone,
          account.postDay,
          account.niche,
          account.notes,
        ]
          .join(" ")
          .toLowerCase();

        return (
          matchesPlatform &&
          matchesRole &&
          matchesStatus &&
          (!normalizedQuery || searchable.includes(normalizedQuery))
        );
      }),
    );
  }, [accounts, platformFilter, query, roleFilter, statusFilter]);

  const activeCount = accounts.filter(
    (account) => account.status === "active",
  ).length;
  const archivedCount = accounts.filter(
    (account) => account.status === "archived",
  ).length;
  const reviewCount = accounts.filter(
    (account) => account.status === "review",
  ).length;
  const inactiveCount = accounts.filter(
    (account) => account.status === "inactive",
  ).length;
  const statusTabs = [
    { value: "archived", label: "Arquivadas", count: archivedCount },
    { value: "active", label: "Ativas", count: activeCount },
    { value: "review", label: "Revisar", count: reviewCount },
    { value: "inactive", label: "Desativadas", count: inactiveCount },
    { value: ALL, label: "Todas", count: accounts.length },
  ] satisfies Array<{
    count: number;
    label: string;
    value: AccountStatus | typeof ALL;
  }>;
  const canContinueWizard = wizardStep !== 0 || draft.label.trim().length > 0;
  const canSaveDraft = [
    draft.label,
    draft.email,
    draft.username,
    draft.password,
  ].some((value) => value.trim().length > 0);

  function updateDraft<K extends keyof AccountDraft>(
    field: K,
    value: AccountDraft[K],
  ) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setEditingId(null);
    setDraft(emptyAccountDraft);
    setShowPassword(false);
  }

  function openCreateModal() {
    setEditingId(null);
    setDraft(emptyAccountDraft);
    setShowPassword(false);
    setWizardStep(0);
    setMessage("");
    setIsAccountModalOpen(true);
  }

  function closeAccountModal() {
    setIsAccountModalOpen(false);
    setWizardStep(0);
    resetForm();
  }

  function selectAccount(account: AccountRecord) {
    setQuickViewAccount(account);
  }

  function editAccount(account: AccountRecord) {
    setQuickViewAccount(null);
    setEditingId(account.id);
    setDraft(toDraft(account));
    setShowPassword(false);
    setWizardStep(0);
    setMessage("");
    setIsAccountModalOpen(true);
  }

  function nextWizardStep() {
    if (!canContinueWizard) {
      return;
    }

    setWizardStep((current) => Math.min(current + 1, CONFIRM_STEP));
  }

  function previousWizardStep() {
    setWizardStep((current) => Math.max(current - 1, 0));
  }

  async function saveAccount() {
    const cleaned = normalizeDraft(draft);

    if (!canSaveDraft) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      if (editingId) {
        const updated = await requestJson<AccountRecord>(
          `${accountsBase}/${encodeURIComponent(editingId)}`,
          {
            method: "PUT",
            body: JSON.stringify(cleaned),
          },
        );

        setAccountList(
          accounts.map((account) =>
            account.id === editingId ? updated : account,
          ),
        );
        notify("Conta atualizada");
        setIsAccountModalOpen(false);
        resetForm();
        return;
      }

      const created = await requestJson<AccountRecord>(accountsBase, {
        method: "POST",
        body: JSON.stringify({ id: createId(), ...cleaned }),
      });

      setAccountList([created, ...accounts]);
      bumpActiveGroupCount(1);
      notify("Conta adicionada");
      setIsAccountModalOpen(false);
      resetForm();
    } catch {
      notify("Erro ao salvar a conta", "error");
    } finally {
      setIsSaving(false);
    }
  }

  function deleteAccount(id: string | null = editingId) {
    if (!id) {
      return;
    }

    setDeleteAccountId(id);
  }

  async function confirmDeleteAccountNow() {
    const id = deleteAccountId;

    if (!id) {
      return;
    }

    setMessage("");

    try {
      await requestJson(`${accountsBase}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setAccountList(accounts.filter((account) => account.id !== id));
      bumpActiveGroupCount(-1);
      setQuickViewAccount(null);
      setIsAccountModalOpen(false);
      setDeleteAccountId(null);
      resetForm();
      notify("Conta removida");
    } catch {
      notify("Erro ao remover a conta", "error");
    }
  }

  async function copyValue(value: string, key: string) {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(""), 1200);
      // For secrets (password), wipe the clipboard after a short window so a
      // copied password isn't left sitting there. Best-effort and conservative:
      // we only clear when we can confirm the clipboard STILL holds the password
      // we put there. If readText is blocked (common — it needs permission), we
      // skip clearing rather than risk clobbering something the user copied since.
      if (key.endsWith(":password")) {
        window.setTimeout(() => {
          void navigator.clipboard
            .readText()
            .then((current) => {
              if (current === value) {
                void navigator.clipboard.writeText("").catch(() => {});
              }
            })
            .catch(() => {
              // Can't verify the clipboard contents; leave it untouched.
            });
        }, CLIPBOARD_CLEAR_MS);
      }
    } catch {
      setCopiedKey("");
    }
  }

  // Runs a critical action that may require recent re-authentication. If the
  // server answers 403 reauth_required, opens the re-auth modal, waits for the
  // user to confirm their password, then retries the action once. Other errors
  // propagate to the caller.
  async function withReauth<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (!isReauthRequired(error)) throw error;
      const ok = await promptReauth();
      if (!ok) throw error; // user cancelled
      return action();
    }
  }

  // Opens the modal and resolves true once re-auth succeeds, false if cancelled.
  // If a prompt is already open (two critical actions raced into reauth_required),
  // both callers share the SAME pending promise instead of the second clobbering
  // the first's resolver (which would leave the first action hung forever).
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
    resolve?.(ok);
  }

  // Called by the modal when the user submits their password.
  async function submitReauth(password: string) {
    setReauthError("");
    try {
      await requestJson("/api/auth/reauth", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      settleReauth(true);
    } catch {
      setReauthError("Senha incorreta.");
    }
  }

  // Fetches one account's password on demand from the reauth-gated endpoint. The
  // value is returned to the caller and never stored beyond the ephemeral
  // reveal/copy use. Returns "" on failure (e.g. cancelled re-auth).
  async function fetchSecret(accountId: string): Promise<string> {
    if (!activeGroupId) return "";
    try {
      const data = await withReauth(() =>
        requestJson<{ password: string }>(
          `${API_GROUPS}/${encodeURIComponent(activeGroupId)}/accounts/${encodeURIComponent(accountId)}/secret`,
        ),
      );
      return data.password ?? "";
    } catch {
      notify("Não foi possível obter a senha", "error");
      return "";
    }
  }

  // Quick-view "reveal": fetch the secret (prompting re-auth if needed), then show
  // it (auto-hides on the existing timer).
  async function revealQuickViewSecret(accountId: string) {
    if (quickViewReveal) {
      // Toggling off: hide and drop the secret.
      setQuickViewReveal(false);
      setQuickViewSecret("");
      return;
    }
    const password = await fetchSecret(accountId);
    if (!password) return;
    setQuickViewSecret(password);
    setQuickViewReveal(true);
  }

  // Quick-view "copy password": fetch the secret then copy it (clipboard is
  // auto-cleared by copyValue).
  async function copyQuickViewSecret(accountId: string) {
    const password = await fetchSecret(accountId);
    if (!password) return;
    await copyValue(password, `${accountId}:password`);
  }

  async function exportBackup() {
    if (!activeGroupId) return;
    const groupName = activeGroup?.name ?? "contas";
    try {
      // Passwords aren't in the listing anymore, so fetch each on demand (one
      // re-auth unlocks the whole batch for the 5-min window). Build the export
      // with the real secrets restored.
      const withSecrets: AccountRecord[] = [];
      for (const account of accounts) {
        const password = account.hasPassword
          ? await fetchSecret(account.id)
          : "";
        withSecrets.push({ ...account, password });
      }
      const payload = JSON.stringify(
        { group: groupName, exportedAt: new Date().toISOString(), accounts: withSecrets },
        null,
        2,
      );
      const blob = new Blob([payload], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `contas-${slugify(groupName)}-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      notify("Não foi possível exportar", "error");
    }
  }

  function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = Array.isArray(parsed) ? parsed : parsed.accounts;

        if (!Array.isArray(imported)) {
          throw new Error("Formato inválido");
        }

        // Imported backups always land in a brand-new group so they never
        // mix with the current (e.g. Vitissouls) accounts.
        const importedName =
          (typeof parsed?.group === "string" && parsed.group.trim()) ||
          `Contas importadas ${new Date().toLocaleDateString("pt-BR")}`;

        const createdGroup = await requestJson<GroupSummary>(API_GROUPS, {
          method: "POST",
          body: JSON.stringify({ name: importedName }),
        });

        await requestJson<AccountRecord[]>(
          `${API_GROUPS}/${encodeURIComponent(createdGroup.id)}/accounts/import`,
          {
            method: "POST",
            body: JSON.stringify({ accounts: imported }),
          },
        );

        await refreshGroups();
        setActiveGroupId(createdGroup.id);
        resetForm();
        notify(`Importado para "${importedName}"`);
      } catch {
        notify("Backup inválido", "error");
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  }

  return (
    <main
      className={cn(
        `theme-${theme}`,
        "app-shell tech-grid min-h-screen overflow-x-clip",
      )}
    >
      <input
        ref={importInputRef}
        className="hidden"
        type="file"
        accept="application/json"
        onChange={importBackup}
      />

      <nav className="app-navbar sticky top-0 z-40 border-b px-4 py-3 backdrop-blur-2xl sm:px-6">
        <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent opacity-70" />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandLogo />
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-semibold tracking-wide text-[color:var(--text)]">
                Contas_exe
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <NavAction
              icon={Download}
              label="Exportar"
              onClick={exportBackup}
            />
            <NavAction
              icon={Upload}
              label="Importar"
              onClick={() => importInputRef.current?.click()}
            />

            <span className="mx-1 hidden h-7 w-px bg-[color:var(--border)] lg:block" />

            <ThemeToggle value={theme} onChange={onThemeChange} />
          </div>
        </div>
      </nav>

      <div className="grid grid-cols-1 xl:grid-cols-[228px_minmax(0,1fr)]">
        <aside className="app-sidebar relative flex flex-col gap-5 border-b py-5 pl-5 pr-4 backdrop-blur-2xl xl:sticky xl:top-[73px] xl:h-[calc(100vh-73px)] xl:border-b-0 xl:border-r xl:pl-6">
          <SidebarSection label="Grupo">
            <GroupSwitcher
              activeGroup={activeGroup}
              groups={groups}
              onCreate={createGroup}
              onDelete={deleteGroup}
              onRename={renameGroup}
              onSelect={selectGroup}
            />
          </SidebarSection>

          <SidebarSection label="Redes">
            <SidebarButton
              active={platformFilter === ALL}
              count={accounts.length}
              icon={Layers}
              label="Todas"
              onClick={() => setPlatformFilter(ALL)}
            />
            {sidebarPlatforms.map((platform) => (
              <SidebarButton
                key={platform}
                active={platformFilter === platform}
                count={platformCounts[platform] ?? 0}
                icon={platformIconFor(platform)}
                label={platform}
                platform={platform}
                onClick={() => setPlatformFilter(platform)}
              />
            ))}
          </SidebarSection>

          <div className="mt-auto space-y-1.5 pt-4">
            {isAdmin ? (
              <button
                className="group/team flex h-11 w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 text-left text-sm font-semibold text-[color:var(--muted)] transition-all duration-300 hover:translate-x-0.5 hover:border-[color:var(--accent-border)] hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
                type="button"
                onClick={() => setUsersDialogOpen(true)}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] text-[color:var(--accent)] transition duration-300 group-hover/team:bg-[color:var(--field-hover)]">
                  <Users className="h-5 w-5" />
                </span>
                <span className="truncate">Equipe</span>
              </button>
            ) : null}

            <button
              className="group/acct flex h-11 w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 text-left text-sm font-semibold text-[color:var(--muted)] transition-all duration-300 hover:translate-x-0.5 hover:border-[color:var(--accent-border)] hover:bg-[color:var(--field-hover)] hover:text-[color:var(--text)]"
              type="button"
              onClick={() => setAccountSettingsOpen(true)}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[color:var(--border)] bg-[color:var(--field)] text-[color:var(--accent)] transition duration-300 group-hover/acct:bg-[color:var(--field-hover)]">
                <UserCog className="h-5 w-5" />
              </span>
              <span className="truncate">Minha conta</span>
            </button>

            {onLock ? (
              <button
                className="group/exit flex h-11 w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 text-left text-sm font-semibold text-[color:var(--muted)] transition-all duration-300 hover:translate-x-0.5 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-200"
                type="button"
                onClick={onLock}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/15 text-red-300 transition duration-300 group-hover/exit:bg-red-500/25 group-hover/exit:text-red-200">
                  <ExitIcon className="h-5 w-5" />
                </span>
                <span className="truncate">Sair</span>
              </button>
            ) : null}
          </div>
        </aside>

        <section className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-2">
            <div className="accent-pill inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
              <RadarTowerIcon className="h-4 w-4" />
              Social access hub
              <span className="radar-dot ml-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            </div>
          </header>

          <StatusTabs
            tabs={statusTabs}
            value={statusFilter}
            onChange={setStatusFilter}
          />

          <Card
            className="animate-rise mt-6 overflow-hidden"
            style={{ animationDelay: "60ms" }}
          >
            <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="shrink-0">
                <CardTitle>Registros</CardTitle>
                <CardDescription>
                  {filteredAccounts.length} / {accounts.length}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                {message && !isAccountModalOpen ? (
                  <span className="accent-pill rounded-full border px-3 py-1 text-xs font-medium">
                    {message}
                  </span>
                ) : null}
                <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted)]" />
                  <Input
                    aria-label="Buscar"
                    className="pl-9"
                    placeholder="Buscar"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <FilterSelect
                  icon={Filter}
                  label="Função"
                  options={[
                    { value: ALL, label: "Funções" },
                    ...accountRoles.map((value) => ({ value })),
                  ]}
                  value={roleFilter}
                  onChange={setRoleFilter}
                />
                <Button size="sm" onClick={openCreateModal}>
                  <Plus className="h-4 w-4" />
                  Nova conta
                </Button>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {filteredAccounts.length ? (
                <div className="divide-y divide-[color:var(--border)]">
                  {filteredAccounts.map((account, index) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      index={index}
                      isActive={
                        (isAccountModalOpen && account.id === editingId) ||
                        account.id === quickViewAccount?.id
                      }
                      onSelect={() => selectAccount(account)}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex min-h-[360px] items-center justify-center p-8 text-sm text-[color:var(--muted)]">
                  Nenhuma conta.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      {isAccountModalOpen ? (
        <AccountWizardModal
          canContinue={canContinueWizard}
          canSave={canSaveDraft}
          draft={draft}
          editing={Boolean(editingId)}
          isSaving={isSaving}
          message={message}
          showPassword={showPassword}
          step={wizardStep}
          onBack={previousWizardStep}
          onClose={closeAccountModal}
          onDelete={deleteAccount}
          onNext={nextWizardStep}
          onSave={saveAccount}
          onTogglePassword={() => setShowPassword((current) => !current)}
          onUpdate={updateDraft}
        />
      ) : null}

      {quickViewAccount ? (
        <QuickViewModal
          account={quickViewAccount}
          copiedKey={copiedKey}
          onClose={() => setQuickViewAccount(null)}
          onCopy={copyValue}
          onCopyPassword={() => copyQuickViewSecret(quickViewAccount.id)}
          onDelete={() => deleteAccount(quickViewAccount.id)}
          onEdit={() => editAccount(quickViewAccount)}
          passwordRevealed={quickViewReveal}
          revealedPassword={quickViewSecret}
          onTogglePassword={() => revealQuickViewSecret(quickViewAccount.id)}
        />
      ) : null}

      {reauthOpen ? (
        <ReauthModal
          error={reauthError}
          onCancel={() => settleReauth(false)}
          onSubmit={submitReauth}
        />
      ) : null}

      {groupDialog ? (
        <GroupDialog
          mode={groupDialog.mode}
          value={groupDialog.value}
          onChange={(value) =>
            setGroupDialog((current) =>
              current ? { ...current, value } : current,
            )
          }
          onClose={() => setGroupDialog(null)}
          onSubmit={submitGroupDialog}
        />
      ) : null}

      {confirmDeleteGroup && activeGroup ? (
        <ConfirmDialog
          title="Excluir grupo"
          message={`Excluir o grupo "${activeGroup.name}" e todas as suas contas?`}
          note="Esta ação não pode ser desfeita."
          confirmLabel="Excluir grupo"
          onCancel={() => setConfirmDeleteGroup(false)}
          onConfirm={confirmDeleteGroupNow}
        />
      ) : null}

      {deleteAccountId ? (
        <ConfirmDialog
          title="Excluir conta"
          message={`Remover "${titleFor(
            accounts.find((account) => account.id === deleteAccountId) ??
              ({ label: "esta conta" } as AccountRecord),
          )}" deste grupo?`}
          note="Esta ação não pode ser desfeita."
          confirmLabel="Excluir"
          onCancel={() => setDeleteAccountId(null)}
          onConfirm={confirmDeleteAccountNow}
        />
      ) : null}

      {usersDialogOpen && isAdmin ? (
        <UsersDialog
          currentUsername={user?.username ?? ""}
          onClose={() => setUsersDialogOpen(false)}
          withReauth={withReauth}
        />
      ) : null}

      {accountSettingsOpen ? (
        <AccountSettings
          onClose={() => setAccountSettingsOpen(false)}
          withReauth={withReauth}
        />
      ) : null}

      {toast ? (
        <Toast
          message={toast.text}
          tone={toast.tone}
          onDismiss={dismissToast}
        />
      ) : null}
    </main>
  );
}

type DraftUpdater = <K extends keyof AccountDraft>(
  field: K,
  value: AccountDraft[K],
) => void;

type ModalShellProps = {
  children: ReactNode;
  onClose: () => void;
  // "sm" for short forms, "md"/"lg" for dialogs with a sentence or two of
  // body text so it has room to breathe instead of wrapping awkwardly.
  size?: "sm" | "md" | "lg";
  title: string;
};

function ModalShell({
  children,
  onClose,
  size = "sm",
  title,
}: ModalShellProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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
        className={cn(
          "app-panel animate-pop-in relative w-full overflow-hidden rounded-[28px] border p-5 backdrop-blur-2xl sm:p-6",
          size === "lg" ? "max-w-lg" : size === "md" ? "max-w-md" : "max-w-sm",
        )}
        role="dialog"
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent" />
        {title ? (
          <div className="relative flex items-start justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-normal text-[color:var(--text)]">
              {title}
            </h2>
            <Button
              aria-label="Fechar"
              size="icon"
              variant="ghost"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
        {children}
      </section>
    </div>
  );
}

type GroupDialogProps = {
  mode: "create" | "rename";
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  value: string;
};

function GroupDialog({
  mode,
  onChange,
  onClose,
  onSubmit,
  value,
}: GroupDialogProps) {
  return (
    <ModalShell
      onClose={onClose}
      title={mode === "create" ? "Novo grupo" : "Renomear grupo"}
    >
      <form
        className="mt-5"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Field label="Nome do grupo">
          <Input
            autoFocus
            value={value}
            placeholder="Ex: Vitissouls"
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!value.trim()}>
            <Save className="h-4 w-4" />
            {mode === "create" ? "Criar" : "Salvar"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

type ConfirmDialogProps = {
  confirmLabel: string;
  // The question/primary line.
  message: string;
  // Optional second line, rendered on its own line below the message
  // (e.g. the "Esta ação não pode ser desfeita." warning).
  note?: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
};

function ConfirmDialog({
  confirmLabel,
  message,
  note,
  onCancel,
  onConfirm,
  title,
}: ConfirmDialogProps) {
  return (
    // Empty title => ModalShell skips its header; we render a fully centered,
    // symmetric layout instead (radar on top, title + message centered, two
    // equal-width buttons). This avoids the lopsided icon-beside-text look.
    <ModalShell onClose={onCancel} size="lg" title="">
      <div className="flex flex-col items-center text-center">
        <RadarGlyph />
        <h2 className="mt-4 text-xl font-semibold tracking-normal text-[color:var(--text)]">
          {title}
        </h2>
        {/*
          message and note are intentionally separate <p> elements so each
          stays on its own line: the question on top, the warning below.
          break-words still guards against an overlong name/email.
        */}
        <p className="mt-2 break-words text-sm leading-relaxed text-[color:var(--muted)]">
          {message}
        </p>
        {note ? (
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted-soft)]">
            {note}
          </p>
        ) : null}
      </div>
      <div className="mt-7 grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <button
          className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-red-500 px-4 text-sm font-semibold text-white shadow-[0_10px_28px_-8px_rgba(239,68,68,0.7)] transition duration-300 hover:bg-red-400"
          type="button"
          onClick={onConfirm}
        >
          <Trash2 className="h-4 w-4" />
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

// A small "radar" glyph: concentric rings that sweep/pulse outward around a
// danger icon. Pure CSS via Tailwind's animate-ping, so it stays lightweight.
function RadarGlyph() {
  return (
    <span className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      <span className="absolute inset-0 animate-ping rounded-full bg-red-500/30 [animation-duration:1.8s]" />
      <span className="absolute inset-1.5 animate-ping rounded-full bg-red-500/25 [animation-duration:1.8s] [animation-delay:0.3s]" />
      <span className="absolute inset-0 rounded-full border border-red-500/40" />
      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-red-500/15 text-red-400">
        <AlertTriangle className="h-5 w-5" />
      </span>
    </span>
  );
}

type AccountWizardModalProps = {
  canContinue: boolean;
  canSave: boolean;
  draft: AccountDraft;
  editing: boolean;
  isSaving: boolean;
  message: string;
  onBack: () => void;
  onClose: () => void;
  onDelete: () => void;
  onNext: () => void;
  onSave: () => void;
  onTogglePassword: () => void;
  onUpdate: DraftUpdater;
  showPassword: boolean;
  step: number;
};

function AccountWizardModal({
  canContinue,
  canSave,
  draft,
  editing,
  isSaving,
  message,
  onBack,
  onClose,
  onDelete,
  onNext,
  onSave,
  onTogglePassword,
  onUpdate,
  showPassword,
  step,
}: AccountWizardModalProps) {
  const isConfirmStep = step === CONFIRM_STEP;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
      <button
        aria-label="Fechar"
        className="absolute inset-0 bg-[color:var(--overlay)] backdrop-blur-md"
        type="button"
        onClick={onClose}
      />

      <section
        aria-labelledby="account-wizard-title"
        aria-modal="true"
        className="app-panel animate-pop-in relative w-full max-w-xl overflow-hidden rounded-[28px] border p-5 backdrop-blur-2xl sm:p-6"
        role="dialog"
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent" />

        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--accent-muted)]">
              {editing ? "Editar" : "Nova conta"}
            </p>
            <h2
              className="mt-2 text-3xl font-semibold tracking-normal text-[color:var(--text)]"
              id="account-wizard-title"
            >
              {WIZARD_STEPS[step]}
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

        <div className="mt-5 grid grid-cols-8 gap-1.5">
          {WIZARD_STEPS.map((label, index) => (
            <span
              aria-label={label}
              className={cn(
                "h-1.5 rounded-full transition duration-300",
                index <= step
                  ? "bg-[color:var(--accent)]"
                  : "bg-[color:var(--surface-soft)]",
              )}
              key={label}
            />
          ))}
        </div>

        <div className="relative mt-7 min-h-[250px]">
          <WizardStepContent
            draft={draft}
            showPassword={showPassword}
            step={step}
            onTogglePassword={onTogglePassword}
            onUpdate={onUpdate}
          />
        </div>

        {message ? (
          <p className="mt-4 text-sm font-medium text-[color:var(--accent-soft)]">
            {message}
          </p>
        ) : null}

        <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {editing ? (
              <Button
                size="icon"
                type="button"
                variant="ghost"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
            {step > 0 ? (
              <Button type="button" variant="outline" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </Button>
            ) : null}
          </div>

          {isConfirmStep ? (
            <Button
              disabled={isSaving || !canSave}
              type="button"
              variant="neon"
              onClick={onSave}
            >
              {isSaving ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isSaving ? "Salvando..." : editing ? "Salvar" : "Adicionar"}
            </Button>
          ) : (
            <Button disabled={!canContinue} type="button" onClick={onNext}>
              Seguir
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

type WizardStepContentProps = {
  draft: AccountDraft;
  onTogglePassword: () => void;
  onUpdate: DraftUpdater;
  showPassword: boolean;
  step: number;
};

function WizardStepContent({
  draft,
  onTogglePassword,
  onUpdate,
  showPassword,
  step,
}: WizardStepContentProps) {
  if (step === 0) {
    return (
      <Field label="Nome">
        <Input
          autoFocus
          value={draft.label}
          placeholder="YouTube principal"
          onChange={(event) => onUpdate("label", event.target.value)}
        />
      </Field>
    );
  }

  if (step === 1) {
    return (
      <ChoiceGrid>
        {platformOptions.map((platform) => (
          <ChoiceButton
            key={platform}
            selected={draft.platform === platform}
            onClick={() => onUpdate("platform", platform)}
          >
            <MiniPlatformIcon platform={platform} />
            {platform}
          </ChoiceButton>
        ))}
      </ChoiceGrid>
    );
  }

  if (step === 2) {
    return (
      <ChoiceGrid>
        {roleOptions.map((role) => (
          <ChoiceButton
            key={role}
            selected={draft.role === role}
            onClick={() => onUpdate("role", role)}
          >
            {role}
          </ChoiceButton>
        ))}
      </ChoiceGrid>
    );
  }

  if (step === 3) {
    return (
      <Field label="Email">
        <Input
          autoFocus
          autoComplete="username"
          inputMode="email"
          value={draft.email}
          placeholder="email@dominio.com"
          onChange={(event) => onUpdate("email", event.target.value)}
        />
      </Field>
    );
  }

  if (step === 4) {
    return (
      <Field label="Usuário">
        <Input
          autoFocus
          value={draft.username}
          placeholder="@usuario"
          onChange={(event) => onUpdate("username", event.target.value)}
        />
      </Field>
    );
  }

  if (step === 5) {
    return (
      <Field label="Senha">
        <div className="relative">
          <Input
            autoFocus
            autoComplete="current-password"
            className="pr-11"
            type={showPassword ? "text" : "password"}
            value={draft.password}
            placeholder="Senha"
            onChange={(event) => onUpdate("password", event.target.value)}
          />
          <button
            aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
            className="icon-soft absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg transition"
            type="button"
            onClick={onTogglePassword}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        </div>
      </Field>
    );
  }

  if (step === 6) {
    return (
      <ChoiceGrid>
        <ChoiceButton
          selected={draft.twoFactor}
          onClick={() => onUpdate("twoFactor", true)}
        >
          <ShieldCheck className="h-4 w-4" />
          Ativo
        </ChoiceButton>
        <ChoiceButton
          selected={!draft.twoFactor}
          onClick={() => onUpdate("twoFactor", false)}
        >
          Não
        </ChoiceButton>
      </ChoiceGrid>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] p-3">
        <PlatformGlyph platform={draft.platform} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[color:var(--text)]">
            {draft.label || "Sem nome"}
          </p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {draft.platform} / {draft.role}
          </p>
        </div>
        <CheckCircle2 className="ml-auto h-5 w-5 text-[color:var(--accent-soft)]" />
      </div>
      <div className="grid gap-2 text-sm">
        <SummaryRow label="Email" value={draft.email || "-"} />
        <SummaryRow label="Usuário" value={draft.username || "-"} />
        <SummaryRow label="Senha" value={draft.password ? "********" : "-"} />
        <SummaryRow label="2FA" value={draft.twoFactor ? "Ativo" : "Não"} />
      </div>
    </div>
  );
}

type ChoiceGridProps = {
  children: ReactNode;
};

function ChoiceGrid({ children }: ChoiceGridProps) {
  return <div className="grid gap-2 sm:grid-cols-2">{children}</div>;
}

type ChoiceButtonProps = {
  children: ReactNode;
  onClick: () => void;
  selected: boolean;
};

function ChoiceButton({ children, onClick, selected }: ChoiceButtonProps) {
  return (
    <button
      className={cn(
        "flex min-h-12 items-center gap-2 rounded-2xl border px-3 text-left text-sm font-semibold transition duration-300",
        selected
          ? "border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] text-[color:var(--accent-soft)] shadow-[0_0_32px_var(--accent-glow)]"
          : "border-[color:var(--border)] bg-[color:var(--surface-soft)] text-[color:var(--muted)] hover:-translate-y-0.5 hover:border-[color:var(--accent-border)] hover:bg-[color:var(--accent-surface)] hover:text-[color:var(--text)]",
      )}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

type SummaryRowProps = {
  label: string;
  value: string;
};

function SummaryRow({ label, value }: SummaryRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] px-3 py-2">
      <span className="text-[color:var(--muted-soft)]">{label}</span>
      <span className="min-w-0 truncate font-medium text-[color:var(--text)]">
        {value}
      </span>
    </div>
  );
}

type FieldProps = {
  label: string;
  children: ReactNode;
};

function Field({ label, children }: FieldProps) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-[color:var(--muted)]">
        {label}
      </span>
      {children}
    </div>
  );
}

type StatusTab = {
  count: number;
  label: string;
  value: AccountStatus | typeof ALL;
};

type StatusTabsProps = {
  onChange: (value: AccountStatus | typeof ALL) => void;
  tabs: StatusTab[];
  value: AccountStatus | typeof ALL;
};

function StatusTabs({ onChange, tabs, value }: StatusTabsProps) {
  return (
    <nav
      aria-label="Status"
      className="mt-5 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-[color:var(--border)] bg-[color:var(--nav-bg)] p-1 shadow-[inset_0_1px_0_var(--inset-light)] backdrop-blur-xl"
    >
      {tabs.map((tab) => {
        const active = tab.value === value;

        return (
          <button
            className={cn(
              "flex h-8 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition duration-300",
              active
                ? "bg-[color:var(--accent-surface)] text-[color:var(--accent-soft)] shadow-[0_0_24px_var(--accent-glow)]"
                : "text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]",
            )}
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
          >
            <span>{tab.label}</span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                active
                  ? "bg-[color:var(--accent-surface-strong)] text-[color:var(--accent-soft)]"
                  : "bg-[color:var(--surface-soft)]",
              )}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

type GroupSwitcherProps = {
  activeGroup: GroupSummary | null;
  groups: GroupSummary[];
  onCreate: () => void;
  onDelete: () => void;
  onRename: () => void;
  onSelect: (id: string) => void;
};

function GroupSwitcher({
  activeGroup,
  groups,
  onCreate,
  onDelete,
  onRename,
  onSelect,
}: GroupSwitcherProps) {
  // Two independent popovers: the group list (left) and the compact actions
  // menu behind the "⋯" symbol (right). Only one is open at a time.
  const [open, setOpen] = useState<"list" | "actions" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <div className="flex items-center gap-1.5">
        <button
          aria-expanded={open === "list"}
          aria-haspopup="listbox"
          className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] px-2.5 text-left text-sm font-bold text-[color:var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent-border),0_8px_20px_-12px_var(--accent-glow)] transition duration-300 hover:bg-[color:var(--accent-surface-strong)]"
          type="button"
          onClick={() =>
            setOpen((current) => (current === "list" ? null : "list"))
          }
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
            style={{
              background:
                "linear-gradient(140deg, var(--accent), var(--accent-hover))",
              boxShadow: "0 4px 12px -3px var(--accent-glow)",
            }}
          >
            <Users className="h-4 w-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {activeGroup?.name ??
              (groups.length === 0 ? "Nenhum grupo" : "Carregando...")}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 transition duration-200",
              open === "list" && "rotate-180",
            )}
          />
        </button>

        <button
          aria-expanded={open === "actions"}
          aria-haspopup="menu"
          aria-label="Gerenciar grupos"
          title="Gerenciar grupos"
          className={cn(
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border transition duration-300",
            open === "actions"
              ? "border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] text-[color:var(--accent-soft)]"
              : "border-[color:var(--border)] bg-[color:var(--surface-soft)] text-[color:var(--muted)] hover:border-[color:var(--accent-border)] hover:bg-[color:var(--accent-surface)] hover:text-[color:var(--accent-soft)]",
          )}
          type="button"
          onClick={() =>
            setOpen((current) => (current === "actions" ? null : "actions"))
          }
        >
          <Settings
            className={cn(
              "h-4 w-4 transition duration-300",
              open === "actions" && "rotate-90",
            )}
          />
        </button>
      </div>

      {open === "list" ? (
        <div className="animate-pop-in absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--panel-strong)] p-1.5 shadow-[0_24px_70px_var(--accent-glow)] backdrop-blur-2xl">
          <div className="max-h-60 overflow-y-auto pr-1">
            {groups.map((group) => {
              const selected = group.id === activeGroup?.id;

              return (
                <button
                  key={group.id}
                  className={cn(
                    "flex h-9 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm font-medium transition duration-150",
                    selected
                      ? "bg-[color:var(--accent-surface)] text-[color:var(--accent-soft)]"
                      : "text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]",
                  )}
                  type="button"
                  onClick={() => {
                    onSelect(group.id);
                    setOpen(null);
                  }}
                >
                  <span className="truncate">{group.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[color:var(--muted-soft)]">
                    {group.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {open === "actions" ? (
        <div className="animate-pop-in absolute right-0 top-[calc(100%+8px)] z-50 w-56 overflow-hidden rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--panel-strong)] p-1.5 shadow-[0_24px_70px_var(--accent-glow)] backdrop-blur-2xl">
          <p className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
            Gerenciar grupos
          </p>
          <GroupMenuItem
            icon={FolderPlus}
            label="Criar novo grupo"
            onClick={() => {
              setOpen(null);
              onCreate();
            }}
          />
          <GroupMenuItem
            icon={Pencil}
            label={`Renomear "${activeGroup?.name ?? "grupo"}"`}
            disabled={!activeGroup}
            onClick={() => {
              setOpen(null);
              onRename();
            }}
          />
          <GroupMenuItem
            danger
            icon={Trash}
            label={`Excluir "${activeGroup?.name ?? "grupo"}"`}
            disabled={!activeGroup}
            onClick={() => {
              setOpen(null);
              onDelete();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

type GroupMenuItemProps = {
  danger?: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
};

function GroupMenuItem({
  danger,
  disabled,
  icon: Icon,
  label,
  onClick,
}: GroupMenuItemProps) {
  return (
    <button
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium transition duration-150",
        danger
          ? "text-red-300/90 hover:bg-red-500/10 hover:text-red-200"
          : "text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

type SidebarSectionProps = {
  label: string;
  children: ReactNode;
};

function SidebarSection({ label, children }: SidebarSectionProps) {
  return (
    <div>
      <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-soft)]">
        {label}
      </p>
      <div className="mt-3 space-y-1">{children}</div>
    </div>
  );
}

type NavActionProps = {
  active?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
};

function NavAction({ active, icon: Icon, label, onClick }: NavActionProps) {
  return (
    <button
      className={cn(
        "flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition duration-300",
        active
          ? "border-[color:var(--accent-border)] bg-[color:var(--accent-surface)] text-[color:var(--accent-soft)] shadow-[0_0_24px_var(--accent-glow)]"
          : "border-transparent text-[color:var(--muted)] hover:-translate-y-0.5 hover:border-[color:var(--border)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]",
      )}
      type="button"
      onClick={onClick}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

type SidebarButtonProps = {
  active?: boolean;
  count?: number;
  icon: GlyphIcon;
  label: string;
  onClick?: () => void;
  platform?: string;
};

function SidebarButton({
  active,
  count,
  icon: Icon,
  label,
  onClick,
  platform,
}: SidebarButtonProps) {
  const meta = platform ? metaForPlatform(platform) : null;

  return (
    <button
      className={cn(
        "group relative flex h-11 w-full items-center justify-between gap-2 overflow-hidden rounded-xl px-2 text-left text-sm font-semibold transition-all duration-300 ease-out",
        active
          ? "bg-[color:var(--accent-surface)] text-[color:var(--accent-soft)] shadow-[inset_0_0_0_1px_var(--accent-border)]"
          : "text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]",
      )}
      type="button"
      onClick={onClick}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-[color:var(--accent)] transition-all duration-300",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-50",
        )}
      />
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition duration-300 group-hover:scale-105"
          style={
            meta
              ? {
                  background: meta.gradient
                    ? meta.gradient
                    : `linear-gradient(140deg, ${meta.color}, ${meta.color}cc)`,
                  boxShadow: `0 4px 12px -3px ${meta.color}80`,
                }
              : {
                  background:
                    "linear-gradient(140deg, var(--accent), var(--accent-hover))",
                  boxShadow: "0 4px 12px -3px var(--accent-glow)",
                }
          }
        >
          <Icon className="h-4 w-4 text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]" />
        </span>
        <span className="truncate">{label}</span>
      </span>
      {typeof count === "number" ? (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums transition",
            active
              ? "bg-[color:var(--accent)] text-[color:var(--accent-foreground)]"
              : "bg-[color:var(--surface-soft)] text-[color:var(--muted-soft)] group-hover:text-[color:var(--text)]",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

type PlatformGlyphProps = {
  platform: string;
};

function PlatformGlyph({ platform }: PlatformGlyphProps) {
  const meta = metaForPlatform(platform);
  const Icon = meta.icon;

  return (
    <span
      className="glass-glyph relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border transition duration-300 group-hover:scale-105"
      style={{
        borderColor: `${meta.color}3d`,
        boxShadow: `0 8px 26px -10px ${meta.color}80`,
      }}
    >
      <span
        className={cn(
          "absolute inset-0",
          !meta.solidBackground && "opacity-[0.16]",
        )}
        style={{ background: meta.gradient ?? meta.color }}
      />
      <span className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.22),transparent_46%)]" />
      <Icon className="relative h-5 w-5" style={{ color: meta.color }} />
    </span>
  );
}

function MiniPlatformIcon({ platform }: PlatformGlyphProps) {
  const meta = metaForPlatform(platform);
  const Icon = meta.icon;

  return (
    <span
      className="glass-glyph flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md border"
      style={{
        borderColor: `${meta.color}3d`,
        background: meta.solidBackground
          ? (meta.gradient ?? meta.color)
          : undefined,
      }}
    >
      <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
    </span>
  );
}

// A sharp, fully-filled 5-point star (longer, pointier spikes than lucide's
// rounded Star). Uses currentColor so it inherits the platform tint.
function SharpStarIcon({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 1.6l2.78 6.94 7.47.42-5.78 4.74 1.96 7.2L12 17.9l-6.43 3.4 1.96-7.2L1.75 9.36l7.47-.42L12 1.6z" />
    </svg>
  );
}

// A radar/transmission tower whose dish continuously emits expanding signal
// arcs to both sides — a real "radiating" radar. The waves animate via the
// .radar-wave keyframes in index.css; each side has two waves offset in time.
function RadarTowerIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* mast + tripod legs */}
      <path d="M12 9v8" />
      <path d="M12 17l-3.5 4M12 17l3.5 4M9 21h6" />
      {/* dish */}
      <circle cx="12" cy="7" r="2.1" />
      {/* right-side radiating waves */}
      <path
        className="radar-wave"
        d="M15.5 4.7a4 4 0 0 1 0 4.6"
        style={{ transformOrigin: "12px 7px" }}
      />
      <path
        className="radar-wave"
        d="M17.8 3a7 7 0 0 1 0 8"
        style={{ transformOrigin: "12px 7px", animationDelay: "0.7s" }}
      />
      {/* left-side radiating waves */}
      <path
        className="radar-wave"
        d="M8.5 4.7a4 4 0 0 0 0 4.6"
        style={{ transformOrigin: "12px 7px" }}
      />
      <path
        className="radar-wave"
        d="M6.2 3a7 7 0 0 0 0 8"
        style={{ transformOrigin: "12px 7px", animationDelay: "0.7s" }}
      />
    </svg>
  );
}

// A crisp "leave / log out" glyph: an open door frame on the left with an
// arrow pointing out to the right. Clearer than a generic bracket icon.
function ExitIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
    </svg>
  );
}

function BrandLogo() {
  return (
    <div className="brand-mark relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border">
      <img
        src="/logo-square.png"
        alt="Contas_exe"
        className="h-full w-full object-contain p-1"
      />
      <span className="status-dot absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border">
        <span className="h-1.5 w-1.5 rounded-full" />
      </span>
    </div>
  );
}

type FilterSelectProps = {
  icon: LucideIcon;
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
};

function FilterSelect({
  icon: Icon,
  label,
  onChange,
  options,
  value,
}: FilterSelectProps) {
  return (
    <CustomSelect
      compact
      icon={Icon}
      label={label}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

type SelectOption = {
  label?: string;
  value: string;
};

type CustomSelectProps = {
  compact?: boolean;
  icon?: LucideIcon;
  label: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  value: string;
};

function CustomSelect({
  compact,
  icon: Icon,
  label,
  onChange,
  options,
  value,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedLabel = labelFor(options, value);
  const selectedMeta = platformMeta[value];

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={cn("relative", compact && "min-w-36")} ref={rootRef}>
      {Icon ? (
        <Icon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[color:var(--muted)]" />
      ) : null}
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className={cn(
          compact
            ? "flex h-10 w-full items-center justify-between gap-2 rounded-full border border-[color:var(--border)] bg-[color:var(--field)] pl-9 pr-3 text-sm font-medium text-[color:var(--text)] shadow-[inset_0_1px_0_var(--inset-light),0_16px_34px_var(--field-shadow)] outline-none backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:border-[color:var(--accent-border)] hover:bg-[color:var(--field-hover)] focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--focus-ring)]"
            : selectTriggerClass,
        )}
        type="button"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "Enter") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedMeta ? <MiniPlatformIcon platform={value} /> : null}
          <span className="truncate">{selectedLabel}</span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-[color:var(--muted)] transition duration-200",
            open && "rotate-180 text-[color:var(--accent)]",
          )}
        />
      </button>

      {open ? (
        <div className="animate-pop-in absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl border border-[color:var(--accent-border)] bg-[color:var(--panel-strong)] p-1.5 shadow-[0_24px_70px_var(--accent-glow)] backdrop-blur-2xl">
          <div className="max-h-64 overflow-y-auto pr-1">
            {options.map((option) => {
              const selected = option.value === value;
              const optionMeta = platformMeta[option.value];

              return (
                <button
                  key={option.value}
                  className={cn(
                    "flex h-9 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm font-medium transition duration-150",
                    selected
                      ? "bg-[color:var(--accent-surface)] text-[color:var(--accent-soft)]"
                      : "text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--text)]",
                  )}
                  role="option"
                  type="button"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {optionMeta ? (
                      <MiniPlatformIcon platform={option.value} />
                    ) : null}
                    <span className="truncate">
                      {option.label ?? option.value}
                    </span>
                  </span>
                  {selected ? <Check className="h-4 w-4" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AccountRowProps = {
  account: AccountRecord;
  index: number;
  isActive: boolean;
  onSelect: () => void;
};

function AccountRow({ account, index, isActive, onSelect }: AccountRowProps) {
  // Move a CSS variable to follow the cursor so the .spotlight-card highlight
  // tracks the mouse over the row.
  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    event.currentTarget.style.setProperty("--spot-x", `${x}%`);
    event.currentTarget.style.setProperty("--spot-y", `${y}%`);
  }

  return (
    <div
      className={cn(
        "spotlight-card relative animate-row group grid gap-3 px-4 py-3 transition-colors duration-300 sm:grid-cols-[minmax(0,1fr)_auto]",
        isActive
          ? "bg-[color:var(--accent-surface)] shadow-[inset_3px_0_0_var(--accent)]"
          : "hover:bg-[color:var(--surface-soft)]",
      )}
      style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}
      onMouseMove={handleMouseMove}
    >
      <button className="min-w-0 text-left" type="button" onClick={onSelect}>
        <div className="flex min-w-0 items-center gap-3">
          <PlatformGlyph platform={account.platform} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[color:var(--text)]">
              {titleFor(account)}
            </p>
            <p className="mt-1 truncate text-xs text-[color:var(--muted)]">
              {account.platform} / {account.role}
            </p>
            <p className="mt-1 truncate text-xs text-[color:var(--muted-soft)]">
              {[account.email, account.username].filter(Boolean).join(" / ") ||
                "Sem acesso"}
            </p>
          </div>
        </div>
      </button>

      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Badge variant={account.status}>{statusLabel[account.status]}</Badge>
      </div>
    </div>
  );
}

type IconButtonProps = {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  selected?: boolean;
};

function IconButton({
  disabled,
  icon: Icon,
  label,
  onClick,
  selected,
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-xl border transition duration-300",
        selected
          ? "border-emerald-300/30 bg-emerald-300/12 text-emerald-100"
          : "border-[color:var(--border)] bg-[color:var(--surface-soft)] text-[color:var(--muted)] hover:-translate-y-0.5 hover:border-[color:var(--accent-border)] hover:bg-[color:var(--accent-surface)] hover:text-[color:var(--accent-soft)]",
        disabled &&
          "cursor-not-allowed opacity-40 hover:translate-y-0 hover:border-[color:var(--border)] hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--muted)]",
      )}
      disabled={disabled}
      title={label}
      type="button"
      onClick={onClick}
    >
      {selected ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
    </button>
  );
}

// Re-auth prompt shown when a critical action needs the password re-typed.
// Controlled by the vault (open/error state); submitting calls back into it.
function ReauthModal({
  error,
  onCancel,
  onSubmit,
}: {
  error: string;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    await onSubmit(password);
    setSubmitting(false);
  }

  return (
    <ModalShell onClose={onCancel} size="sm" title="Confirme sua senha">
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Esta ação é sensível. Digite sua senha para continuar.
      </p>
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
        <Input
          autoFocus
          autoComplete="current-password"
          className="h-11 rounded-2xl px-4"
          placeholder="Senha"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" variant="neon" disabled={!password || submitting}>
            {submitting ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            Confirmar
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

type QuickViewModalProps = {
  account: AccountRecord;
  copiedKey: string;
  onClose: () => void;
  onCopy: (value: string, key: string) => void;
  onCopyPassword: () => void;
  onDelete: () => void;
  onEdit: () => void;
  passwordRevealed: boolean;
  // The password fetched on demand; only meaningful while passwordRevealed.
  revealedPassword: string;
  onTogglePassword: () => void;
};

function QuickViewModal({
  account,
  copiedKey,
  onClose,
  onCopy,
  onCopyPassword,
  onDelete,
  onEdit,
  passwordRevealed,
  revealedPassword,
  onTogglePassword,
}: QuickViewModalProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-6">
      <button
        aria-label="Fechar"
        className="absolute inset-0 bg-[color:var(--overlay)] backdrop-blur-md"
        type="button"
        onClick={onClose}
      />

      <section
        aria-labelledby="account-quickview-title"
        aria-modal="true"
        className="app-panel animate-pop-in relative w-full max-w-md overflow-hidden rounded-[28px] border p-5 backdrop-blur-2xl sm:p-6"
        role="dialog"
      >
        <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <PlatformGlyph platform={account.platform} />
            <div className="min-w-0">
              <h2
                className="truncate text-xl font-semibold tracking-normal text-[color:var(--text)]"
                id="account-quickview-title"
              >
                {titleFor(account)}
              </h2>
              <p className="mt-0.5 truncate text-xs text-[color:var(--muted)]">
                {account.platform} / {account.role}
              </p>
            </div>
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

        <div className="mt-6 grid gap-3">
          <QuickField
            copied={copiedKey === `${account.id}:email`}
            icon={Mail}
            label="Email"
            value={account.email}
            onCopy={() => onCopy(account.email, `${account.id}:email`)}
          />
          <QuickField
            copied={copiedKey === `${account.id}:password`}
            icon={KeyRound}
            // While revealed, show the fetched secret; while masked, a non-empty
            // sentinel so the dots render when a password exists ("" → "—").
            value={
              passwordRevealed
                ? revealedPassword
                : account.hasPassword
                  ? "set"
                  : ""
            }
            label="Senha"
            secret
            revealed={passwordRevealed}
            onToggleReveal={onTogglePassword}
            onCopy={onCopyPassword}
          />
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium text-red-300/80 transition duration-300 hover:bg-red-500/10 hover:text-red-200"
            type="button"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
            Excluir
          </button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
        </div>
      </section>
    </div>
  );
}

type QuickFieldProps = {
  copied: boolean;
  icon: LucideIcon;
  label: string;
  value: string;
  onCopy: () => void;
  // When set, the value is treated as a secret: masked until revealed, with a
  // reveal toggle. `revealed`/`onToggleReveal` are controlled by the parent so
  // the reveal can auto-hide on a timer.
  secret?: boolean;
  revealed?: boolean;
  onToggleReveal?: () => void;
};

function QuickField({
  copied,
  icon: Icon,
  label,
  value,
  onCopy,
  secret = false,
  revealed = false,
  onToggleReveal,
}: QuickFieldProps) {
  const masked = secret && !revealed;
  return (
    <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-soft)] p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent-muted)]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono text-sm text-[color:var(--text)]">
          {value ? (masked ? "••••••••" : value) : "—"}
        </p>
        {secret ? (
          <IconButton
            disabled={!value}
            icon={revealed ? EyeOff : Eye}
            label={revealed ? "Ocultar senha" : "Mostrar senha"}
            onClick={() => onToggleReveal?.()}
            selected={revealed}
          />
        ) : null}
        <IconButton
          disabled={!value}
          icon={Copy}
          label={`Copiar ${label.toLowerCase()}`}
          onClick={onCopy}
          selected={copied}
        />
      </div>
    </div>
  );
}
