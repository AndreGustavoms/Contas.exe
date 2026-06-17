// Testes da camada de upload do YouTube (server/youtube.mjs). O foco é a
// confinação do caminho: o endpoint aceita apenas um NOME de arquivo dentro da
// pasta de staging, nunca um caminho absoluto/traversal (foi por isso que o
// upload chegou a ficar desativado). Apontamos YOUTUBE_UPLOAD_DIR para um dir
// temporário antes de importar o módulo, já que ele lê o env no carregamento.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const uploadsDir = await mkdtemp(join(tmpdir(), "yt-uploads-"));
const youtubeDataDir = await mkdtemp(join(tmpdir(), "yt-data-"));
process.env.YOUTUBE_UPLOAD_DIR = uploadsDir;
process.env.YOUTUBE_TOKENS_DB = join(youtubeDataDir, "youtube.json");
process.env.YOUTUBE_HISTORY_DB = join(youtubeDataDir, "youtube-history.json");

const {
  listConnectedChannels,
  listUploadHistory,
  listUploadableFiles,
  resolveUploadPath,
  uploadsDirectory,
} = await import("../server/youtube.mjs");

after(async () => {
  await rm(uploadsDir, { recursive: true, force: true });
  await rm(youtubeDataDir, { recursive: true, force: true });
});

describe("resolveUploadPath", () => {
  it("aceita um nome de arquivo simples e o confina na pasta", () => {
    const resolved = resolveUploadPath("video.mp4");
    assert.equal(resolved, resolve(uploadsDir, "video.mp4"));
  });

  it("confina arquivos na pasta do usuario quando ownerId e informado", () => {
    const resolved = resolveUploadPath("video.mp4", "user-one");
    assert.equal(resolved, resolve(uploadsDir, "user-one", "video.mp4"));
  });

  it("rejeita caminho absoluto, traversal e separadores", () => {
    const bad = [
      "/etc/passwd",
      "C:\\Windows\\System32\\config",
      "../secret.mp4",
      "..",
      ".",
      "sub/dir/video.mp4",
      "sub\\dir\\video.mp4",
      "",
      "   ",
    ];
    for (const name of bad) {
      assert.throws(
        () => resolveUploadPath(name),
        /invalid_file/,
        `deveria rejeitar: ${JSON.stringify(name)}`,
      );
    }
  });

  it("rejeita entradas não-string", () => {
    assert.throws(() => resolveUploadPath(null), /invalid_file/);
    assert.throws(() => resolveUploadPath(42), /invalid_file/);
    assert.throws(() => resolveUploadPath(undefined), /invalid_file/);
  });
});

describe("listUploadableFiles", () => {
  before(async () => {
    await writeFile(join(uploadsDir, "b.mp4"), "x");
    await writeFile(join(uploadsDir, "a.mp4"), "yy");
    await mkdir(join(uploadsDir, "user-one"), { recursive: true });
    await writeFile(join(uploadsDir, "user-one", "mine.mp4"), "mine");
  });

  it("lista os arquivos em ordem, com tamanho", async () => {
    const files = await listUploadableFiles();
    const names = files.map((f) => f.name);
    assert.deepEqual(names, ["a.mp4", "b.mp4"]);
    assert.equal(files.find((f) => f.name === "a.mp4").size, 2);
    assert.equal(files.find((f) => f.name === "b.mp4").size, 1);
  });

  it("lista somente os uploads staged do usuario informado", async () => {
    const files = await listUploadableFiles("user-one");
    assert.deepEqual(
      files.map((f) => f.name),
      ["mine.mp4"],
    );
  });
});

describe("uploadsDirectory", () => {
  it("retorna o caminho absoluto configurado", () => {
    assert.equal(uploadsDirectory(), resolve(uploadsDir));
  });

  it("retorna uma subpasta por usuario quando ownerId e informado", () => {
    assert.equal(uploadsDirectory("user-one"), resolve(uploadsDir, "user-one"));
  });
});

describe("YouTube owner isolation", () => {
  it("lista apenas canais conectados pelo usuario atual", async () => {
    await writeFile(
      process.env.YOUTUBE_TOKENS_DB,
      JSON.stringify({
        channels: [
          {
            ownerId: "user-one",
            id: "channel-a",
            title: "Canal A",
            refreshToken: "token-a",
            connectedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            ownerId: "user-two",
            id: "channel-b",
            title: "Canal B",
            refreshToken: "token-b",
            connectedAt: "2026-01-02T00:00:00.000Z",
          },
          {
            id: "legacy-global",
            title: "Canal legado sem dono",
            refreshToken: "legacy",
            connectedAt: "2026-01-03T00:00:00.000Z",
          },
        ],
      }),
    );

    assert.deepEqual(await listConnectedChannels("user-one"), [
      {
        id: "channel-a",
        title: "Canal A",
        connectedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    assert.deepEqual(await listConnectedChannels("user-two"), [
      {
        id: "channel-b",
        title: "Canal B",
        connectedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
  });

  it("lista apenas historico de uploads do usuario atual", async () => {
    await writeFile(
      process.env.YOUTUBE_HISTORY_DB,
      JSON.stringify({
        items: [
          { ownerId: "user-one", videoId: "video-a", title: "Video A" },
          { ownerId: "user-two", videoId: "video-b", title: "Video B" },
          { videoId: "legacy-global", title: "Video legado sem dono" },
        ],
      }),
    );

    assert.deepEqual(await listUploadHistory("user-one"), [
      { ownerId: "user-one", videoId: "video-a", title: "Video A" },
    ]);
    assert.deepEqual(await listUploadHistory("user-two"), [
      { ownerId: "user-two", videoId: "video-b", title: "Video B" },
    ]);
  });
});
