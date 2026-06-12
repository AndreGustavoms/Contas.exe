import { google } from "googleapis";

const SCOPES = ["openid", "email", "profile"];

function env(name) {
  return process.env[name] ?? "";
}

function requireEnv(name) {
  const value = env(name);
  if (!value) {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

function allowedDomains() {
  return env("GOOGLE_AUTH_ALLOWED_DOMAIN")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function googleAuthConfigured() {
  return Boolean(
    env("GOOGLE_AUTH_CLIENT_ID") && env("GOOGLE_AUTH_CLIENT_SECRET"),
  );
}

function createOAuthClient(redirectUri) {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_AUTH_CLIENT_ID"),
    requireEnv("GOOGLE_AUTH_CLIENT_SECRET"),
    redirectUri,
  );
}

export function buildGoogleAuthUrl({ redirectUri, state }) {
  const client = createOAuthClient(redirectUri);
  const domains = allowedDomains();

  return client.generateAuthUrl({
    scope: SCOPES,
    state,
    prompt: "select_account",
    ...(domains.length === 1 ? { hd: domains[0] } : {}),
  });
}

export async function exchangeGoogleAuthCode({ code, redirectUri }) {
  const clientId = requireEnv("GOOGLE_AUTH_CLIENT_ID");
  const client = createOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);

  if (!tokens.id_token) {
    throw new Error("missing_id_token");
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: clientId,
  });
  const payload = ticket.getPayload();
  const email = payload?.email?.trim().toLowerCase();
  const sub = payload?.sub;

  if (!sub || !email || payload?.email_verified !== true) {
    throw new Error("unverified_email");
  }

  const domains = allowedDomains();
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  if (domains.length > 0 && !domains.includes(domain)) {
    throw new Error("domain_not_allowed");
  }

  return {
    sub,
    email,
    fullName: payload.name ?? "",
    picture: payload.picture ?? "",
  };
}
