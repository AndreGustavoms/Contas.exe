// Detects first-time logins from a new IP and sends an e-mail alert.
// Known IPs per user are stored in storage/login-ips/<userId>.json.
// Only fires when the user has an e-mail and RESEND_API_KEY is set (or in dev
// mode, which logs to stdout). Silently no-ops on any I/O error so a storage
// hiccup never blocks the login response.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sendEmail } from "./email.mjs";

const MAX_KNOWN_IPS = 20; // rotate oldest entries after this

function ipsDir(storageDir) {
  return join(storageDir, "login-ips");
}

function ipsFile(storageDir, userId) {
  return join(ipsDir(storageDir), `${userId}.json`);
}

async function loadKnownIps(storageDir, userId) {
  try {
    const raw = await readFile(ipsFile(storageDir, userId), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveKnownIps(storageDir, userId, ips) {
  await mkdir(ipsDir(storageDir), { recursive: true });
  await writeFile(ipsFile(storageDir, userId), JSON.stringify(ips), "utf8");
}

function formatDate(date) {
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Call after every successful login.
 * @param {string} storageDir
 * @param {{ id: string, username: string, email?: string }} user
 * @param {string} ip
 * @param {string|undefined} userAgent
 */
export async function notifyIfNewIp(storageDir, user, ip, userAgent) {
  if (!ip || !user?.email) return;

  try {
    const known = await loadKnownIps(storageDir, user.id);
    const isNew = !known.includes(ip);

    // Always record the IP (move to front / add).
    const updated = [ip, ...known.filter((x) => x !== ip)].slice(
      0,
      MAX_KNOWN_IPS,
    );
    await saveKnownIps(storageDir, user.id, updated);

    if (!isNew) return; // familiar IP — no alert needed

    const now = formatDate(new Date());
    const ua = userAgent
      ? `<br><strong>Dispositivo:</strong> ${escHtml(userAgent.slice(0, 120))}`
      : "";

    await sendEmail({
      to: user.email,
      subject: "Novo acesso detectado — Contas",
      html: `
<p>Olá, <strong>${escHtml(user.username)}</strong>.</p>
<p>Detectamos um acesso à sua conta a partir de um <strong>endereço IP não reconhecido</strong>.</p>
<table style="border-collapse:collapse;margin:16px 0;font-size:14px">
  <tr><td style="padding:4px 12px 4px 0;color:#888">Data/hora</td><td>${now} (horário de Brasília)</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#888">IP de origem</td><td><code>${escHtml(ip)}</code></td></tr>${ua ? `\n  <tr><td style="padding:4px 12px 4px 0;color:#888">Navegador</td><td>${ua}</td></tr>` : ""}
</table>
<p>Se foi você, pode ignorar este e-mail.</p>
<p><strong>Se não foi você</strong>, troque sua senha imediatamente e ative a autenticação de dois fatores nas configurações da sua conta.</p>
<hr style="margin:24px 0;border:none;border-top:1px solid #eee">
<p style="font-size:12px;color:#aaa">Este é um e-mail automático do Contas. Não responda.</p>
      `.trim(),
    });
  } catch {
    // Never let a notification error block the login response.
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
