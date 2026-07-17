import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Contact form capture. Mirrors the waitlist route's durable pattern: the
 * PRIMARY store is an append-only JSONL file on disk that survives restarts and
 * redeploys with zero external dependency. Set CONTACT_FILE to a path OUTSIDE
 * the deploy tree in production so swap-deploys never wipe messages. Default is
 * <cwd>/data/contact.jsonl for local dev.
 */
export const runtime = "nodejs"; // fs access needs the Node runtime, not edge

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LEN = 254;
const NAME_MAX_LEN = 120;
const MESSAGE_MAX_LEN = 4000;

const CONTACT_FILE =
  process.env.CONTACT_FILE || path.join(process.cwd(), "data", "contact.jsonl");

type Entry = { name: string; email: string; message: string; at: string };

async function appendContact(entry: Entry): Promise<void> {
  await fs.mkdir(path.dirname(CONTACT_FILE), { recursive: true });
  await fs.appendFile(CONTACT_FILE, JSON.stringify(entry) + "\n", "utf8");
}

// RELATIVE See-Other redirect. Behind an nginx proxy, req.url carries the
// internal origin, so an absolute redirect built from it would send the browser
// to localhost. A relative Location is resolved against the real request URL.
function seeOther(pathAndQuery: string) {
  return new NextResponse(null, { status: 303, headers: { Location: pathAndQuery } });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const name = String(form?.get("name") ?? "").trim().slice(0, NAME_MAX_LEN);
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  const message = String(form?.get("message") ?? "").trim().slice(0, MESSAGE_MAX_LEN);

  if (
    !name ||
    !email ||
    email.length > EMAIL_MAX_LEN ||
    !EMAIL_RE.test(email) ||
    !message
  ) {
    return seeOther("/contact?error=1");
  }

  const entry: Entry = { name, email, message, at: new Date().toISOString() };

  try {
    await appendContact(entry);
  } catch (err) {
    console.error("[contact] file persist failed:", err);
    return seeOther("/contact?error=2");
  }

  return seeOther("/contact?sent=1");
}

// Owner export: GET /api/contact?key=<CONTACT_EXPORT_KEY> → { count, entries }.
// Gated by a server-side secret (constant-time compare). Returns 404 when the
// key is unset, so the endpoint is invisible until you turn it on.
export async function GET(req: Request) {
  const key = process.env.CONTACT_EXPORT_KEY;
  if (!key) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const provided = new URL(req.url).searchParams.get("key") ?? "";
  const a = Buffer.from(key);
  const b = Buffer.from(provided);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let text = "";
  try {
    text = await fs.readFile(CONTACT_FILE, "utf8");
  } catch {
    /* no file yet → empty list */
  }
  const entries: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as Entry);
    } catch {
      /* skip malformed line */
    }
  }
  return NextResponse.json({ count: entries.length, entries });
}
