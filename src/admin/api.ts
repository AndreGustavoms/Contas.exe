// Helpers de rede do painel superadmin. Mesma semântica do app: erros carregam
// status + código para o chamador ramificar (notadamente 403 reauth_required).

export class AdminRequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code || "request_failed");
    this.status = status;
    this.code = code;
  }
}

export async function adminRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new AdminRequestError(
      response.status,
      body.error ?? "request_failed",
    );
  }
  // 204/empty-safe.
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export function isReauthRequired(error: unknown): boolean {
  return error instanceof AdminRequestError && error.code === "reauth_required";
}

// ----- Tipos das respostas do painel -----

export type Overview = {
  users: {
    total: number;
    superadmins: number;
    admins: number;
    members: number;
    withTwoFactor: number;
  };
  vaults: { groups: number; accounts: number };
  sessions: { active: number };
  audit: { total: number; recent24h: number };
  system: {
    encryptionEnabled: boolean;
    registrationsOpen: boolean;
    providers: { google: boolean; github: boolean };
    serverLogs: number;
    uptimeSeconds: number;
    nodeVersion: string;
  };
};

export type AdminAccount = {
  id: string;
  platform: string;
  role: string;
  owner: string;
  label: string;
  email: string;
  username: string;
  password: string;
  hasPassword: boolean;
  recoveryEmail: string;
  phone: string;
  status: string;
  twoFactor: boolean;
  notes: string;
  updatedAt: string;
};

export type AdminGroup = {
  id: string;
  name: string;
  ownerId: string;
  accounts: AdminAccount[];
};

export type AdminVault = {
  userId: string;
  username: string;
  role: string;
  groups: AdminGroup[];
};

export type AdminUser = {
  id: string;
  username: string;
  fullName: string | null;
  email: string | null;
  role: "superadmin" | "admin" | "member";
  createdAt: string;
  twoFactorEnabled?: boolean;
};

export type DataPayload = { users: AdminUser[]; vaults: AdminVault[] };

export type ManagedSession = {
  sessionId: string;
  userId: string;
  createdAt: string;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
  current: boolean;
};

export type AuditEvent = {
  ts: string;
  userId: string | null;
  username: string | null;
  action: string;
  target: string | null;
  ipHash: string;
};

export type ServerLog = {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
};
