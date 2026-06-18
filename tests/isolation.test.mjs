import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const storageDir = await mkdtemp(join(tmpdir(), "contas-isolation-"));
const port = 31000 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
let server;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // server is still starting
    }
    await wait(100);
  }
  throw new Error("server_not_ready");
}

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie");
  assert.ok(raw, "login must set a session cookie");
  return raw.split(";")[0];
}

async function request(path, { cookie, method = "GET", body, headers } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body && !(body instanceof Uint8Array)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body:
      body instanceof Uint8Array
        ? body
        : body
          ? JSON.stringify(body)
          : undefined,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return { response, data };
}

async function register(username, password) {
  const { response } = await request("/api/auth/register", {
    method: "POST",
    body: {
      username,
      password,
      email: `${username}@example.test`,
      fullName: username,
    },
  });
  assert.equal(response.status, 201);
}

async function login(username, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: username, password }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.ok(data.user?.id, "login must return the stable user id");
  return { cookie: cookieFrom(response), user: data.user };
}

async function makeAdmin(userId) {
  const usersFile = join(storageDir, "users.json");
  const parsed = JSON.parse(await readFile(usersFile, "utf8"));
  const target = parsed.users.find((user) => user.id === userId);
  assert.ok(target, "target user must exist");
  target.role = "admin";
  await writeFile(usersFile, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

before(async () => {
  await mkdir(storageDir, { recursive: true });
  server = spawn(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      CONTAS_FLOW_STORAGE_DIR: storageDir,
      CONTAS_FLOW_COOKIE_SECURE: "0",
      CONTAS_FLOW_REGISTRATIONS_OPEN: "true",
      APP_AUTH_USER: "",
      APP_AUTH_PASSWORD: "",
      CONTAS_FLOW_FIXED_SUPERADMIN: "0",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await waitForServer();
});

after(async () => {
  if (server) server.kill();
  await rm(storageDir, { recursive: true, force: true });
});

describe("user isolation", () => {
  it("keeps vaults, uploads, YouTube state and sessions scoped to the session user", async () => {
    const gustavoPassword = "Gustavo@123";
    const joaoPassword = "Joao@12345";

    await register("gustavo", gustavoPassword);
    await register("joao", joaoPassword);

    const gustavo = await login("gustavo", gustavoPassword);
    const joao = await login("joao", joaoPassword);

    const gustavoSettingsUpdate = await request("/api/account/profile", {
      cookie: gustavo.cookie,
      method: "PUT",
      body: { fullName: "Gustavo Private Settings" },
    });
    assert.equal(gustavoSettingsUpdate.response.status, 200);
    const gustavoEmailUpdate = await request("/api/account/email", {
      cookie: gustavo.cookie,
      method: "PUT",
      body: { email: "gustavo.private@example.test" },
    });
    assert.equal(gustavoEmailUpdate.response.status, 200);

    const joaoSettings = await request("/api/account/me", {
      cookie: joao.cookie,
    });
    assert.equal(joaoSettings.response.status, 200);
    assert.equal(joaoSettings.data.id, joao.user.id);
    assert.equal(joaoSettings.data.fullName, "joao");
    assert.equal(joaoSettings.data.email, "joao@example.test");

    const gustavoGroups = await request("/api/groups", {
      cookie: gustavo.cookie,
    });
    assert.equal(gustavoGroups.response.status, 200);
    const gustavoGroupId = gustavoGroups.data.groups[0].id;

    const createdAccount = await request(
      `/api/groups/${encodeURIComponent(gustavoGroupId)}/accounts`,
      {
        cookie: gustavo.cookie,
        method: "POST",
        body: {
          platform: "Netflix",
          role: "Pessoal",
          owner: "Gustavo",
          label: "Netflix Gustavo",
          email: "gustavo.netflix@example.test",
          username: "gustavo-netflix",
          password: "Secret@123",
          recoveryEmail: "",
          phone: "",
          status: "active",
          twoFactor: false,
          postDay: "",
          niche: "",
          notes: "private note",
        },
      },
    );
    assert.equal(createdAccount.response.status, 201);
    const accountId = createdAccount.data.id;

    const commonAccountBody = {
      ...createdAccount.data,
      password: "",
    };

    const ordinaryEdit = await request(
      `/api/groups/${encodeURIComponent(gustavoGroupId)}/accounts/${encodeURIComponent(accountId)}`,
      {
        cookie: gustavo.cookie,
        method: "PUT",
        body: {
          ...commonAccountBody,
          label: "Netflix Gustavo atualizado",
        },
      },
    );
    assert.equal(ordinaryEdit.response.status, 200);
    assert.equal(ordinaryEdit.data.label, "Netflix Gustavo atualizado");

    const usernameEditWithoutReauth = await request(
      `/api/groups/${encodeURIComponent(gustavoGroupId)}/accounts/${encodeURIComponent(accountId)}`,
      {
        cookie: gustavo.cookie,
        method: "PUT",
        body: {
          ...ordinaryEdit.data,
          password: "",
          username: "gustavo-netflix-2",
        },
      },
    );
    assert.equal(usernameEditWithoutReauth.response.status, 403);
    assert.equal(usernameEditWithoutReauth.data.error, "reauth_required");

    const passwordEditWithoutReauth = await request(
      `/api/groups/${encodeURIComponent(gustavoGroupId)}/accounts/${encodeURIComponent(accountId)}`,
      {
        cookie: gustavo.cookie,
        method: "PUT",
        body: {
          ...ordinaryEdit.data,
          password: "Secret@456",
        },
      },
    );
    assert.equal(passwordEditWithoutReauth.response.status, 403);
    assert.equal(passwordEditWithoutReauth.data.error, "reauth_required");

    // DELETE de conta do cofre não exige reauth (item do gerenciador, não a conta do usuário)
    const deleteWithoutReauth = await request(
      `/api/groups/${encodeURIComponent(gustavoGroupId)}/accounts/${encodeURIComponent(accountId)}`,
      {
        cookie: gustavo.cookie,
        method: "DELETE",
      },
    );
    assert.equal(deleteWithoutReauth.response.status, 200);

    // Adiciona a conta novamente para continuar testando edição com reauth
    const readdAccount = await request(
      `/api/groups/${encodeURIComponent(gustavoGroupId)}/accounts`,
      {
        cookie: gustavo.cookie,
        method: "POST",
        body: { platform: "Netflix", username: "gustavo-netflix", password: "pass123" },
      },
    );
    assert.equal(readdAccount.response.status, 201);
    const newAccountId = readdAccount.data.id;

    const reauth = await request("/api/auth/reauth", {
      cookie: gustavo.cookie,
      method: "POST",
      body: { password: gustavoPassword },
    });
    assert.equal(reauth.response.status, 200);

    const usernameEditAfterReauth = await request(
      `/api/groups/${encodeURIComponent(gustavoGroupId)}/accounts/${encodeURIComponent(newAccountId)}`,
      {
        cookie: gustavo.cookie,
        method: "PUT",
        body: {
          platform: "Netflix",
          password: "",
          username: "gustavo-netflix-2",
        },
      },
    );
    assert.equal(usernameEditAfterReauth.response.status, 200);
    assert.equal(usernameEditAfterReauth.data.username, "gustavo-netflix-2");

    await makeAdmin(joao.user.id);

    const joaoGroups = await request("/api/groups", { cookie: joao.cookie });
    assert.equal(joaoGroups.response.status, 200);
    assert.deepEqual(
      joaoGroups.data.groups.map((group) => group.ownerId),
      [joao.user.id],
    );
    assert.equal(
      joaoGroups.data.groups.some((group) => group.id === gustavoGroupId),
      false,
    );

    const joaoReadsGustavoAccounts = await request(
      `/api/groups/${encodeURIComponent(gustavoGroupId)}/accounts`,
      { cookie: joao.cookie },
    );
    assert.equal(joaoReadsGustavoAccounts.response.status, 404);

    const joaoUsesAdminUsersRoute = await request("/api/users", {
      cookie: joao.cookie,
    });
    assert.equal(joaoUsesAdminUsersRoute.response.status, 403);

    const staged = await request("/api/youtube/uploads", {
      cookie: gustavo.cookie,
      method: "POST",
      headers: { "X-Upload-Filename": "video.mp4" },
      body: new Uint8Array([1, 2, 3]),
    });
    assert.equal(staged.response.status, 200);

    const joaoUploads = await request("/api/youtube/uploads", {
      cookie: joao.cookie,
    });
    assert.equal(joaoUploads.response.status, 200);
    assert.deepEqual(joaoUploads.data.files, []);

    const joaoPublishesGustavoFile = await request("/api/youtube/upload", {
      cookie: joao.cookie,
      method: "POST",
      body: {
        channelId: "gustavo-channel",
        file: staged.data.name,
        title: "stolen upload attempt",
      },
    });
    assert.equal(joaoPublishesGustavoFile.response.status, 404);
    assert.equal(joaoPublishesGustavoFile.data.error, "file_not_found");

    await writeFile(
      join(storageDir, "youtube.json"),
      `${JSON.stringify(
        {
          channels: [
            {
              ownerId: gustavo.user.id,
              id: "gustavo-channel",
              title: "Gustavo Channel",
              refreshToken: "token",
              connectedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      join(storageDir, "youtube-history.json"),
      `${JSON.stringify(
        {
          items: [
            {
              ownerId: gustavo.user.id,
              channelId: "gustavo-channel",
              videoId: "video-1",
              title: "Gustavo private video",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const gustavoChannels = await request("/api/youtube/channels", {
      cookie: gustavo.cookie,
    });
    assert.equal(gustavoChannels.response.status, 200);
    assert.equal(gustavoChannels.data.channels.length, 1);

    const joaoChannels = await request("/api/youtube/channels", {
      cookie: joao.cookie,
    });
    assert.equal(joaoChannels.response.status, 200);
    assert.deepEqual(joaoChannels.data.channels, []);

    const joaoHistory = await request("/api/youtube/history", {
      cookie: joao.cookie,
    });
    assert.equal(joaoHistory.response.status, 200);
    assert.deepEqual(joaoHistory.data.items, []);

    const joaoOwnStaged = await request("/api/youtube/uploads", {
      cookie: joao.cookie,
      method: "POST",
      headers: { "X-Upload-Filename": "joao.mp4" },
      body: new Uint8Array([4, 5, 6]),
    });
    assert.equal(joaoOwnStaged.response.status, 200);

    const joaoUsesGustavoToken = await request("/api/youtube/upload", {
      cookie: joao.cookie,
      method: "POST",
      body: {
        channelId: "gustavo-channel",
        file: joaoOwnStaged.data.name,
        title: "token theft attempt",
      },
    });
    assert.equal(joaoUsesGustavoToken.response.status, 404);
    assert.equal(joaoUsesGustavoToken.data.error, "channel_not_connected");

    const gustavoSessions = await request("/api/account/sessions", {
      cookie: gustavo.cookie,
    });
    assert.equal(gustavoSessions.response.status, 200);
    const gustavoSessionId = gustavoSessions.data.sessions[0].sessionId;

    const joaoRevokesGustavoSession = await request(
      `/api/account/sessions/${encodeURIComponent(gustavoSessionId)}`,
      { cookie: joao.cookie, method: "DELETE" },
    );
    assert.equal(joaoRevokesGustavoSession.response.status, 404);
  });
});
