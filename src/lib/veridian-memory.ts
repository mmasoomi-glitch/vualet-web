/**
 * Veridian demo — durable per-visitor canonical memory.
 *
 * This is the "wow" behind the demo: a returning visitor is recognised via a
 * cookie and the assistant recalls specifics they told her before. The store is
 * a plain per-visitor JSON file on disk — same durable pattern as the waitlist
 * route (append/read files, `runtime="nodejs"`, path configured OUTSIDE the
 * deploy tree so swap-deploys never wipe it).
 *
 * HARD RULES honoured here:
 *  - This is PUBLIC demo memory: it only ever stores what a visitor voluntarily
 *    typed into a public marketing chatbot. No secrets, no PII beyond a
 *    self-declared first name and self-declared facts.
 *  - Every function is defensive: it NEVER throws into the request path. On any
 *    fs/JSON error it degrades to "no memory" so the chat still answers.
 *  - The visitor id comes from a user-controllable cookie, so it is strictly
 *    sanitised to a safe filename token before it ever touches the filesystem
 *    (no path traversal).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type VisitorTurn = { q: string; a: string; at: string };
export type VisitorMemory = {
  id: string;
  name?: string;
  facts: string[];
  turns: VisitorTurn[];
};

// Keep the stored footprint small: last N turns, a handful of durable facts.
const MAX_TURNS = 16;
const MAX_FACTS = 12;
const FACT_MAX_LEN = 180;
const NAME_MAX_LEN = 40;

// Configurable, outside the deploy tree in production
// (set VERIDIAN_MEM_DIR=/opt/mira-web-data/veridian-mem in runtime.conf).
// Default is <cwd>/data/veridian-mem for local dev.
const MEM_DIR =
  process.env.VERIDIAN_MEM_DIR || path.join(process.cwd(), "data", "veridian-mem");

/** Random, url/cookie-safe visitor id (32 hex chars). */
export function mintVisitorId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Sanitise a cookie-supplied id to a safe filename token. Only lowercase
 * hex-ish/alnum, dash, underscore survive; capped in length. Returns null if
 * nothing usable remains — the caller then mints a fresh id.
 */
export function safeId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 64);
  return cleaned.length >= 8 ? cleaned : null;
}

function fileFor(id: string): string {
  return path.join(MEM_DIR, `${id}.json`);
}

function emptyMemory(id: string): VisitorMemory {
  return { id, facts: [], turns: [] };
}

/** Read a visitor's memory. Never throws — returns an empty record on any error. */
export async function getMemory(id: string): Promise<VisitorMemory> {
  const safe = safeId(id);
  if (!safe) return emptyMemory(typeof id === "string" ? id : "unknown");
  try {
    const text = await fs.readFile(fileFor(safe), "utf8");
    const parsed = JSON.parse(text) as Partial<VisitorMemory>;
    return {
      id: safe,
      name: typeof parsed.name === "string" ? parsed.name.slice(0, NAME_MAX_LEN) : undefined,
      facts: Array.isArray(parsed.facts)
        ? parsed.facts.filter((f) => typeof f === "string").slice(-MAX_FACTS)
        : [],
      turns: Array.isArray(parsed.turns)
        ? parsed.turns
            .filter((t) => t && typeof t.q === "string" && typeof t.a === "string")
            .slice(-MAX_TURNS)
            .map((t) => ({ q: String(t.q), a: String(t.a), at: String(t.at ?? "") }))
        : [],
    };
  } catch {
    // No file yet, or unreadable/corrupt → treat as a brand-new visitor.
    return emptyMemory(safe);
  }
}

/** Persist a memory record atomically-ish. Never throws. */
async function save(mem: VisitorMemory): Promise<void> {
  const safe = safeId(mem.id);
  if (!safe) return;
  try {
    await fs.mkdir(MEM_DIR, { recursive: true });
    const clean: VisitorMemory = {
      id: safe,
      name: mem.name ? mem.name.slice(0, NAME_MAX_LEN) : undefined,
      facts: mem.facts.slice(-MAX_FACTS),
      turns: mem.turns.slice(-MAX_TURNS),
    };
    // Write to a temp file then rename, so a concurrent reader never sees a
    // half-written file. Best-effort: rename failures fall back to nothing.
    const tmp = fileFor(safe) + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(clean), "utf8");
    await fs.rename(tmp, fileFor(safe)).catch(async () => {
      // Rename can fail across some filesystems if the target exists; overwrite.
      await fs.writeFile(fileFor(safe), JSON.stringify(clean), "utf8").catch(() => {});
      await fs.unlink(tmp).catch(() => {});
    });
  } catch {
    /* durable memory is a nice-to-have; never break the request */
  }
}

/** Append a Q/A turn to a visitor's memory (capped to the last MAX_TURNS). */
export async function appendTurn(id: string, q: string, a: string): Promise<void> {
  const safe = safeId(id);
  if (!safe) return;
  const mem = await getMemory(safe);
  mem.turns.push({ q: q.slice(0, 400), a: a.slice(0, 600), at: new Date().toISOString() });
  mem.turns = mem.turns.slice(-MAX_TURNS);
  await save(mem);
}

/** Record a durable, self-declared fact (deduped, capped). */
export async function rememberFact(id: string, fact: string): Promise<void> {
  const safe = safeId(id);
  if (!safe) return;
  const clean = fact.trim().slice(0, FACT_MAX_LEN);
  if (!clean) return;
  const mem = await getMemory(safe);
  const exists = mem.facts.some((f) => f.toLowerCase() === clean.toLowerCase());
  if (exists) return;
  mem.facts.push(clean);
  mem.facts = mem.facts.slice(-MAX_FACTS);
  await save(mem);
}

/** Set the visitor's self-declared first name. */
export async function setName(id: string, name: string): Promise<void> {
  const safe = safeId(id);
  if (!safe) return;
  const clean = name.trim().slice(0, NAME_MAX_LEN);
  if (!clean) return;
  const mem = await getMemory(safe);
  if (mem.name && mem.name.toLowerCase() === clean.toLowerCase()) return;
  mem.name = clean;
  await save(mem);
}

/**
 * Cheap, no-LLM extraction of a self-declared name and durable facts from a
 * visitor message. Heuristic regex only — deliberately conservative so it never
 * invents a "memory" the visitor did not actually state.
 */
export function extractName(message: string): string | null {
  const STOP = new Set([
    "interested", "looking", "trying", "not", "sure", "here", "just", "wondering",
    "curious", "good", "fine", "okay", "ok", "back", "new", "asking", "testing",
    "confused", "sorry", "happy", "glad", "ready", "using", "from", "a", "an", "the",
    "also", "still", "really", "always", "now", "currently", "so", "very", "quite",
    "learning", "working", "studying", "building", "going", "planning", "thinking",
    "based", "living", "located", "actually", "definitely", "probably",
  ]);
  const clean = (raw: string): string | null => {
    if (STOP.has(raw.toLowerCase())) return null;
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  };

  // STRONG signal — an explicit self-naming. Accept regardless of typed case.
  const strong = message.match(
    /\b(?:my name is|my name's|name is|call me|you can call me|i'm called|i am called|this is)\s+([A-Za-z][A-Za-z'’-]{1,30})\b/i,
  );
  if (strong) {
    const r = clean(strong[1]);
    if (r) return r;
  }

  // WEAK signal — "I'm X" / "I am X". Only trust it when the token is Capitalized
  // as typed (a real name usually is), so fillers like "also"/"learning" (typed
  // lowercase) can never be mistaken for a name. Case-SENSITIVE on purpose.
  const weak = message.match(/\b(?:I am|I'm|Im)\s+([A-Z][A-Za-z'’-]{1,30})\b/);
  if (weak) {
    const r = clean(weak[1]);
    if (r) return r;
  }
  return null;
}

/**
 * Extract a durable self-fact the visitor stated about themselves. Conservative:
 * only fires on clear first-person self-description patterns and stores the
 * visitor's own words (trimmed), never an inference.
 */
export function extractFact(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length < 6 || trimmed.length > FACT_MAX_LEN) return null;
  // First-person self-description leads. We store the whole short statement so
  // she can recall it verbatim ("last time you mentioned you're a doctor in Dubai").
  const patterns = [
    /\bi (?:work|study|live|am building|am learning|am studying|teach|run|own|use|prefer|need|want|love|like|hate)\b/i,
    /\bi'?m (?:a|an|the|from|based|working|studying|learning|building)\b/i,
    /\bmy (?:company|business|job|team|project|startup|shop|kids?|son|daughter|wife|husband|dog|cat|goal|budget|plan)\b/i,
    /\bwe (?:sell|run|make|build|use|need|are)\b/i,
  ];
  if (patterns.some((re) => re.test(trimmed))) {
    // Keep it to a single sentence for tidy recall.
    const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0].slice(0, FACT_MAX_LEN);
    return firstSentence;
  }
  return null;
}

/**
 * Render what we already know about a visitor as a system-prompt block. If we
 * know nothing, returns an explicit "no prior memory" note so the model is told
 * plainly NOT to pretend to remember — protecting the zero-hallucination promise.
 */
export function memoryAsContext(mem: VisitorMemory): string {
  const knowsSomething = Boolean(mem.name) || mem.facts.length > 0 || mem.turns.length > 0;
  if (!knowsSomething) {
    return [
      "WHAT YOU ALREADY KNOW ABOUT THIS VISITOR:",
      "  (nothing yet — this is the first time you are meeting them, or they cleared their cookie.)",
      "  Because you have NO prior memory of them, do NOT pretend to remember them or greet them",
      "  as a returning visitor. Just be warm and helpful. If they tell you something about",
      "  themselves, you will remember it for next time.",
    ].join("\n");
  }
  const lines: string[] = ["WHAT YOU ALREADY KNOW ABOUT THIS VISITOR:"];
  if (mem.name) lines.push(`  - Their name is ${mem.name}.`);
  if (mem.facts.length) {
    lines.push("  - Things they told you about themselves (their own words):");
    for (const f of mem.facts) lines.push(`      • ${f}`);
  }
  if (mem.turns.length) {
    lines.push("  - A compressed view of your earlier exchanges (oldest first):");
    for (const t of mem.turns.slice(-8)) {
      lines.push(`      • They asked: "${t.q.slice(0, 140)}" — you answered: "${t.a.slice(0, 140)}"`);
    }
  }
  lines.push(
    "",
    "  This memory is REAL and canonical — it is what they actually told you on a previous",
    "  visit or earlier in this conversation. When it is genuinely relevant, surface it",
    "  naturally and warmly (e.g. \"Welcome back — last time you were asking about …\", or",
    "  \"Since you mentioned you're …\"). NEVER invent a memory that is not listed above; if",
    "  something is not here, you do not remember it, and you say so honestly.",
  );
  return lines.join("\n");
}
