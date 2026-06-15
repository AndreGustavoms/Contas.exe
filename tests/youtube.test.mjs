// Testes da camada de upload do YouTube (server/youtube.mjs). O foco é a
// confinação do caminho: o endpoint aceita apenas um NOME de arquivo dentro da
// pasta de staging, nunca um caminho absoluto/traversal (foi por isso que o
// upload chegou a ficar desativado). Apontamos YOUTUBE_UPLOAD_DIR para um dir
// temporário antes de importar o módulo, já que ele lê o env no carregamento.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const uploadsDir = await mkdtemp(join(tmpdir(), "yt-uploads-"));
process.env.YOUTUBE_UPLOAD_DIR = uploadsDir;

const { resolveUploadPath, listUploadableFiles, uploadsDirectory } =
  await import("../server/youtube.mjs");

after(async () => {
  await rm(uploadsDir, { recursive: true, force: true });
});

describe("resolveUploadPath", () => {
  it("aceita um nome de arquivo simples e o confina na pasta", () => {
    const resolved = resolveUploadPath("video.mp4");
    assert.equal(resolved, resolve(uploadsDir, "video.mp4"));
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
  });

  it("lista os arquivos em ordem, com tamanho", async () => {
    const files = await listUploadableFiles();
    const names = files.map((f) => f.name);
    assert.deepEqual(names, ["a.mp4", "b.mp4"]);
    assert.equal(files.find((f) => f.name === "a.mp4").size, 2);
    assert.equal(files.find((f) => f.name === "b.mp4").size, 1);
  });
});

describe("uploadsDirectory", () => {
  it("retorna o caminho absoluto configurado", () => {
    assert.equal(uploadsDirectory(), resolve(uploadsDir));
  });
});
