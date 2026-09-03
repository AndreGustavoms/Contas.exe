#!/usr/bin/env node
// Migra os dados legados de storage/*.json para PostgreSQL.
//
// A operação é segura para reexecução: IDs legados não-UUID recebem UUIDs
// determinísticos, entidades usam chaves naturais/estáveis e auditoria/histórico
// recebem uma chave de origem exclusiva. O comando nunca apaga o JSON de origem.
// Cada entidade tem savepoint próprio, mas a migração inteira só fica visível no
// COMMIT final. Em caso de falha crítica, o banco volta ao estado anterior.
//
// Uso:
//   DATABASE_URL=... CONTAS_FLOW_ENC_KEY=... node server/migrate-json-to-pg.mjs
// Ownerless legacy records require CONTAS_FLOW_MIGRATION_OWNER_ID.

import "dotenv/config";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { closeDb, getClient, initDb } from "./db.mjs";
import { decryptField, encryptField } from "./crypto.mjs";
import { hashIp } from "./ip-hash.mjs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_ROLES = new Set(["superadmin", "admin", "member"]);
const storageDir = process.env.CONTAS_FLOW_STORAGE_DIR ?? "./storage";
const explicitMigrationOwner =
  process.env.CONTAS_FLOW_MIGRATION_OWNER_ID?.trim() || null;
const userIdMap = new Map();

function stableHash(namespace, value) {
  return createHash("sha256").update(`${namespace}:${value}`).digest("hex");
}

function deterministicUuid(namespace, value) {
  const hex = stableHash(namespace, value).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function toUuid(id, namespace, fallback) {
  if (UUID_RE.test(id ?? "")) return id;
  const source = id ?? fallback;
  if (source == null || String(source).trim() === "") {
    throw new Error(`id_legado_ausente:${namespace}`);
  }
  return deterministicUuid(namespace, String(source));
}

function sourceKey(namespace, value) {
  return stableHash(namespace, value);
}

async function readJsonFile(filename) {
  try {
    const raw = await readFile(join(storageDir, filename), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readVaultGroups() {
  const directory = join(storageDir, "vaults");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const result = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const raw = await readJsonFile(join("vaults", entry.name));
    if (!Array.isArray(raw?.groups)) continue;
    const ownerId = entry.name.slice(0, -5);
    raw.groups.forEach((group, index) => {
      result.push({
        group,
        ownerId: group.ownerId || ownerId,
        source: `vault:${entry.name}:${group.id ?? index}`,
      });
    });
  }
  return result;
}

function decryptIfNeeded(value) {
  if (typeof value === "string" && value.startsWith("enc:v1:")) {
    return decryptField(value);
  }
  return value;
}

function encryptForDatabase(value) {
  const plaintext = decryptIfNeeded(value);
  return plaintext == null ? null : encryptField(plaintext);
}

function rememberUserId(legacyId, pgId) {
  if (legacyId != null && String(legacyId) !== "") {
    userIdMap.set(String(legacyId), pgId);
  }
  userIdMap.set(`uuid:${pgId}`, pgId);
}

async function migrateUsers(client) {
  const data = await readJsonFile("users.json");
  if (!Array.isArray(data?.users)) {
    console.log("Nenhum usuário em users.json");
    return 0;
  }

  let imported = 0;
  for (const [index, user] of data.users.entries()) {
    const source = user.id ?? user.username ?? index;
    const pgId = toUuid(user.id, "user", source);
    rememberUserId(user.id, pgId);
    if (user.username) userIdMap.set(`username:${user.username}`, pgId);

    try {
      await client.query("SAVEPOINT sp_user");
      const existing = await client.query(
        "SELECT id FROM users WHERE username = $1",
        [user.username],
      );
      if (existing.rows.length > 0) {
        rememberUserId(user.id, existing.rows[0].id);
        if (user.username) {
          userIdMap.set(`username:${user.username}`, existing.rows[0].id);
        }
        await client.query("RELEASE SAVEPOINT sp_user");
        console.log(`Já existe usuário: ${user.username}`);
        continue;
      }

      const result = await client.query(
        `INSERT INTO users (
          id, username, email, full_name, password_hash, role,
          avatar_url, avatar_removed, two_factor_enabled, two_factor_secret,
          recovery_codes, google_id, google_email, google_picture,
          github_id, github_login, github_avatar, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (username) DO NOTHING
        RETURNING id`,
        [
          pgId,
          user.username,
          user.email ?? null,
          user.fullName ?? null,
          user.passwordHash,
          VALID_ROLES.has(user.role) ? user.role : "member",
          user.avatarUrl ?? null,
          user.avatarRemoved ?? false,
          user.twoFactor?.enabled ?? false,
          encryptForDatabase(user.twoFactor?.secret),
          Array.isArray(user.twoFactor?.recoveryCodes)
            ? user.twoFactor.recoveryCodes
                .filter((code) => !code?.usedAt)
                .map((code) =>
                  encryptForDatabase(
                    typeof code === "string" ? code : code?.hash,
                  ),
                )
                .filter(Boolean)
            : null,
          user.google?.id ?? null,
          user.google?.email ?? null,
          user.google?.picture ?? null,
          user.github?.id ?? null,
          user.github?.login ?? null,
          user.github?.avatar ?? null,
          user.createdAt ?? new Date().toISOString(),
        ],
      );
      if (result.rows.length > 0) {
        imported += 1;
        rememberUserId(user.id, result.rows[0].id);
        console.log(`Importado usuário: ${user.username}`);
      } else {
        const row = await client.query(
          "SELECT id FROM users WHERE username = $1",
          [user.username],
        );
        if (row.rows.length > 0) rememberUserId(user.id, row.rows[0].id);
      }
      await client.query("RELEASE SAVEPOINT sp_user");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_user");
      console.error(
        `Erro ao importar usuário ${user.username}:`,
        error.message,
      );
    }
  }
  return imported;
}

async function migrateLoginIps(client) {
  let entries;
  try {
    entries = await readdir(join(storageDir, "login-ips"), {
      withFileTypes: true,
    });
  } catch {
    console.log("Nenhum IP conhecido em login-ips/");
    return 0;
  }

  let imported = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const legacyUserId = entry.name.slice(0, -5);
    const userId = ownerIdFor(legacyUserId);
    const ips = await readJsonFile(join("login-ips", entry.name));
    if (!userId || !Array.isArray(ips)) continue;

    for (const ip of ips) {
      if (typeof ip !== "string" || ip === "") continue;
      try {
        await client.query("SAVEPOINT sp_login_ip");
        const result = await client.query(
          `INSERT INTO login_known_ips (user_id, ip_hash, last_seen_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (user_id, ip_hash) DO NOTHING`,
          [userId, hashIp(ip)],
        );
        imported += result.rowCount;
        await client.query("RELEASE SAVEPOINT sp_login_ip");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT sp_login_ip");
        console.error(
          `Erro ao importar IP conhecido de ${legacyUserId}:`,
          error.message,
        );
      }
    }

    await client.query(
      `DELETE FROM login_known_ips
       WHERE user_id = $1 AND ip_hash NOT IN (
         SELECT ip_hash FROM login_known_ips
         WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 20
       )`,
      [userId],
    );
  }
  return imported;
}

function ownerIdFor(legacyId) {
  for (const candidate of [legacyId, explicitMigrationOwner]) {
    if (candidate == null || String(candidate).trim() === "") continue;
    const raw = String(candidate);
    const mapped =
      userIdMap.get(raw) ??
      userIdMap.get(`uuid:${raw}`) ??
      userIdMap.get(`username:${raw}`);
    if (mapped) return mapped;
  }
  return null;
}

async function migrateGroups(client) {
  const legacy = [];
  const data = await readJsonFile("groups.json");
  if (Array.isArray(data?.groups)) {
    data.groups.forEach((group, index) =>
      legacy.push({
        group,
        ownerId: group.ownerId,
        source: `groups:${group.id ?? index}`,
      }),
    );
  }
  legacy.push(...(await readVaultGroups()));

  const uniqueGroups = new Map();
  for (const item of legacy) {
    const groupId = toUuid(
      item.group.id,
      "group",
      `${item.source}:${item.group.name ?? "grupo"}`,
    );
    if (!uniqueGroups.has(groupId))
      uniqueGroups.set(groupId, { ...item, groupId });
  }
  if (uniqueGroups.size === 0) {
    console.log("Nenhum grupo em groups.json ou vaults/*.json");
    return { groups: 0, accounts: 0 };
  }

  let importedGroups = 0;
  let importedAccounts = 0;
  for (const item of uniqueGroups.values()) {
    const ownerId = ownerIdFor(item.ownerId || item.group.ownerId);
    if (!ownerId) {
      console.error(`Grupo ignorado sem proprietário: ${item.group.name}`);
      continue;
    }

    try {
      await client.query("SAVEPOINT sp_group");
      const groupResult = await client.query(
        `INSERT INTO groups (id, name, owner_id) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [item.groupId, item.group.name || "Grupo", ownerId],
      );
      if (groupResult.rows.length > 0) {
        importedGroups += 1;
        console.log(`Importado grupo: ${item.group.name}`);
      }

      for (const [index, account] of (item.group.accounts ?? []).entries()) {
        const accountId = toUuid(
          account.id,
          "account",
          `${item.groupId}:${index}:${account.label ?? account.email ?? ""}`,
        );
        try {
          const exists = await client.query(
            "SELECT id FROM accounts WHERE id = $1",
            [accountId],
          );
          if (exists.rows.length > 0) continue;

          await client.query("SAVEPOINT sp_account");
          const result = await client.query(
            `INSERT INTO accounts (
              id, group_id, platform, role, owner, label, email, username,
              password_enc, recovery_email_enc, phone_enc, notes_enc,
              status, two_factor, post_day, niche, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            ON CONFLICT (id) DO NOTHING`,
            [
              accountId,
              item.groupId,
              account.platform || "Outra",
              account.role || "Outra",
              account.owner || "",
              account.label ?? "",
              account.email ?? "",
              account.username ?? "",
              encryptForDatabase(account.password),
              encryptForDatabase(account.recoveryEmail),
              encryptForDatabase(account.phone),
              encryptForDatabase(account.notes),
              account.status || "active",
              account.twoFactor ?? false,
              account.postDay ?? "",
              account.niche ?? "",
              account.updatedAt ?? new Date().toISOString(),
            ],
          );
          await client.query("RELEASE SAVEPOINT sp_account");
          importedAccounts += result.rowCount;
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT sp_account");
          console.error(`Erro ao importar conta ${account.id}:`, error.message);
        }
      }
      await client.query("RELEASE SAVEPOINT sp_group");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_group");
      console.error(
        `Erro ao importar grupo ${item.group.name}:`,
        error.message,
      );
    }
  }
  return { groups: importedGroups, accounts: importedAccounts };
}

async function migrateSessions(client) {
  const data = await readJsonFile("sessions.json");
  if (!Array.isArray(data?.sessions)) {
    console.log("Nenhuma sessão em sessions.json");
    return 0;
  }

  let imported = 0;
  for (const session of data.sessions) {
    try {
      await client.query("SAVEPOINT sp_session");
      const userId = ownerIdFor(session.userId);
      if (!userId) throw new Error("sessao_sem_usuario");
      const result = await client.query(
        `INSERT INTO sessions (
          session_id, user_id, created_at, last_seen_at, expires_at,
          revoked_at, reauth_at, ip_enc, ip_hash, user_agent_enc, location_enc
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (session_id) DO NOTHING`,
        [
          session.sessionId,
          userId,
          new Date(session.createdAt).getTime(),
          session.lastSeenAt,
          session.expiresAt,
          session.revokedAt ? new Date(session.revokedAt) : null,
          session.reauthAt ?? null,
          encryptForDatabase(session.ip),
          session.ipHash ?? null,
          encryptForDatabase(session.userAgent),
          encryptForDatabase(session.location),
        ],
      );
      imported += result.rowCount;
      await client.query("RELEASE SAVEPOINT sp_session");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_session");
      console.error("Erro ao importar sessão:", error.message);
    }
  }
  return imported;
}

async function migrateAudit(client) {
  const data = await readJsonFile("audit.json");
  if (!Array.isArray(data?.events)) {
    console.log("Nenhum evento em audit.json");
    return 0;
  }

  let imported = 0;
  for (const [index, event] of data.events.entries()) {
    const key = sourceKey(
      "audit",
      `${event.ts ?? ""}|${event.userId ?? ""}|${event.username ?? ""}|${event.action ?? ""}|${event.target ?? ""}|${event.ipHash ?? ""}|${index}`,
    );
    try {
      await client.query("SAVEPOINT sp_audit");
      const userId = event.userId ? userIdMap.get(String(event.userId)) : null;
      const result = await client.query(
        `INSERT INTO audit_events
          (ts, user_id, username, action, target, ip_hash, migration_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (migration_key) DO NOTHING`,
        [
          event.ts ?? new Date().toISOString(),
          userId ?? null,
          event.username ?? null,
          event.action || "legacy_event",
          event.target ?? null,
          event.ipHash ?? null,
          key,
        ],
      );
      imported += result.rowCount;
      await client.query("RELEASE SAVEPOINT sp_audit");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_audit");
      console.error("Erro ao importar evento de auditoria:", error.message);
    }
  }
  return imported;
}

async function migrateYouTube(client) {
  const channelsData = await readJsonFile("youtube.json");
  const historyData = await readJsonFile("youtube-history.json");
  let channels = 0;
  let uploads = 0;

  for (const channel of channelsData?.channels ?? []) {
    const channelId = channel.id ?? channel.channelId;
    const ownerId = ownerIdFor(channel.ownerId);
    if (!channelId || !ownerId) continue;
    try {
      await client.query("SAVEPOINT sp_channel");
      const result = await client.query(
        `INSERT INTO youtube_channels
          (owner_id, channel_id, title, access_token_enc, refresh_token_enc,
           token_expires_at, connected_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (owner_id, channel_id) DO NOTHING`,
        [
          ownerId,
          channelId,
          channel.title ?? null,
          encryptForDatabase(
            channel.accessToken ?? channel.tokens?.access_token,
          ),
          encryptForDatabase(
            channel.refreshToken ?? channel.tokens?.refresh_token,
          ),
          channel.tokenExpiresAt ?? channel.tokens?.expiry_date ?? null,
          channel.connectedAt ?? new Date().toISOString(),
        ],
      );
      channels += result.rowCount;
      await client.query("RELEASE SAVEPOINT sp_channel");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_channel");
      console.error(`Erro ao importar canal ${channelId}:`, error.message);
    }
  }

  for (const [index, item] of (historyData?.items ?? []).entries()) {
    const ownerId = ownerIdFor(item.ownerId);
    if (!ownerId || !item.channelId || !item.videoId) continue;
    const key = sourceKey(
      "youtube-upload",
      `${ownerId}|${item.channelId}|${item.videoId}|${item.uploadedAt ?? index}`,
    );
    try {
      await client.query("SAVEPOINT sp_upload");
      const result = await client.query(
        `INSERT INTO youtube_uploads
          (owner_id, channel_id, video_id, title, description, tags,
           privacy_status, publish_at, duration_seconds, thumbnail_url,
           uploaded_at, channel_title, migration_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (migration_key) DO NOTHING`,
        [
          ownerId,
          item.channelId,
          item.videoId,
          item.title ?? null,
          item.description ?? null,
          item.tags ? JSON.stringify(item.tags) : null,
          item.privacyStatus ?? null,
          item.publishAt ?? null,
          item.durationSeconds ?? null,
          item.thumbnailUrl ?? null,
          item.uploadedAt ?? new Date().toISOString(),
          item.channelTitle ?? null,
          key,
        ],
      );
      uploads += result.rowCount;
      await client.query("RELEASE SAVEPOINT sp_upload");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_upload");
      console.error(`Erro ao importar vídeo ${item.videoId}:`, error.message);
    }
  }
  if (!channelsData && !historyData) {
    console.log("Nenhum dado do YouTube em youtube.json/youtube-history.json");
  }
  return { channels, uploads };
}

async function main() {
  console.log("Migrando dados JSON para PostgreSQL\n");
  if (!(await initDb())) {
    throw new Error(
      "PostgreSQL não conectado; migração cancelada sem alterar os JSON",
    );
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const users = await migrateUsers(client);
    console.log(`Usuários importados: ${users}\n`);

    console.log(
      `IPs conhecidos importados: ${await migrateLoginIps(client)}\n`,
    );

    const groups = await migrateGroups(client);
    console.log(`Grupos importados: ${groups.groups}`);
    console.log(`Contas importadas: ${groups.accounts}\n`);

    console.log(`Sessões importadas: ${await migrateSessions(client)}\n`);
    console.log(`Eventos importados: ${await migrateAudit(client)}\n`);

    const youtube = await migrateYouTube(client);
    console.log(`Canais do YouTube importados: ${youtube.channels}`);
    console.log(`Uploads do YouTube importados: ${youtube.uploads}\n`);

    await client.query("COMMIT");
    console.log(
      "Migração concluída; os arquivos JSON de origem foram preservados.",
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await closeDb();
  }
}

main().catch((error) => {
  console.error("Falha crítica na migração:", error.message);
  process.exitCode = 1;
});
