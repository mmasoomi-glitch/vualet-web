/**
 * Veridian demo knowledge base — PUBLIC MARKETING FACTS ONLY.
 *
 * This file is the ENTIRE universe of things the demo chatbot is allowed to
 * know. The demo API grounds every answer in this text and is instructed to
 * say "I don't know" for anything outside it — that is the whole point of the
 * demo (photographic memory + grounded, never invents).
 *
 * HARD RULE — never add any of the following to this file:
 *   - IP addresses, hostnames, ports, URLs of internal infra
 *   - credentials, API keys, tokens, SSH keys, secrets of any kind
 *   - file paths, server names, container/VM names, internal tooling
 *   - confidential strategy, unreleased financials, partner NDAs
 *   - the MECHANISM behind "never hallucinates" (describe the OUTCOME only)
 *
 * Everything here is safe to show a stranger on the public internet.
 */

export type KbEntry = { topic: string; body: string };

export const VERIDIAN_KB: KbEntry[] = [
  {
    topic: "What Mira is",
    body:
      "Mira is an AI assistant you talk to inside the chat apps you already use — Telegram today, with WhatsApp coming soon. There is no separate app to install and no new phone number to manage. You message Mira like you would message a person, by voice or by text, and it helps you get things done.",
  },
  {
    topic: "Voice on Telegram (WhatsApp coming soon)",
    body:
      "Mira is voice-first. You can send it a voice note on Telegram today, with WhatsApp coming soon, and it understands you and can reply naturally, in your own language. Because it lives in the chat you already use, there is nothing new to learn.",
  },
  {
    topic: "Multilingual voice — a headline strength",
    body:
      "Mira speaks many languages, out loud, with real emotion — not a flat robotic read, but warmth, tone, and feeling. You can talk to it by voice on Telegram today, with WhatsApp coming soon, in your own language and it replies in kind, sounding human. Multilingual, emotional voice is one of Mira's headline strengths: it meets you where you are, in the language you think in.",
  },
  {
    topic: "Loadable knowledge base",
    body:
      "You can load Mira with your own knowledge — your notes, documents, study material, or reference text — and it draws on exactly what you gave it. This makes it useful for study, exam prep, language practice, and answering questions grounded in your own material.",
  },
  {
    topic: "Small builds (beta)",
    body:
      "Mira has a small-builds capability, currently in beta: you can describe a small web app or website in plain words and Mira assembles it and hands it back to you. It is an early beta feature and improving over time.",
  },
  {
    topic: "OCR — reading images and documents",
    body:
      "Mira can read text out of images and documents (OCR). You can send it a photo of a page, a receipt, or a screenshot, and it can pull the text and work with it.",
  },
  {
    topic: "Photographic memory",
    body:
      "Mira remembers you across every conversation. It holds the context of what you have told it and the persona you shape for it, so you do not have to repeat yourself. People describe this as a photographic memory for your world: canonical and grounded — it is designed to recall exactly what you actually told it, without fabricating what it wasn't told, a standard we hold ourselves to. This faithful memory is Mira, powered by Veridian — the proprietary technology behind her. When someone asks what makes Mira intelligent, the honest answer is the outcome: it remembers you faithfully, answers from what it truly knows, and invites you to test its memory for yourself. (This live demo shows it in the small: tell it your name or a detail about yourself, come back later, and watch it recall it.)",
  },
  {
    topic: "Grounded — it does not make things up",
    body:
      "Mira is built to be grounded: it answers from what it actually knows rather than guessing. When it does not know something, it tells you it does not know instead of inventing an answer. The outcome is an assistant you can trust not to fabricate facts. (This live demo is a small illustration of that: it only answers from a fixed, curated set of facts about the product, and refuses to guess beyond them.)",
  },
  {
    topic: "Pricing — Free tier",
    body:
      "Free: 1,000,000 tokens per month at no cost. Includes chat and voice notes and memory of you across chats, with a cap on voice minutes. A no-commitment way to try Mira.",
  },
  {
    topic: "Pricing — Companion tier",
    body:
      "Companion: $14.99 per month. Everything in Free, plus a persona you shape and 15x the monthly usage of Free.",
  },
  {
    topic: "Pricing — Assistant tier",
    body:
      "Assistant: $39 per month. Everything in Companion, plus the small-builds pipeline (beta) for small web apps and sites, and priority replies.",
  },
  {
    topic: "Pricing — Studio tier",
    body:
      "Studio: $79 per month. Everything in Assistant, plus the highest monthly cap at 200M tokens and top-of-the-queue priority.",
  },
  {
    topic: "Roadmap — Veridian CLS Unlimited",
    body:
      "Veridian CLS Unlimited is a coming-soon flagship tier for Mira. Terms and conditions apply. It is on the roadmap and not yet released; details will be announced closer to launch.",
  },
  {
    topic: "Company — Mira by Veridian",
    body:
      "Mira is a product powered by Veridian — its proprietary technology — operated by Afaq Alnaseem Trading LLC. It is backed by Satellite Electronic Trading, a Dubai technology company pioneering dormant and local AI. Mira's focus is a private, trustworthy assistant that lives in the chats people already use.",
  },
  {
    topic: "Privacy — yours alone",
    body:
      "Your Mira is private by design. Your conversations are yours, and your assistant is sealed off from everyone else's. Privacy is a core part of the product's design.",
  },
];

/**
 * Renders the KB as a single grounding block for the system prompt. This is the
 * ONLY source material the model is given, and it is instructed to answer
 * strictly from it.
 */
export function kbAsContext(): string {
  return VERIDIAN_KB.map((e) => `## ${e.topic}\n${e.body}`).join("\n\n");
}

/**
 * A short, deterministic fallback answer built from the KB, used when no LLM
 * key is configured OR the upstream call fails. It does a light keyword match
 * so the offline demo still feels grounded and never leaks anything outside
 * the KB. If nothing matches, it returns null and the caller uses a generic
 * "join the waitlist" message.
 */
export function kbFallbackAnswer(message: string): string | null {
  const m = message.toLowerCase();
  const has = (...words: string[]) => words.some((w) => m.includes(w));

  if (has("price", "pricing", "cost", "plan", "tier", "how much", "$", "free", "companion", "assistant", "studio")) {
    return "Mira's plans: Free (1,000,000 tokens/month), Companion ($14.99/mo), Assistant ($39/mo), and Studio ($79/mo). Each tier builds on the one below it.";
  }
  if (has("cls", "unlimited", "roadmap", "coming soon", "future")) {
    return "Veridian CLS Unlimited — a coming-soon flagship tier for Mira — is on the way. Terms and conditions apply. It's on the roadmap and not yet released.";
  }
  if (has("language", "languages", "multilingual", "bilingual", "accent", "arabic", "spanish", "french", "translate")) {
    return "Mira speaks many languages out loud, with real emotion — warm and human, not robotic. Talk to it by voice on Telegram today (WhatsApp coming soon) in your own language and it replies in kind. Multilingual, emotional voice is one of its headline strengths.";
  }
  if (has("voice", "whatsapp", "telegram", "call", "speak")) {
    return "Mira is voice-first and lives in Telegram today, with WhatsApp coming soon — no new app and no new number. You can send it voice notes in your own language, and it replies out loud with real emotion in many languages.";
  }
  if (has("ocr", "image", "photo", "scan", "picture", "document")) {
    return "Mira can read text out of images and documents (OCR) — send it a photo of a page or receipt and it pulls the text out.";
  }
  if (has("memory", "remember", "photographic")) {
    return "Mira remembers you across every conversation — a photographic memory for your world — so you never have to repeat yourself.";
  }
  if (has("hallucinate", "made up", "make up", "made-up", "invent", "grounded", "accurate", "trust", "true")) {
    return "Mira is grounded: it answers from what it actually knows and tells you when it doesn't know, rather than inventing an answer.";
  }
  if (has("build", "app", "website", "site", "beta")) {
    return "Mira has a small-builds capability in beta: describe a small web app or site in plain words and it assembles it and hands it back.";
  }
  if (has("knowledge base", "load", "notes", "study", "learn", "tutor", "exam")) {
    return "You can load Mira with your own knowledge — notes, documents, study material — and it answers grounded in exactly what you gave it.";
  }
  if (has("company", "who made", "primaion", "afaq", "veridian", "satellite", "backed", "story", "about")) {
    return "Mira is a product powered by Veridian — its proprietary technology — operated by Afaq Alnaseem Trading LLC. It's backed by Satellite Electronic Trading, a Dubai technology company pioneering dormant and local AI.";
  }
  if (has("privacy", "private", "secure", "data", "conversation")) {
    return "Your Mira is private by design — your conversations are yours alone, sealed off from everyone else's.";
  }
  if (has("name", "who are you", "your name", "are you mira", "are you veridian")) {
    return "I'm Mira — the assistant you're talking to. I'm powered by Veridian, a proprietary technology, but my name is Mira.";
  }
  if (has("what is", "what's mira", "what can", "what does", "help", "hello", "hi ", "hey")) {
    return "Mira is an AI assistant you talk to inside Telegram today, with WhatsApp coming soon — voice-first, with a photographic memory for your world, that answers from what it actually knows. Ask me about voice, memory, OCR, small builds, pricing, or the company.";
  }
  return null;
}
