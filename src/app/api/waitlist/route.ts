import { NextResponse } from "next/server";
import { kvSet } from "@/lib/store";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Operational waitlist capture. The PRIMARY, durable store is an append-only
// JSONL file on disk — it survives restarts/redeploys with zero external
// dependency (unlike the Upstash-or-in-memory kv, which loses data when Upstash
// isn't configured). kvSet is kept as a best-effort secondary mirror.
//
// The file lives OUTSIDE the deploy tree (set WAITLIST_FILE=/opt/mira-web-data/
// waitlist.jsonl in runtime.conf) so swap-deploys never wipe signups. Default is
// <cwd>/data/waitlist.jsonl for local dev.
export const runtime = "nodejs"; // fs access needs the Node runtime, not edge

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LEN = 254;
const SOURCE_MAX_LEN = 60;

const WAITLIST_FILE =
  process.env.WAITLIST_FILE || path.join(process.cwd(), "data", "waitlist.jsonl");

type Entry = { email: string; source: string; at: string };

async function appendWaitlist(entry: Entry): Promise<void> {
  await fs.mkdir(path.dirname(WAITLIST_FILE), { recursive: true });
  await fs.appendFile(WAITLIST_FILE, JSON.stringify(entry) + "\n", "utf8");
}

// RELATIVE See-Other redirect. Behind the nginx proxy, req.url carries the
// internal origin (http://localhost:3021), so building an absolute redirect from
// it sends the browser to localhost. A relative Location is resolved by the
// browser against the real request URL (mira.vualet.com) — correct every time.
function seeOther(pathAndQuery: string) {
  return new NextResponse(null, { status: 303, headers: { Location: pathAndQuery } });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const email = String(form?.get("email") ?? "").trim().toLowerCase();
  const source = String(form?.get("source") ?? form?.get("product") ?? "")
    .trim()
    .slice(0, SOURCE_MAX_LEN);

  if (!email || email.length > EMAIL_MAX_LEN || !EMAIL_RE.test(email)) {
    return seeOther("/signup?error=1");
  }

  const entry: Entry = { email, source, at: new Date().toISOString() };

  // Durable file is the source of truth. If it fails, fall through to the kv
  // mirror; only report an error to the user if BOTH persistence paths fail.
  let persisted = false;
  try {
    await appendWaitlist(entry);
    persisted = true;
  } catch (err) {
    console.error("[waitlist] file persist failed:", err);
  }
  try {
    await kvSet(`waitlist:${email}`, entry);
    persisted = true;
  } catch (err) {
    console.error("[waitlist] kv mirror failed:", err);
  }

  if (!persisted) {
    return seeOther("/signup?error=2");
  }
  return seeOther("/signup?joined=1");
}

// Owner export: GET /api/waitlist?key=<WAITLIST_EXPORT_KEY> → { count, entries }.
// Gated by a server-side secret (constant-time compare). Returns 404 when the
// key is unset so the endpoint is invisible until you turn it on.
export async function GET(req: Request) {
  const key = process.env.WAITLIST_EXPORT_KEY;
  if (!key) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const provided = new URL(req.url).searchParams.get("key") ?? "";
  const a = Buffer.from(key);
  const b = Buffer.from(provided);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let text = "";
  try {
    text = await fs.readFile(WAITLIST_FILE, "utf8");
  } catch {
    /* no file yet → empty list */
  }
  // Dedupe by email, latest entry wins.
  const byEmail = new Map<string, Entry>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Entry;
      if (e?.email) byEmail.set(e.email, e);
    } catch {
      /* skip malformed line */
    }
  }
  const entries = [...byEmail.values()];
  return NextResponse.json({ count: entries.length, entries });
}
