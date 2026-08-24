#!/usr/bin/env node
// One-time migration: imports all data from storage/*.json into PostgreSQL.
// Run this ONCE after setting up the database (schema.sql) and configuring
// DATABASE_URL. Safe to re-run (idempotent): skips users/groups/accounts that
// already exist (by username/id).
//
// Usage:
//   node server/migrate-json-to-pg.mjs
//
// Prerequisites:
//   1. PostgreSQL running and accessible via DATABASE_URL
//   2. Schema created (psql < server/schema.sql)
//   3. CONTAS_FLOW_ENC_KEY set (same key used by the JSON storage)

import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { closeDb, getClient, initDb } from "./db.mjs";
import { decryptField } from "./crypto.mjs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toUuid(id) {
  return UUID_RE.test(id ?? "") ? id : randomUUID();
}

const storageDir = process.env.CONTAS_FLOW_STORAGE_DIR ?? "./storage";

async function readJsonFile(filename) {
  try {
    const raw = await readFile(join(storageDir, filename), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Decrypt fields that were encrypted in the JSON store (password, recoveryEmail,
// phone, notes). The new schema stores them in *_enc columns (still encrypted),
// but we need to decrypt here to re-encrypt with the same key (idempotent).
function decryptIfNeeded(value) {
  if (typeof value === "string" && value.startsWith("enc:v1:")) {
    return decryptField(value);
  }
  return value;
}

// Maps original JSON id → UUID used in Postgres (needed when old ids aren't valid UUIDs)
const userIdMap = new Map();

async function migrateUsers(client) {
  const data = await readJsonFile("users.json");
  if (!data?.users) {
    console.log("⏭️  Nenhum usuário em users.json");
    return 0;
  }

  let imported = 0;
  for (const user of data.users) {
    const pgId = toUuid(user.id);
    userIdMap.set(user.id, pgId);
    try {
      const exists = await client.query(
        "SELECT id FROM users WHERE username = $1",
        [user.username],
      );
      if (exists.rows.length > 0) {
        const row = exists.rows[0];
        userIdMap.set(user.id, row.id);
        console.log(`   ⏭️  Usuário já existe: ${user.username}`);
        continue;
      }

      await client.query("SAVEPOINT sp_user");
      await client.query(
        `INSERT INTO users (
          id, username, email, full_name, password_hash, role,
          avatar_url, avatar_removed,
          two_factor_enabled, two_factor_secret, recovery_codes,
          google_id, google_email, google_picture,
          github_id, github_login, github_avatar,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
        [
          pgId,
          user.username,
          user.email ?? null,
          user.fullName ?? null,
          user.passwordHash,
          user.role,
          user.avatarUrl ?? null,
          user.avatarRemoved ?? false,
          user.twoFactor?.enabled ?? false,
          decryptIfNeeded(user.twoFactor?.secret) ?? null,
          user.twoFactor?.recoveryCodes
            ? user.twoFactor.recoveryCodes.map(decryptIfNeeded)
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
      await client.query("RELEASE SAVEPOINT sp_user");
      imported++;
      console.log(
        `   ✅ Importado usuário: ${user.username}${pgId !== user.id ? ` (id remapeado)` : ""}`,
      );
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_user");
      console.error(
        `   ❌ Erro ao importar usuário ${user.username}:`,
        error.message,
      );
    }
  }
  return imported;
}

async function migrateGroups(client) {
  const data = await readJsonFile("groups.json");
  if (!data?.groups) {
    console.log("⏭️  Nenhum grupo em groups.json");
    return { groups: 0, accounts: 0 };
  }

  let importedGroups = 0;
  let importedAccounts = 0;

  for (const group of data.groups) {
    const groupPgId = toUuid(group.id);
    const firstUserId = userIdMap.values().next().value;
    const ownerPgId =
      userIdMap.get(group.ownerId) ?? firstUserId ?? toUuid(group.ownerId);
    try {
      const exists = await client.query("SELECT id FROM groups WHERE id = $1", [
        groupPgId,
      ]);
      if (exists.rows.length > 0) {
        console.log(`   ⏭️  Grupo já existe: ${group.name}`);
      } else {
        await client.query("SAVEPOINT sp_group");
        await client.query(
          "INSERT INTO groups (id, name, owner_id) VALUES ($1, $2, $3)",
          [groupPgId, group.name, ownerPgId],
        );
        await client.query("RELEASE SAVEPOINT sp_group");
        importedGroups++;
        console.log(`   ✅ Importado grupo: ${group.name}`);
      }

      for (const account of group.accounts ?? []) {
        const accountPgId = toUuid(account.id);
        try {
          const accountExists = await client.query(
            "SELECT id FROM accounts WHERE id = $1",
            [accountPgId],
          );
          if (accountExists.rows.length > 0) {
            console.log(`      ⏭️  Conta já existe: ${account.id}`);
            continue;
          }

          await client.query("SAVEPOINT sp_account");
          await client.query(
            `INSERT INTO accounts (
              id, group_id, platform, role, owner, label, email, username,
              password_enc, recovery_email_enc, phone_enc, notes_enc,
              status, two_factor, post_day, niche, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              accountPgId,
              groupPgId,
              account.platform,
              account.role,
              account.owner,
              account.label ?? "",
              account.email ?? "",
              account.username ?? "",
              decryptIfNeeded(account.password) ?? null,
              decryptIfNeeded(account.recoveryEmail) ?? null,
              decryptIfNeeded(account.phone) ?? null,
              decryptIfNeeded(account.notes) ?? null,
              account.status ?? "active",
              account.twoFactor ?? false,
              account.postDay ?? "",
              account.niche ?? "",
              account.updatedAt ?? new Date().toISOString(),
            ],
          );
          await client.query("RELEASE SAVEPOINT sp_account");
          importedAccounts++;
          console.log(
            `      ✅ Importada conta: ${account.label || account.email || account.id}`,
          );
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT sp_account");
          console.error(
            `      ❌ Erro ao importar conta ${account.id}:`,
            error.message,
          );
        }
      }
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_group");
      console.error(
        `   ❌ Erro ao importar grupo ${group.name}:`,
        error.message,
      );
    }
  }

  return { groups: importedGroups, accounts: importedAccounts };
}

async function migrateSessions(client) {
  const data = await readJsonFile("sessions.json");
  if (!data?.sessions) {
    console.log("⏭️  Nenhuma sessão em sessions.json");
    return 0;
  }

  let imported = 0;
  for (const session of data.sessions) {
    try {
      const exists = await client.query(
        "SELECT session_id FROM sessions WHERE session_id = $1",
        [session.sessionId],
      );
      if (exists.rows.length > 0) {
        continue; // Skip existing sessions
      }

      const userPgId = userIdMap.get(session.userId) ?? toUuid(session.userId);
      await client.query("SAVEPOINT sp_session");
      await client.query(
        `INSERT INTO sessions (
          session_id, user_id, created_at, last_seen_at, expires_at,
          revoked_at, reauth_at, ip_enc, ip_hash, user_agent_enc, location_enc
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          session.sessionId,
          userPgId,
          new Date(session.createdAt).getTime(),
          session.lastSeenAt,
          session.expiresAt,
          session.revokedAt ? new Date(session.revokedAt) : null,
          session.reauthAt ?? null,
          decryptIfNeeded(session.ip) ?? null,
          session.ipHash ?? null,
          decryptIfNeeded(session.userAgent) ?? null,
          decryptIfNeeded(session.location) ?? null,
        ],
      );
      await client.query("RELEASE SAVEPOINT sp_session");
      imported++;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_session");
      console.error(`   ❌ Erro ao importar sessão:`, error.message);
    }
  }
  return imported;
}

async function migrateAudit(client) {
  const data = await readJsonFile("audit.json");
  if (!data?.events) {
    console.log("⏭️  Nenhum evento em audit.json");
    return 0;
  }

  let imported = 0;
  for (const event of data.events) {
    try {
      const userPgId = event.userId
        ? (userIdMap.get(event.userId) ?? null)
        : null;
      await client.query("SAVEPOINT sp_audit");
      await client.query(
        `INSERT INTO audit_events (ts, user_id, username, action, target, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          event.ts,
          userPgId,
          event.username ?? null,
          event.action,
          event.target ?? null,
          event.ipHash ?? null,
        ],
      );
      await client.query("RELEASE SAVEPOINT sp_audit");
      imported++;
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_audit");
      console.error(
        `   ❌ Erro ao importar evento de auditoria:`,
        error.message,
      );
    }
  }
  return imported;
}

async function migrateYouTube(client) {
  const data = await readJsonFile("youtube.json");
  if (!data?.channels) {
    console.log("⏭️  Nenhum canal do YouTube em youtube.json");
    return 0;
  }

  let imported = 0;
  for (const channel of data.channels) {
    try {
      const exists = await client.query(
        "SELECT id FROM youtube_channels WHERE channel_id = $1",
        [channel.channelId],
      );
      if (exists.rows.length > 0) {
        continue;
      }

      const ownerPgId =
        userIdMap.get(channel.ownerId) ?? toUuid(channel.ownerId);
      await client.query("SAVEPOINT sp_yt");
      await client.query(
        `INSERT INTO youtube_channels (
          owner_id, channel_id, title, access_token_enc, refresh_token_enc,
          token_expires_at, connected_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          ownerPgId,
          channel.channelId,
          channel.title ?? null,
          decryptIfNeeded(channel.tokens?.access_token) ?? null,
          decryptIfNeeded(channel.tokens?.refresh_token) ?? null,
          channel.tokens?.expiry_date ?? null,
          channel.connectedAt ?? new Date().toISOString(),
        ],
      );
      await client.query("RELEASE SAVEPOINT sp_yt");
      imported++;
      console.log(`   ✅ Importado canal: ${channel.title}`);
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT sp_yt");
      console.error(`   ❌ Erro ao importar canal do YouTube:`, error.message);
    }
  }
  return imported;
}

async function main() {
  console.log("🚀 Migrando dados JSON → PostgreSQL\n");

  const connected = await initDb();
  if (!connected) {
    console.error(
      "❌ Não foi possível conectar ao PostgreSQL. Configure DATABASE_URL.",
    );
    process.exit(1);
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");

    console.log("📦 Importando usuários...");
    const users = await migrateUsers(client);
    console.log(`   → ${users} usuários importados\n`);

    console.log("📦 Importando grupos e contas...");
    const { groups, accounts } = await migrateGroups(client);
    console.log(`   → ${groups} grupos importados`);
    console.log(`   → ${accounts} contas importadas\n`);

    console.log("📦 Importando sessões...");
    const sessions = await migrateSessions(client);
    console.log(`   → ${sessions} sessões importadas\n`);

    console.log("📦 Importando auditoria...");
    const audit = await migrateAudit(client);
    console.log(`   → ${audit} eventos importados\n`);

    console.log("📦 Importando canais do YouTube...");
    const youtube = await migrateYouTube(client);
    console.log(`   → ${youtube} canais importados\n`);

    await client.query("COMMIT");
    console.log("✅ Migração concluída com sucesso!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("\n❌ Erro durante a migração:", error);
    throw error;
  } finally {
    client.release();
    await closeDb();
  }
}

main().catch((error) => {
  console.error("💥 Falha crítica:", error);
  process.exit(1);
});
