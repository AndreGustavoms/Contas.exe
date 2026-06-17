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

async function readTokens() {
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

async function writeTokens(data) {
  await mkdir(storageDir, { recursive: true });
  // Encrypt on a deep copy so the caller's in-memory token stays plaintext.
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
  const data = await readTokens();
  const index = data.channels.findIndex(
    (item) => item.id === channel.id && item.ownerId === channel.ownerId,
  );

  if (index === -1) {
    data.channels.push(channel);
  } else {
    // Keep the existing refresh token if Google didn't send a new one.
    data.channels[index] = {
      ...data.channels[index],
      ...channel,
      refreshToken: channel.refreshToken || data.channels[index].refreshToken,
    };
  }

  await writeTokens(data);
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
  const data = await readTokens();
  const safeOwnerId = safeStorageKey(ownerId);
  return data.channels
    .filter((channel) => channel.ownerId === safeOwnerId)
    .map(({ id, title, connectedAt }) => ({
      id,
      title,
      connectedAt,
    }));
}

// Build an authenticated client for a given channel using its refresh token.
async function clientForChannel(channelId, ownerId) {
  const data = await readTokens();
  const safeOwnerId = safeStorageKey(ownerId);
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
        await unlink(full).catch(() => {});
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

// ----- Upload history (metadata only) -----

async function readHistory() {
  try {
    const raw = await readFile(historyFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

async function appendHistory(record) {
  const items = await readHistory();
  items.unshift(record);
  await mkdir(storageDir, { recursive: true });
  // Cap so the file can't grow without bound.
  await writeFile(
    historyFile,
    `${JSON.stringify({ items: items.slice(0, 200) }, null, 2)}\n`,
    "utf8",
  );
}

// Most recent uploads first (metadata only — never the video itself).
export async function listUploadHistory(ownerId) {
  const safeOwnerId = safeStorageKey(ownerId);
  const items = await readHistory();
  return items.filter((item) => item.ownerId === safeOwnerId);
}

async function removeFromHistory(videoId, ownerId) {
  const safeOwnerId = safeStorageKey(ownerId);
  const items = await readHistory();
  const filtered = items.filter(
    (item) => item.videoId !== videoId || item.ownerId !== safeOwnerId,
  );
  await mkdir(storageDir, { recursive: true });
  await writeFile(
    historyFile,
    `${JSON.stringify({ items: filtered }, null, 2)}\n`,
    "utf8",
  );
}

export async function deleteVideo(channelId, videoId, ownerId) {
  const auth = await clientForChannel(channelId, ownerId);
  const youtube = google.youtube({ version: "v3", auth });
  await youtube.videos.delete({ id: videoId });
  await removeFromHistory(videoId, ownerId);
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
