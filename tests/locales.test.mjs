import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const localesDir = fileURLToPath(new URL("../src/locales/", import.meta.url));

// pt é o fallbackLng e o superconjunto de chaves (ver src/i18n.ts).
const FALLBACK = "pt";

function looksLatinText(value) {
  return (
    typeof value === "string" &&
    /[A-Za-z]{3}/.test(value) &&
    !/[一-鿿]/.test(value) &&
    !/^\{\{\w+\}\}$/.test(value)
  );
}

const files = readdirSync(localesDir).filter((name) => name.endsWith(".json"));
const locales = Object.fromEntries(
  files.map((name) => [
    name.replace(".json", ""),
    JSON.parse(readFileSync(localesDir + name, "utf8")),
  ]),
);

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? flatten(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

function placeholders(value) {
  return [...String(value).matchAll(/\{\{(\w+)\}\}/g)]
    .map((match) => match[1])
    .sort()
    .join(",");
}

const fallbackEntries = new Map(flatten(locales[FALLBACK]));
const otherLocales = Object.keys(locales).filter((code) => code !== FALLBACK);

test("todos os arquivos de locale são JSON válido e carregáveis", () => {
  assert.ok(files.includes(`${FALLBACK}.json`));
  for (const [code, data] of Object.entries(locales)) {
    assert.equal(typeof data, "object", `${code}.json deve ser um objeto`);
  }
});

test("src/i18n.ts registra todos os arquivos de locale", () => {
  const i18nSource = readFileSync(
    fileURLToPath(new URL("../src/i18n.ts", import.meta.url)),
    "utf8",
  );
  for (const code of Object.keys(locales)) {
    assert.match(
      i18nSource,
      new RegExp(`["'\`]\\./locales/${code}\\.json["'\`]`),
      `src/i18n.ts não importa ${code}.json`,
    );
    assert.match(
      i18nSource,
      new RegExp(`\\b${code}:\\s*\\{\\s*translation:\\s*${code}\\s*\\}`),
      `src/i18n.ts não registra o recurso ${code}`,
    );
  }
});

test("nenhum locale tem chave órfã fora do fallback pt", () => {
  for (const code of otherLocales) {
    const orphans = flatten(locales[code])
      .map(([key]) => key)
      .filter((key) => !fallbackEntries.has(key));
    assert.deepEqual(
      orphans,
      [],
      `${code}.json tem chaves que não existem em ${FALLBACK}.json`,
    );
  }
});

test("placeholders {{...}} batem com o fallback em toda chave traduzida", () => {
  for (const code of otherLocales) {
    for (const [key, value] of flatten(locales[code])) {
      if (!fallbackEntries.has(key)) continue;
      assert.equal(
        placeholders(value),
        placeholders(fallbackEntries.get(key)),
        `${code}.json:${key} tem placeholders diferentes de ${FALLBACK}.json`,
      );
    }
  }
});

test("zh.json está completo em relação ao fallback pt", () => {
  const zhEntries = new Map(flatten(locales.zh));
  const missing = [...fallbackEntries.keys()].filter(
    (key) => !zhEntries.has(key),
  );
  assert.deepEqual(missing, [], "zh.json não deve ter chaves ausentes");

  // Sinaliza só onde o pt tem texto traduzível de fato e o zh manteve latim —
  // nomes de marca (platforms.*) e exemplos de formato são latinos nos dois.
  const untranslated = [...zhEntries]
    .filter(([key, value]) => looksLatinText(value))
    .filter(([key]) => !looksLatinText(fallbackEntries.get(key)))
    .map(([key]) => key);
  assert.deepEqual(untranslated, [], "zh.json ainda tem valores em inglês");
});
