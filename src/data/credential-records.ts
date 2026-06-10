export type AccountStatus = "active" | "review" | "archived" | "inactive";

export type AccountRecord = {
  id: string;
  platform: string;
  role: string;
  owner: string;
  label: string;
  email: string;
  username: string;
  // Sent masked ("") by the API listing; the real value is fetched on demand from
  // the reauth-gated /secret endpoint. `hasPassword` says whether one is set.
  password: string;
  hasPassword?: boolean;
  recoveryEmail: string;
  phone: string;
  status: AccountStatus;
  twoFactor: boolean;
  postDay: string;
  niche: string;
  notes: string;
  updatedAt: string;
};

export type AccountDraft = Omit<AccountRecord, "id" | "updatedAt">;

export const platformOptions = [
  "Email",
  "Estrela",
  "Facebook",
  "Instagram",
  "Kwai",
  "TikTok",
  "YouTube",
];

export const roleOptions = [
  "Administrativo",
  "Apoio",
  "Conta estrela",
  "Financeiro",
  "Nicho",
  "Postagem",
  "Recuperação",
];

export const ownerOptions = ["Andre"];

export const statusLabel: Record<AccountStatus, string> = {
  active: "Ativa",
  review: "Revisar",
  archived: "Arquivada",
  inactive: "Desativada",
};

export const emptyAccountDraft: AccountDraft = {
  platform: platformOptions[0],
  role: roleOptions[0],
  owner: "Andre",
  label: "",
  email: "",
  username: "",
  password: "",
  recoveryEmail: "",
  phone: "",
  status: "active",
  twoFactor: false,
  postDay: "",
  niche: "",
  notes: "",
};

export const initialAccounts: AccountRecord[] = [];
