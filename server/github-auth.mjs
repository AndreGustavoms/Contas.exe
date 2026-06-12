function env(name) {
  return process.env[name] ?? "";
}

function requireEnv(name) {
  const value = env(name);
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

export function githubAuthConfigured() {
  return Boolean(
    env("GITHUB_AUTH_CLIENT_ID") && env("GITHUB_AUTH_CLIENT_SECRET"),
  );
}

export function buildGithubAuthUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: requireEnv("GITHUB_AUTH_CLIENT_ID"),
    redirect_uri: redirectUri,
    scope: "user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeGithubAuthCode({ code, redirectUri }) {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: requireEnv("GITHUB_AUTH_CLIENT_ID"),
      client_secret: requireEnv("GITHUB_AUTH_CLIENT_SECRET"),
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) throw new Error("github_token_exchange_failed");

  const tokenData = await tokenRes.json();
  if (tokenData.error || !tokenData.access_token) {
    throw new Error("github_token_exchange_failed");
  }

  const headers = {
    Authorization: `Bearer ${tokenData.access_token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Contas-flow",
  };

  const userRes = await fetch("https://api.github.com/user", { headers });
  if (!userRes.ok) throw new Error("github_user_fetch_failed");
  const userData = await userRes.json();

  let email = userData.email?.trim().toLowerCase() ?? "";

  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers,
    });
    if (emailsRes.ok) {
      const emails = await emailsRes.json();
      const primary = Array.isArray(emails)
        ? emails.find((e) => e.primary && e.verified)
        : null;
      if (primary) email = primary.email.trim().toLowerCase();
    }
  }

  if (!email) throw new Error("github_no_verified_email");

  return {
    id: String(userData.id),
    login: userData.login ?? "",
    email,
    fullName: userData.name ?? "",
    avatar: userData.avatar_url ?? "",
  };
}
