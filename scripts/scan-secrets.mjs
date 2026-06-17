// Scanner de segredos sem dependencias. Roda no pre-commit, no CI e no prebuild
// (ver package.json e .github/workflows/ci.yml). Varre os arquivos RASTREADOS
// pelo git (conteudo do working tree) atras de padroes de alta confianca de
// credenciais e de e-mails pessoais (PII) em codigo. Sai com codigo 1 se achar
// algo, travando o commit/build. NAO contem nenhum segredo real.

import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

// Padroes de ALTA confianca: chaves reais de provedores e chaves privadas. O
// objetivo e zero falso-positivo em codigo normal.
const RULES = [
  { name: "Google OAuth client secret", re: /GOCSPX-[A-Za-z0-9_-]{10,}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: "Google/refresh token", re: /\b1\/\/0[A-Za-z0-9_-]{20,}/ },
  { name: "Resend API key", re: /\bre_[A-Za-z0-9]{16,}/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
  { name: "Stripe secret key", re: /\bsk_(?:live|test)_[0-9A-Za-z]{16,}/ },
  {
    name: "JWT",
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    name: "Chave privada (PEM)",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
  // PII: e-mail de provedor pessoal dentro de codigo/fixtures. Em testes, use
  // dominios de exemplo (example.com/.test/.invalid). Evita reintroduzir o
  // e-mail do dono que ja foi limpo.
  {
    name: "E-mail pessoal (PII) em codigo",
    re: /[A-Za-z0-9._%+-]+@(?:gmail|googlemail|hotmail|outlook|live|yahoo|icloud|proton(?:mail)?|aol|gmx)\.[a-z.]{2,}/i,
    piiEmail: true,
  },
];

// Binarios e arquivos gerados nao sao varridos.
const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".svg",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".zip",
  ".gz",
  ".lock",
]);
// O proprio scanner contem os padroes acima; pular para nao auto-disparar.
// .env.example pode citar exemplos; docs/*.md podem citar e-mails de contato.
const SKIP_FILES = new Set([
  "scripts/scan-secrets.mjs",
  "package-lock.json",
  ".env.example",
]);
const skipPiiEmail = (file) => file.endsWith(".md") || file.startsWith("docs/");

function trackedFiles() {
  try {
    return execSync("git ls-files", { encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    // git not available (e.g. Railway build container) — skip scan
    return [];
  }
}

const findings = [];
for (const file of trackedFiles()) {
  if (SKIP_FILES.has(file)) continue;
  const dot = file.lastIndexOf(".");
  if (dot !== -1 && SKIP_EXT.has(file.slice(dot).toLowerCase())) continue;
  let buf;
  try {
    if (statSync(file).size > 2 * 1024 * 1024) continue;
    buf = readFileSync(file);
  } catch {
    continue;
  }
  if (buf.includes(0)) continue; // binario: contem byte NUL (0x00)
  const lines = buf.toString("utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.piiEmail && skipPiiEmail(file)) continue;
      if (rule.re.test(line)) {
        findings.push({
          file,
          line: i + 1,
          rule: rule.name,
          text: line.trim().slice(0, 120),
        });
      }
    }
  });
}

if (findings.length > 0) {
  console.error("FALHA scan-secrets: segredo/PII em arquivo rastreado:\n");
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]`);
    console.error(`    ${f.text}`);
  }
  console.error(
    `\n${findings.length} ocorrencia(s). Use process.env ou um dominio de ` +
      "exemplo (example.com/.test) e tente de novo.",
  );
  process.exit(1);
}
console.log(
  "OK scan-secrets: nenhum segredo conhecido nos arquivos rastreados.",
);
