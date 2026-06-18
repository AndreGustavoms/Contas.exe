// YouTube Data API integration (OAuth 2.0 + upload).
//
// Phase 0 goal: prove that we can connect a channel via OAuth and upload a
// scheduled video end to end. Tokens are stored separately from the account
// vault (storage/youtube.json) and the Google client secret comes from .env.
//
// Security notes:
//   - .env (client id/secret) and storage/*.json are git-ignored.
//   - We only keep the refresh_token long term; access tokens are short lived
//     and refreshed on demand by googleapis.
//   - When this moves to a public domain, set YOUTUBE_REDIRECT_URI to the
//     https callback and re-run the consent flow. No code changes needed.

import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { decryptField, encryptField } from "./crypto.mjs";
import { isConnected, query } from "./db.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const storageDir =
  process.env.CONTAS_FLOW_STORAGE_DIR ?? join(rootDir, "storage");
const tokensFile =
  process.env.YOUTUBE_TOKENS_DB ?? join(storageDir, "youtube.json");

// Videos to upload must already live inside this directory on the server. The
// upload endpoint accepts only a bare file NAME (never a path), which we resolve
// here — this confinement is what makes the feature safe to expose: a caller can
// never point it at an arbitrary absolute path to read files off the server.
// A request body is capped at 1 MB, so streaming the bytes through the API is a
// non-starter anyway; staging the file on disk first is the practical design.
const uploadsDir =
  process.env.YOUTUBE_UPLOAD_DIR ?? join(storageDir, "youtube-uploads");

// Official YouTube upload limits used for deterministic pre-flight checks.
// Source: YouTube Help / YouTube Data API docs (256 GB or 12 hours).
export const YOUTUBE_MAX_UPLOAD_BYTES = 256 * 1024 * 1024 * 1024;
export const YOUTUBE_MAX_DURATION_SECONDS = 12 * 60 * 60;

// Histórico de publicações. Guardamos só METADADOS (título, descrição, duração,
// capa, ids) — nunca o arquivo de vídeo. O Contas é mero intermediário: o vídeo
// passa por aqui rumo ao YouTube e é apagado assim que o upload termina.
const historyFile =
  process.env.YOUTUBE_HISTORY_DB ?? join(storageDir, "youtube-history.json");

// Scopes: youtube.force-ssl covers upload + delete + read (superset of
// youtube.upload). Channels connected before this scope was added need to
// re-authorize once via /api/youtube/connect.
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

// A fresh OAuth2 client configured from .env. One per call keeps it stateless.
function createOAuthClient() {
  return new google.auth.OAuth2(
    requireEnv("YOUTUBE_CLIENT_ID"),
    requireEnv("YOUTUBE_CLIENT_SECRET"),
    requireEnv("YOUTUBE_REDIRECT_URI"),
  );
}

// ----- Token storage (channels) -----
// Shape: { channels: [{ ownerId, id, title, refreshToken, connectedAt }] }
// refreshToken is encrypted at rest (see server/crypto.mjs); the rest of this
// module works with the decrypted token in memory.

function safeStorageKey(value) {
  const safe = String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("invalid_user_id");
  return safe;
}

async function readTokensJson() {
  try {
    const raw = await readFile(tokensFile, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.channels)) return { channels: [] };
    for (const channel of parsed.channels) {
      if (channel.refreshToken != null) {
        channel.refreshToken = decryptField(channel.refreshToken);
      }
    }
    return parsed;
  } catch {
    return { channels: [] };
  }
}

async function writeTokensJson(data) {
  await mkdir(storageDir, { recursive: true });
  const encrypted = structuredClone(data);
  for (const channel of encrypted.channels ?? []) {
    if (channel.refreshToken != null) {
      channel.refreshToken = encryptField(channel.refreshToken);
    }
  }
  await writeFile(
    tokensFile,
    `${JSON.stringify(encrypted, null, 2)}\n`,
    "utf8",
  );
}

async function saveChannel(channel) {
  if (isConnected()) {
    const refreshEnc = channel.refreshToken ? encryptField(channel.refreshToken) : null;
    await query(
      `INSERT INTO youtube_channels (owner_id, channel_id, title, refresh_token_enc, connected_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (owner_id, channel_id) DO UPDATE SET
         title = EXCLUDED.title,
         refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, youtube_channels.refresh_token_enc),
         connected_at = EXCLUDED.connected_at`,
      [channel.ownerId, channel.id, channel.title, refreshEnc, channel.connectedAt ?? new Date().toISOString()]
    );
    return channel;
  }

  const data = await readTokensJson();
  const index = data.channels.findIndex(
    (item) => item.id === channel.id && item.ownerId === channel.ownerId,
  );
  if (index === -1) {
    data.channels.push(channel);
  } else {
    data.channels[index] = {
      ...data.channels[index],
      ...channel,
      refreshToken: channel.refreshToken || data.channels[index].refreshToken,
    };
  }
  await writeTokensJson(data);
  return data.channels.find(
    (item) => item.id === channel.id && item.ownerId === channel.ownerId,
  );
}

// ----- OAuth flow -----

// Step 1: URL the user visits to grant access. access_type=offline + prompt
// =consent ensures we receive a refresh_token (needed for unattended uploads).
export function buildAuthUrl(state) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    ...(state ? { state } : {}),
  });
}

// Step 2: Google redirects back with ?code=...; exchange it for tokens, read
// the channel identity, and persist the refresh token.
export async function handleOAuthCallback(code, ownerId) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const youtube = google.youtube({ version: "v3", auth: client });
  const response = await youtube.channels.list({
    part: ["snippet"],
    mine: true,
  });

  const channel = response.data.items?.[0];
  const saved = await saveChannel({
    ownerId: safeStorageKey(ownerId),
    id: channel?.id ?? "unknown",
    title: channel?.snippet?.title ?? "Canal sem nome",
    refreshToken: tokens.refresh_token ?? "",
    connectedAt: new Date().toISOString(),
  });

  return saved;
}

// List connected channels (no secrets) for display.
export async function listConnectedChannels(ownerId) {
  if (isConnected()) {
    const safeOwnerId = safeStorageKey(ownerId);
    const res = await query(
      `SELECT channel_id AS id, title, connected_at AS "connectedAt"
       FROM youtube_channels WHERE owner_id = $1 ORDER BY connected_at`,
      [safeOwnerId]
    );
    return res.rows.map((r) => ({ ...r, connectedAt: r.connectedAt?.toISOString() ?? null }));
  }

  const data = await readTokensJson();
  const safeOwnerId = safeStorageKey(ownerId);
  return data.channels
    .filter((channel) => channel.ownerId === safeOwnerId)
    .map(({ id, title, connectedAt }) => ({ id, title, connectedAt }));
}

// Build an authenticated client for a given channel using its refresh token.
async function clientForChannel(channelId, ownerId) {
  const safeOwnerId = safeStorageKey(ownerId);

  if (isConnected()) {
    const res = await query(
      `SELECT refresh_token_enc FROM youtube_channels
       WHERE channel_id = $1 AND owner_id = $2`,
      [channelId, safeOwnerId]
    );
    if (!res.rows.length || !res.rows[0].refresh_token_enc) {
      throw new Error("channel_not_connected");
    }
    const refreshToken = decryptField(res.rows[0].refresh_token_enc);
    const client = createOAuthClient();
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  const data = await readTokensJson();
  const channel = data.channels.find(
    (item) => item.id === channelId && item.ownerId === safeOwnerId,
  );
  if (!channel?.refreshToken) {
    throw new Error("channel_not_connected");
  }
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: channel.refreshToken });
  return client;
}

// ----- Upload staging directory -----

// Absolute path of the uploads directory (for display so the user knows where
// to drop files). Make sure it exists.
export async function ensureUploadsDir() {
  await mkdir(uploadsDir, { recursive: true });
  return resolve(uploadsDir);
}

function uploadsDirForOwner(ownerId) {
  if (!ownerId) return resolve(uploadsDir);
  return resolve(uploadsDir, safeStorageKey(ownerId));
}

export function uploadsDirectory(ownerId) {
  return uploadsDirForOwner(ownerId);
}

// Resolve a caller-supplied file name to an absolute path confined to
// uploadsDir. Accepts ONLY a bare file name: anything carrying a path separator,
// an absolute path, a drive letter, or a "." / ".." segment is rejected. A bare
// name survives basename() unchanged, so that single comparison rejects every
// traversal/absolute form on both POSIX and Windows. Throws "invalid_file".
export function resolveUploadPath(name, ownerId) {
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("invalid_file");
  }
  if (
    /[\\/]/.test(name) ||
    /^[A-Za-z]:/.test(name) ||
    basename(name) !== name ||
    name === "." ||
    name === ".."
  ) {
    throw new Error("invalid_file");
  }
  const dir = uploadsDirForOwner(ownerId);
  const resolved = resolve(dir, name);
  // Defense in depth: confirm the result really sits inside uploadsDir.
  if (resolved !== join(dir, name) || !resolved.startsWith(dir + sep)) {
    throw new Error("invalid_file");
  }
  return resolved;
}

// List the video files currently staged for upload (name + size in bytes).
// Returns [] when the directory doesn't exist yet.
export async function listUploadableFiles(ownerId) {
  const dir = uploadsDirForOwner(ownerId);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const { size } = await stat(join(dir, entry.name));
      files.push({ name: entry.name, size });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// Cap for a single staged video. Browser→server streaming bypasses the JSON
// body cap, but we still bound it so a runaway upload can't fill the disk.
function configuredUploadCap() {
  const configured = Number(process.env.YOUTUBE_MAX_STAGING_BYTES);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, YOUTUBE_MAX_UPLOAD_BYTES);
  }
  return YOUTUBE_MAX_UPLOAD_BYTES;
}

export const MAX_STAGED_UPLOAD_BYTES = configuredUploadCap();

// Turn an arbitrary client filename into a safe, unique, bare name confined to
// the uploads dir (timestamp prefix avoids collisions; only [A-Za-z0-9._-]).
function safeUploadName(name) {
  const base = basename(typeof name === "string" ? name : "").trim();
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(-180);
  return `${Date.now()}-${cleaned || "video"}`;
}

// Streams an incoming request body straight to a file in the uploads dir, so a
// large video never has to be buffered in memory. Returns { name, size }. Aborts
// (and cleans up the partial file) past MAX_UPLOAD_BYTES.
// Remove staged files left behind by uploads that were never published (e.g. the
// user closed the tab mid-flow). Defensive: the normal path deletes right after
// publishing. Best-effort, never throws.
async function sweepStaleUploads(dir, maxAgeMs = 2 * 60 * 60 * 1000) {
  try {
    const now = Date.now();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = join(dir, entry.name);
      const info = await stat(full).catch(() => null);
      if (info && now - info.mtimeMs > maxAgeMs) {
        await unlink(full).catch((e) => console.warn("cleanup: falha ao remover arquivo expirado", full, e.message));
      }
    }
  } catch {
    /* directory may not exist yet */
  }
}

export async function stageUpload(originalName, source, ownerId) {
  const dir = uploadsDirForOwner(ownerId);
  await mkdir(dir, { recursive: true });
  await sweepStaleUploads(dir);
  const name = safeUploadName(originalName);
  const dest = resolveUploadPath(name, ownerId); // validates confinement

  let size = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_STAGED_UPLOAD_BYTES) {
        cb(new Error("file_too_large"));
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(source, counter, createWriteStream(dest));
  } catch (error) {
    await unlink(dest).catch(() => {});
    throw error;
  }
  return { name, size };
}

// ----- Chunked upload (browser splits file into ≤5 MB pieces) -----
// Each piece is a separate POST so no single request exceeds Railway's ~60 s
// proxy timeout. The server appends chunks to a temp file; the client calls
// finalizeChunkedUpload after the last chunk to get back the staged file name.

export async function appendChunk(uploadId, chunkStream, ownerId) {
  const dir = uploadsDirForOwner(ownerId);
  await mkdir(dir, { recursive: true });

  // Validate uploadId: only hex chars (we generate it as randomUUID stripped of dashes)
  if (!/^[a-f0-9]{32}$/.test(uploadId)) throw new Error("invalid_upload_id");

  const tmpPath = join(dir, `${uploadId}.tmp`);

  // Check cumulative size before appending
  let existing = 0;
  try { existing = (await stat(tmpPath)).size; } catch { /* new file */ }
  if (existing >= MAX_STAGED_UPLOAD_BYTES) throw new Error("file_too_large");

  let chunkSize = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      chunkSize += chunk.length;
      if (existing + chunkSize > MAX_STAGED_UPLOAD_BYTES) {
        cb(new Error("file_too_large"));
        return;
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(chunkStream, counter, createWriteStream(tmpPath, { flags: "a" }));
  } catch (error) {
    throw error;
  }
  return { uploadId, received: existing + chunkSize };
}

export async function finalizeChunkedUpload(uploadId, originalName, ownerId) {
  if (!/^[a-f0-9]{32}$/.test(uploadId)) throw new Error("invalid_upload_id");
  const dir = uploadsDirForOwner(ownerId);
  const tmpPath = join(dir, `${uploadId}.tmp`);

  let info;
  try { info = await stat(tmpPath); } catch { throw new Error("upload_not_found"); }
  if (info.size === 0) throw new Error("empty_file");

  const finalName = safeUploadName(originalName || "video");
  const finalPath = resolveUploadPath(finalName, ownerId);

  // Rename tmp → final staged file
  const { rename } = await import("node:fs/promises");
  await rename(tmpPath, finalPath);
  return { name: finalName, size: info.size };
}

// ----- Upload history (metadata only) -----

async function readHistoryJson() {
  try {
    const raw = await readFile(historyFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

// Records a completed upload in history without re-uploading. Used by the
// browser-direct upload flow where the video goes straight to YouTube.
export async function recordUpload({
  ownerId,
  channelId,
  videoId,
  title,
  description,
  tags,
  privacyStatus,
  publishAt,
}) {
  const safeOwnerId = safeStorageKey(ownerId);
  await appendHistory({
    ownerId: safeOwnerId,
    channelId,
    videoId,
    title: title ?? null,
    description: description ?? null,
    tags: tags ?? [],
    privacyStatus: privacyStatus ?? null,
    publishAt: publishAt ?? null,
    durationSeconds: null,
    thumbnailUrl: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
    uploadedAt: new Date().toISOString(),
  });
}

async function appendHistory(record) {
  if (isConnected()) {
    await query(
      `INSERT INTO youtube_uploads
         (owner_id, channel_id, video_id, title, description, tags, privacy_status, publish_at, duration_seconds, thumbnail_url, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.ownerId,
        record.channelId,
        record.videoId,
        record.title ?? null,
        record.description ?? null,
        record.tags ? JSON.stringify(record.tags) : null,
        record.privacyStatus ?? null,
        record.publishAt ?? null,
        record.durationSeconds ?? null,
        record.thumbnailUrl ?? null,
        record.uploadedAt ?? new Date().toISOString(),
      ]
    );
    return;
  }

  const items = await readHistoryJson();
  items.unshift(record);
  await mkdir(storageDir, { recursive: true });
  await writeFile(
    historyFile,
    `${JSON.stringify({ items: items.slice(0, 200) }, null, 2)}\n`,
    "utf8",
  );
}

// Most recent uploads first (metadata only — never the video itself).
export async function listUploadHistory(ownerId) {
  const safeOwnerId = safeStorageKey(ownerId);

  if (isConnected()) {
    const res = await query(
      `SELECT owner_id AS "ownerId", channel_id AS "channelId", video_id AS "videoId",
              title, description, tags, privacy_status AS "privacyStatus",
              publish_at AS "publishAt", duration_seconds AS "durationSeconds",
              thumbnail_url AS "thumbnailUrl", uploaded_at AS "uploadedAt"
       FROM youtube_uploads WHERE owner_id = $1
       ORDER BY uploaded_at DESC LIMIT 200`,
      [safeOwnerId]
    );
    return res.rows.map((r) => ({
      ...r,
      tags: r.tags ? JSON.parse(r.tags) : [],
      publishAt: r.publishAt?.toISOString() ?? null,
      uploadedAt: r.uploadedAt?.toISOString() ?? null,
    }));
  }

  const items = await readHistoryJson();
  return items.filter((item) => item.ownerId === safeOwnerId);
}

// Aplica um patch (título/descrição/privacidade) ao item do histórico, para a
// lista refletir a edição na hora.
async function updateHistory(videoId, ownerId, patch) {
  const safeOwnerId = safeStorageKey(ownerId);

  if (isConnected()) {
    const sets = [];
    const params = [];
    let p = 1;
    if (patch.title !== undefined) { sets.push(`title = $${p++}`); params.push(patch.title); }
    if (patch.description !== undefined) { sets.push(`description = $${p++}`); params.push(patch.description); }
    if (patch.privacyStatus !== undefined) { sets.push(`privacy_status = $${p++}`); params.push(patch.privacyStatus); }
    if (!sets.length) return;
    params.push(videoId, safeOwnerId);
    await query(
      `UPDATE youtube_uploads SET ${sets.join(", ")} WHERE video_id = $${p} AND owner_id = $${p + 1}`,
      params
    );
    return;
  }

  const items = await readHistoryJson();
  let changed = false;
  for (const item of items) {
    if (item.videoId === videoId && item.ownerId === safeOwnerId) {
      Object.assign(item, patch);
      changed = true;
    }
  }
  if (!changed) return;
  await mkdir(storageDir, { recursive: true });
  await writeFile(historyFile, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");
}

async function removeFromHistory(videoId, ownerId) {
  const safeOwnerId = safeStorageKey(ownerId);

  if (isConnected()) {
    await query(
      "DELETE FROM youtube_uploads WHERE video_id = $1 AND owner_id = $2",
      [videoId, safeOwnerId]
    );
    return;
  }

  const items = await readHistoryJson();
  const filtered = items.filter(
    (item) => item.videoId !== videoId || item.ownerId !== safeOwnerId,
  );
  await mkdir(storageDir, { recursive: true });
  await writeFile(historyFile, `${JSON.stringify({ items: filtered }, null, 2)}\n`, "utf8");
}

export async function deleteVideo(channelId, videoId, ownerId) {
  const auth = await clientForChannel(channelId, ownerId);
  const youtube = google.youtube({ version: "v3", auth });
  await youtube.videos.delete({ id: videoId });
  await removeFromHistory(videoId, ownerId);
}

// Edita um vídeo já postado (título/descrição/privacidade). videos.update exige
// o snippet inteiro (com categoryId), então lemos o atual e mesclamos. Atualiza
// o histórico para a lista refletir na hora.
export async function updateVideo({
  channelId,
  videoId,
  ownerId,
  title,
  description,
  privacyStatus,
}) {
  const auth = await clientForChannel(channelId, ownerId);
  const youtube = google.youtube({ version: "v3", auth });

  const current = await youtube.videos.list({
    part: ["snippet", "status"],
    id: [videoId],
  });
  const item = current.data.items?.[0];
  if (!item) throw new Error("video_not_found");

  const snippet = { ...item.snippet };
  if (typeof title === "string" && title.trim()) snippet.title = title.trim();
  if (typeof description === "string") snippet.description = description;

  const status = { ...item.status };
  if (privacyStatus && PRIVACY_STATUSES.has(privacyStatus)) {
    status.privacyStatus = privacyStatus;
  }

  await youtube.videos.update({
    part: ["snippet", "status"],
    requestBody: { id: videoId, snippet, status },
  });

  await updateHistory(videoId, ownerId, {
    title: snippet.title,
    description: snippet.description ?? "",
    privacyStatus: status.privacyStatus,
  });

  return {
    videoId,
    title: snippet.title,
    description: snippet.description ?? "",
    privacyStatus: status.privacyStatus,
  };
}

// ISO 8601 duration ("PT1M30S") -> seconds. Null if unparseable.
function parseIsoDuration(iso) {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? "");
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h || 0) * 3600 + Number(m || 0) * 60 + Number(s || 0);
}

// ----- Upload (with optional scheduling via publishAt) -----
//
// options: { channelId, file, title, description, tags, publishAt }
// `file` is a bare file name staged inside the uploads directory (see above).
// If publishAt (ISO 8601, future) is given, the video is uploaded as private
// and YouTube flips it to public automatically at that time.
const PRIVACY_STATUSES = new Set(["public", "unlisted", "private"]);

const YOUTUBE_REASON_EXPLANATIONS = {
  uploadLimitExceeded:
    "O canal atingiu o limite de uploads permitido pelo YouTube no momento. Aguarde e tente de novo mais tarde.",
  quotaExceeded:
    "A cota da API do YouTube acabou para este projeto. Tente depois do reset da cota ou revise a cota no Google Cloud.",
  insufficientPermissions:
    "A conexao com o YouTube nao tem permissao suficiente para publicar. Conecte o canal novamente.",
  authenticatedUserNotChannel:
    "A conta Google conectada nao possui um canal do YouTube valido para receber o upload.",
  authenticatedUserAccountClosed:
    "A conta do YouTube conectada esta encerrada.",
  authenticatedUserAccountSuspended:
    "A conta do YouTube conectada esta suspensa.",
  channelClosed: "O canal do YouTube foi encerrado.",
  channelSuspended: "O canal do YouTube esta suspenso.",
  forbiddenPrivacySetting:
    "O YouTube nao aceitou a configuracao de privacidade escolhida para este canal.",
  forbiddenLicenseSetting:
    "O YouTube nao aceitou a configuracao de licenca deste video.",
  invalidTitle:
    "O titulo foi recusado pelo YouTube. Verifique se ele nao esta vazio e se respeita o limite do YouTube.",
  invalidDescription:
    "A descricao foi recusada pelo YouTube. Reduza ou ajuste o texto e tente novamente.",
  invalidTags:
    "As tags foram recusadas pelo YouTube. Remova tags muito longas ou invalidas e tente novamente.",
  invalidPublishAt:
    "A data de agendamento foi recusada pelo YouTube. Escolha uma data futura valida.",
  invalidFilename:
    "O nome do arquivo foi recusado pelo YouTube. Renomeie o video e tente novamente.",
  mediaBodyRequired:
    "O YouTube nao recebeu o arquivo de video. Escolha o arquivo novamente e tente publicar.",
};

function cleanErrorText(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 1000) : fallback;
}

function explainYouTubeError({ source, status, reason }) {
  if (reason && YOUTUBE_REASON_EXPLANATIONS[reason]) {
    return YOUTUBE_REASON_EXPLANATIONS[reason];
  }
  if (source === "network") {
    return "Nao consegui concluir a comunicacao com o YouTube. Confira a conexao e tente novamente.";
  }
  if (status === 401) {
    return "A conexao com o YouTube expirou ou foi revogada. Conecte o canal novamente.";
  }
  if (status === 403) {
    return "O YouTube negou a publicacao. Pode ser permissao, limite do canal, cota ou alguma restricao da conta.";
  }
  if (status === 400) {
    return "O YouTube recusou algum dado do video. Confira titulo, descricao, tags, agendamento e arquivo.";
  }
  if (status >= 500) {
    return "O YouTube ficou instavel durante o upload. Tente novamente em alguns minutos.";
  }
  return "O YouTube recusou o upload. Veja a mensagem oficial retornada abaixo.";
}

export class YouTubeUploadError extends Error {
  constructor(details) {
    super(details.message);
    this.name = "YouTubeUploadError";
    this.details = details;
  }
}

export function isYouTubeUploadError(error) {
  return error instanceof YouTubeUploadError;
}

function toYouTubeUploadError(error) {
  const responseData = error?.response?.data;
  const apiError =
    responseData?.error && typeof responseData.error === "object"
      ? responseData.error
      : null;
  const rawErrors = Array.isArray(apiError?.errors)
    ? apiError.errors
    : Array.isArray(error?.errors)
      ? error.errors
      : [];
  const errors = rawErrors
    .filter((item) => item && typeof item === "object")
    .slice(0, 3)
    .map((item) => ({
      reason: cleanErrorText(item.reason),
      domain: cleanErrorText(item.domain),
      message: cleanErrorText(item.message),
    }));
  const first = errors[0] ?? {};
  const status = Number(
    apiError?.code ?? error?.response?.status ?? error?.status ?? error?.code,
  );
  const hasYoutubeResponse = Boolean(apiError || error?.response?.status);
  const source = hasYoutubeResponse ? "youtube" : "network";
  const details = {
    source,
    status: Number.isFinite(status) ? status : 0,
    reason: first.reason || cleanErrorText(error?.reason),
    domain: first.domain,
    message: cleanErrorText(
      apiError?.message ?? first.message ?? error?.message,
      source === "youtube"
        ? "O YouTube recusou o upload."
        : "Falha de comunicacao com o YouTube.",
    ),
    errors,
  };
  return new YouTubeUploadError({
    ...details,
    userMessage: explainYouTubeError(details),
    retryable:
      details.source === "network" ||
      [500, 502, 503, 504].includes(details.status),
  });
}

// Initiates a YouTube resumable upload session and returns the upload URI so
// the browser can stream the file directly to YouTube — bypassing the Railway
// proxy timeout that kills large uploads routed through the server.
export async function initiateResumableUpload({
  ownerId,
  channelId,
  title,
  description = "",
  tags = [],
  publishAt,
  privacyStatus = "private",
  fileSizeBytes,
  mimeType = "video/*",
}) {
  const safeOwnerId = safeStorageKey(ownerId);
  const auth = await clientForChannel(channelId, safeOwnerId);
  const { token } = await auth.getAccessToken();
  if (!token) throw new Error("no_access_token");

  const status = publishAt
    ? { privacyStatus: "private", publishAt }
    : { privacyStatus: PRIVACY_STATUSES.has(privacyStatus) ? privacyStatus : "private" };

  const metadata = {
    snippet: { title, description, tags },
    status,
  };

  const res = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        ...(fileSizeBytes ? { "X-Upload-Content-Length": String(fileSizeBytes) } : {}),
      },
      body: JSON.stringify(metadata),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error("youtube_resumable_init_failed"), {
      status: res.status,
      details: text,
    });
  }

  const uploadUri = res.headers.get("location");
  if (!uploadUri) throw new Error("youtube_no_upload_uri");
  return { uploadUri };
}

export async function uploadVideo({
  ownerId,
  channelId,
  file,
  title,
  description = "",
  tags = [],
  publishAt,
  privacyStatus = "private",
}) {
  const safeOwnerId = safeStorageKey(ownerId);
  const filePath = resolveUploadPath(file, safeOwnerId);
  let fileInfo;
  try {
    fileInfo = await stat(filePath);
  } catch {
    throw new Error("file_not_found");
  }
  if (fileInfo.size <= 0) {
    throw new Error("empty_file");
  }
  if (fileInfo.size > YOUTUBE_MAX_UPLOAD_BYTES) {
    throw new Error("youtube_file_too_large");
  }

  const auth = await clientForChannel(channelId, safeOwnerId);
  const youtube = google.youtube({ version: "v3", auth });

  // A scheduled video MUST start private; YouTube flips it public at publishAt.
  // Otherwise honor the chosen privacy (defaulting to private if unrecognized).
  const status = publishAt
    ? { privacyStatus: "private", publishAt }
    : {
        privacyStatus: PRIVACY_STATUSES.has(privacyStatus)
          ? privacyStatus
          : "private",
      };

  try {
    let response;
    try {
      response = await youtube.videos.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: { title, description, tags },
          status,
        },
        media: { body: createReadStream(filePath) },
      });
    } catch (error) {
      throw toYouTubeUploadError(error);
    }

    const videoId = response.data.id ?? null;

    // Best-effort: read the processed duration. May be null if YouTube hasn't
    // finished processing yet — that's fine, the history just omits it.
    let durationSeconds = null;
    if (videoId) {
      try {
        const details = await youtube.videos.list({
          part: ["contentDetails"],
          id: [videoId],
        });
        durationSeconds = parseIsoDuration(
          details.data.items?.[0]?.contentDetails?.duration,
        );
      } catch {
        /* leave null */
      }
    }

    const thumbnailUrl = videoId
      ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
      : null;

    const result = {
      videoId,
      title: response.data.snippet?.title ?? title,
      publishAt: response.data.status?.publishAt ?? null,
      privacyStatus: response.data.status?.privacyStatus,
      durationSeconds,
      thumbnailUrl,
    };

    // Histórico: só metadados, nunca o arquivo.
    await appendHistory({
      ownerId: safeOwnerId,
      videoId,
      channelId,
      title: result.title,
      description,
      tags,
      privacyStatus: result.privacyStatus,
      publishAt: result.publishAt,
      durationSeconds,
      thumbnailUrl,
      uploadedAt: new Date().toISOString(),
    });

    return result;
  } finally {
    await unlink(filePath).catch(() => {});
  }
}
