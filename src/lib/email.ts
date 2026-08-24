import nodemailer from "nodemailer";

/**
 * Transactional email over SMTP (Gmail app-password or any SMTP).
 * Env: MIRA_SMTP_HOST, MIRA_SMTP_PORT, MIRA_SMTP_USER, MIRA_SMTP_PASS, MIRA_SMTP_FROM.
 * Used for the login magic-link. Never logs credentials or full message bodies.
 */

export function emailConfigured(): boolean {
  return Boolean(process.env.MIRA_SMTP_HOST && process.env.MIRA_SMTP_USER && process.env.MIRA_SMTP_PASS);
}

let _transport: nodemailer.Transporter | null = null;
function transport(): nodemailer.Transporter {
  if (_transport) return _transport;
  const host = process.env.MIRA_SMTP_HOST!;
  const port = Number(process.env.MIRA_SMTP_PORT || 587);
  _transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: process.env.MIRA_SMTP_USER!, pass: process.env.MIRA_SMTP_PASS! },
  });
  return _transport;
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
  if (!emailConfigured()) throw new Error("SMTP not configured");
  const from = process.env.MIRA_SMTP_FROM || `Mira <${process.env.MIRA_SMTP_USER}>`;
  await transport().sendMail({ from, to, subject, text, html });
}

export function magicLinkEmail(link: string): { subject: string; html: string; text: string } {
  const subject = "Your Mira sign-in link";
  const text =
    `Sign in to Mira.\n\nClick the link below to sign in. It works once and expires in 15 minutes.\n\n${link}\n\n` +
    `If you didn't request this, you can ignore this email.\n\nMira — a Vualet product, from Satellite World (a sole proprietorship).`;
  const html = `<!doctype html><html><body style="margin:0;background:#faf5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#2b2430">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">
    <h1 style="font-size:22px;font-weight:600;margin:0 0 6px">Sign in to Mira</h1>
    <p style="font-size:15px;line-height:1.6;color:#5a5560;margin:0 0 24px">Click the button below to sign in. It works once and expires in 15 minutes.</p>
    <a href="${link}" style="display:inline-block;background:#c0446a;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 28px;border-radius:12px">Sign in to Mira &rarr;</a>
    <p style="font-size:13px;line-height:1.6;color:#8a8590;margin:28px 0 0">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all;color:#5a5560">${link}</span></p>
    <p style="font-size:12px;color:#a49fa9;margin:28px 0 0">If you didn't request this, you can safely ignore this email.<br>Mira — a Vualet product, from Satellite World (a sole proprietorship).</p>
  </div></body></html>`;
  return { subject, html, text };
}
