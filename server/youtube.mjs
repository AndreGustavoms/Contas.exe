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

import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";
import { decryptField, encryptField } from "./crypto.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const storageDir = join(rootDir, "storage");
const tokensFile =
  process.env.YOUTUBE_TOKENS_DB ?? join(storageDir, "youtube.json");

// Scopes: upload + read own channel info. youtube.upload is enough to insert
// videos; youtube.readonly lets us read the channel name for display.
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
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
// Shape: { channels: [{ id, title, refreshToken, connectedAt }] }
// refreshToken is encrypted at rest (see server/crypto.mjs); the rest of this
// module works with the decrypted token in memory.

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
  const index = data.channels.findIndex((item) => item.id === channel.id);

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
  return data.channels.find((item) => item.id === channel.id);
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
export async function handleOAuthCallback(code) {
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
    id: channel?.id ?? "unknown",
    title: channel?.snippet?.title ?? "Canal sem nome",
    refreshToken: tokens.refresh_token ?? "",
    connectedAt: new Date().toISOString(),
  });

  return saved;
}

// List connected channels (no secrets) for display.
export async function listConnectedChannels() {
  const data = await readTokens();
  return data.channels.map(({ id, title, connectedAt }) => ({
    id,
    title,
    connectedAt,
  }));
}

// Build an authenticated client for a given channel using its refresh token.
async function clientForChannel(channelId) {
  const data = await readTokens();
  const channel = data.channels.find((item) => item.id === channelId);

  if (!channel?.refreshToken) {
    throw new Error("channel_not_connected");
  }

  const client = createOAuthClient();
  client.setCredentials({ refresh_token: channel.refreshToken });
  return client;
}

// ----- Upload (with optional scheduling via publishAt) -----
//
// options: { channelId, filePath, title, description, tags, publishAt }
// If publishAt (ISO 8601, future) is given, the video is uploaded as private
// and YouTube flips it to public automatically at that time.
export async function uploadVideo({
  channelId,
  filePath,
  title,
  description = "",
  tags = [],
  publishAt,
}) {
  const auth = await clientForChannel(channelId);
  const youtube = google.youtube({ version: "v3", auth });

  const status = publishAt
    ? { privacyStatus: "private", publishAt }
    : { privacyStatus: "private" };

  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: { title, description, tags },
      status,
    },
    media: { body: createReadStream(filePath) },
  });

  return {
    videoId: response.data.id,
    title: response.data.snippet?.title,
    publishAt: response.data.status?.publishAt ?? null,
    privacyStatus: response.data.status?.privacyStatus,
  };
}
