import "dotenv/config";
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  buildAuthUrl,
  handleOAuthCallback,
  listConnectedChannels,
  uploadVideo,
} from "./youtube.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const storageDir = join(rootDir, "storage");
const dbFile = process.env.CONTAS_FLOW_DB ?? join(storageDir, "groups.json");
const legacyDbFile =
  process.env.CONTAS_FLOW_LEGACY_DB ?? join(storageDir, "accounts.json");
const port = Number(process.env.PORT ?? 8787);

const DEFAULT_GROUP_NAME = "Vitissouls";
const statuses = new Set(["active", "review", "archived", "inactive"]);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function ensureStorage() {
  await mkdir(storageDir, { recursive: true });
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeRecord(input = {}, existing = {}) {
  const status = statuses.has(input.status) ? input.status : "active";

  return {
    id: asString(existing.id || input.id) || randomUUID(),
    platform: asString(input.platform).trim() || "Outra",
    role: asString(input.role).trim() || "Outra",
    owner: asString(input.owner).trim() || "Andre",
    label: asString(input.label).trim(),
    email: asString(input.email).trim(),
    username: asString(input.username).trim(),
    password: asString(input.password),
    recoveryEmail: asString(input.recoveryEmail).trim(),
    phone: asString(input.phone).trim(),
    status,
    twoFactor: Boolean(input.twoFactor),
    postDay: asString(input.postDay).trim(),
    niche: asString(input.niche).trim(),
    notes: asString(input.notes).trim(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeGroup(input = {}) {
  const accounts = Array.isArray(input.accounts)
    ? input.accounts.map((record) => normalizeRecord(record, record))
    : [];

  return {
    id: asString(input.id) || randomUUID(),
    name: asString(input.name).trim() || "Grupo",
    accounts,
  };
}

function emptyDb() {
  const group = normalizeGroup({ name: DEFAULT_GROUP_NAME });
  return { groups: [group], activeGroupId: group.id };
}

// Reads the database. On first run, migrates a legacy accounts.json array
// into a single "Vitissouls" group so existing accounts are preserved.
async function readDb() {
  await ensureStorage();

  try {
    const raw = await readFile(dbFile, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeDb(parsed);
  } catch {
    // No groups file yet: try to migrate the legacy accounts.json.
    const migrated = await migrateLegacy();
    await writeDb(migrated);
    return migrated;
  }
}

function normalizeDb(parsed) {
  const groups = Array.isArray(parsed?.groups)
    ? parsed.groups.map(normalizeGroup)
    : [];

  if (!groups.length) {
    return emptyDb();
  }

  const activeGroupId = groups.some(
    (group) => group.id === parsed?.activeGroupId,
  )
    ? parsed.activeGroupId
    : groups[0].id;

  return { groups, activeGroupId };
}

async function migrateLegacy() {
  try {
    const raw = await readFile(legacyDbFile, "utf8");
    const parsed = JSON.parse(raw);
    const accounts = Array.isArray(parsed) ? parsed : [];

    const group = normalizeGroup({ name: DEFAULT_GROUP_NAME, accounts });
    return { groups: [group], activeGroupId: group.id };
  } catch {
    return emptyDb();
  }
}

async function writeDb(db) {
  await ensureStorage();
  await writeFile(dbFile, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function groupSummary(group) {
  return { id: group.id, name: group.name, count: group.accounts.length };
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

function notFound(response) {
  sendJson(response, 404, { error: "not_found" });
}

function badRequest(response, message) {
  sendJson(response, 400, { error: message ?? "bad_request" });
}

async function handleApi(request, response, url) {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Origin": "*",
    });
    response.end();
    return;
  }

  if (url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  // ----- YouTube (OAuth + upload) -----

  // Begin OAuth: redirect the browser to Google's consent screen.
  if (url.pathname === "/api/youtube/connect" && request.method === "GET") {
    try {
      response.writeHead(302, { Location: buildAuthUrl() });
      response.end();
    } catch (error) {
      sendJson(response, 500, {
        error: "youtube_config",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    return;
  }

  // OAuth callback: exchange code, save the channel, bounce back to the app.
  if (url.pathname === "/api/youtube/callback" && request.method === "GET") {
    const code = url.searchParams.get("code");

    if (!code) {
      sendJson(response, 400, { error: "missing_code" });
      return;
    }

    try {
      const channel = await handleOAuthCallback(code);
      response.writeHead(302, {
        Location: `/?youtube=connected&channel=${encodeURIComponent(channel?.title ?? "")}`,
      });
      response.end();
    } catch (error) {
      sendJson(response, 500, {
        error: "youtube_oauth",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    return;
  }

  // List connected channels (no secrets).
  if (url.pathname === "/api/youtube/channels" && request.method === "GET") {
    sendJson(response, 200, { channels: await listConnectedChannels() });
    return;
  }

  // Phase 0 test upload. Body: { channelId, filePath, title, description?,
  // tags?, publishAt? }. publishAt is an ISO date in the future to schedule.
  if (url.pathname === "/api/youtube/upload" && request.method === "POST") {
    const body = await readBody(request);

    if (!body.channelId || !body.filePath || !body.title) {
      badRequest(response, "channelId, filePath e title são obrigatórios");
      return;
    }

    try {
      const result = await uploadVideo(body);
      sendJson(response, 201, result);
    } catch (error) {
      sendJson(response, 500, {
        error: "youtube_upload",
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    return;
  }

  // ----- Groups -----
  if (url.pathname === "/api/groups" && request.method === "GET") {
    const db = await readDb();
    sendJson(response, 200, {
      groups: db.groups.map(groupSummary),
      activeGroupId: db.activeGroupId,
    });
    return;
  }

  if (url.pathname === "/api/groups" && request.method === "POST") {
    const body = await readBody(request);
    const db = await readDb();
    const group = normalizeGroup({
      name: asString(body.name).trim() || "Novo grupo",
      accounts: Array.isArray(body.accounts) ? body.accounts : [],
    });

    db.groups.push(group);
    db.activeGroupId = group.id;
    await writeDb(db);
    sendJson(response, 201, groupSummary(group));
    return;
  }

  if (url.pathname === "/api/groups/active" && request.method === "PUT") {
    const body = await readBody(request);
    const db = await readDb();

    if (!db.groups.some((group) => group.id === body.activeGroupId)) {
      notFound(response);
      return;
    }

    db.activeGroupId = body.activeGroupId;
    await writeDb(db);
    sendJson(response, 200, { activeGroupId: db.activeGroupId });
    return;
  }

  const groupMatch = url.pathname.match(/^\/api\/groups\/([^/]+)$/);
  if (groupMatch) {
    const db = await readDb();
    const id = decodeURIComponent(groupMatch[1]);
    const index = db.groups.findIndex((group) => group.id === id);

    if (index === -1) {
      notFound(response);
      return;
    }

    if (request.method === "PUT") {
      const body = await readBody(request);
      const name = asString(body.name).trim();

      if (!name) {
        badRequest(response, "name_required");
        return;
      }

      db.groups[index] = { ...db.groups[index], name };
      await writeDb(db);
      sendJson(response, 200, groupSummary(db.groups[index]));
      return;
    }

    if (request.method === "DELETE") {
      if (db.groups.length <= 1) {
        badRequest(response, "cannot_delete_last_group");
        return;
      }

      db.groups.splice(index, 1);

      if (db.activeGroupId === id) {
        db.activeGroupId = db.groups[0].id;
      }

      await writeDb(db);
      sendJson(response, 200, {
        groups: db.groups.map(groupSummary),
        activeGroupId: db.activeGroupId,
      });
      return;
    }

    notFound(response);
    return;
  }

  // ----- Accounts within a group -----
  const accountsMatch = url.pathname.match(
    /^\/api\/groups\/([^/]+)\/accounts$/,
  );
  if (accountsMatch) {
    const db = await readDb();
    const groupId = decodeURIComponent(accountsMatch[1]);
    const group = db.groups.find((item) => item.id === groupId);

    if (!group) {
      notFound(response);
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, group.accounts);
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const account = normalizeRecord(body);

      group.accounts.unshift(account);
      await writeDb(db);
      sendJson(response, 201, account);
      return;
    }

    notFound(response);
    return;
  }

  const importMatch = url.pathname.match(
    /^\/api\/groups\/([^/]+)\/accounts\/import$/,
  );
  if (importMatch && request.method === "POST") {
    const body = await readBody(request);
    const db = await readDb();
    const groupId = decodeURIComponent(importMatch[1]);
    const group = db.groups.find((item) => item.id === groupId);

    if (!group) {
      notFound(response);
      return;
    }

    const imported = Array.isArray(body) ? body : body.accounts;
    group.accounts = Array.isArray(imported)
      ? imported.map((record) => normalizeRecord(record))
      : [];

    await writeDb(db);
    sendJson(response, 200, group.accounts);
    return;
  }

  const accountMatch = url.pathname.match(
    /^\/api\/groups\/([^/]+)\/accounts\/([^/]+)$/,
  );
  if (accountMatch) {
    const db = await readDb();
    const groupId = decodeURIComponent(accountMatch[1]);
    const accountId = decodeURIComponent(accountMatch[2]);
    const group = db.groups.find((item) => item.id === groupId);

    if (!group) {
      notFound(response);
      return;
    }

    const index = group.accounts.findIndex(
      (account) => account.id === accountId,
    );

    if (index === -1) {
      notFound(response);
      return;
    }

    if (request.method === "PUT") {
      const body = await readBody(request);
      const updated = normalizeRecord(body, group.accounts[index]);

      group.accounts[index] = updated;
      await writeDb(db);
      sendJson(response, 200, updated);
      return;
    }

    if (request.method === "DELETE") {
      group.accounts.splice(index, 1);
      await writeDb(db);
      sendJson(response, 200, { ok: true });
      return;
    }

    notFound(response);
    return;
  }

  notFound(response);
}

async function serveStatic(request, response, url) {
  const distDir = join(rootDir, "dist");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = resolve(join(distDir, pathname));

  if (!filePath.startsWith(distDir)) {
    notFound(response);
    return;
  }

  try {
    await stat(filePath);
    response.writeHead(200, {
      "Content-Type":
        contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    const indexPath = join(distDir, "index.html");

    try {
      await stat(indexPath);
      response.writeHead(200, { "Content-Type": contentTypes[".html"] });
      createReadStream(indexPath).pipe(response);
    } catch {
      sendJson(response, 200, {
        ok: true,
        api: "/api/groups",
        message: "run npm run local for the app UI",
      });
    }
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(request, response, url);
  } catch (error) {
    sendJson(response, 500, {
      error: "server_error",
      message: error instanceof Error ? error.message : "unknown",
    });
  }
});

// Ensure the DB exists (and migrate legacy data) before accepting traffic.
await readDb();

server.listen(port, "127.0.0.1", () => {
  console.log(`Contas_exe API: http://127.0.0.1:${port}`);
});
