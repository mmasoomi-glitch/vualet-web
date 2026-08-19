import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { kvSet, kvGet, kvDel } from "@/lib/store";

/**
 * One-time email magic-link tokens (jury verdict A 2026-07-18).
 *
 * Token = `base64url(JSON{email,nonce,exp}) + "." + HMAC_SHA256`. The HMAC makes it
 * unforgeable; a matching nonce record in the durable store makes it SINGLE-USE
 * (consumed = deleted). Short TTL (15 min). We never trust the email in the token
 * until both the signature AND the live nonce record check out.
 */

const TTL_S = 15 * 60;

function secret(): string {
  const s = process.env.MIRA_SESSION_SECRET || process.env.MIRA_TOKEN_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("MIRA_SESSION_SECRET/MIRA_TOKEN_SECRET unset in production — refusing to mint forgeable magic links.");
  }
  return "mira-dev-session-secret-not-for-production";
}

type MagicData = { email: string; nonce: string; exp: number };
const key = (nonce: string) => `mira:magic:${nonce}`;

export async function mintMagicToken(email: string): Promise<string> {
  const nonce = randomBytes(18).toString("base64url");
  const data: MagicData = {
    email: email.toLowerCase(),
    nonce,
    exp: Math.floor(Date.now() / 1000) + TTL_S,
  };
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(payload).digest("base64url");
  // Single-use marker: presence = unused. TTL matches the token so it self-cleans.
  await kvSet(key(nonce), { email: data.email }, TTL_S);
  return `${payload}.${mac}`;
}

/** Verify + CONSUME a magic token. Returns the verified email once, or null. */
export async function consumeMagicToken(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  try {
    const got = Buffer.from(mac);
    const expect = Buffer.from(createHmac("sha256", secret()).update(payload).digest("base64url"));
    if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as MagicData;
    if (!data.email || !data.nonce || data.exp < Math.floor(Date.now() / 1000)) return null;
    const marker = await kvGet<{ email: string }>(key(data.nonce));
    if (!marker) return null; // already used, or expired out of the store
    await kvDel(key(data.nonce)); // single-use: burn it
    return data.email;
  } catch {
    return null;
  }
}
