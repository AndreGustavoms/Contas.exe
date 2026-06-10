// Thin wrapper around the Resend REST API — no SDK dependency needed.
// Set RESEND_API_KEY in the environment to enable e-mail delivery.
// Without the key, sendEmail() logs to stdout and returns true (dev mode).

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_ADDRESS =
  process.env.RESEND_FROM ?? "Contas_exe <onboarding@resend.dev>";

export async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) {
    console.log(`[email dev] to=${to} subject="${subject}"`);
    return true;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[email] resend error ${res.status}: ${text}`);
    return false;
  }
  return true;
}
