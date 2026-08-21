// Single source of truth for Mira plan tiers — mirrors the marketing page (src/app/mira/page.tsx)
// so pricing stays consistent across /mira, /mira/plans, /mira/account.

export type Tier = {
  id: string;
  name: string;
  price: string;
  per?: string;
  sub: string;
  items: string[];
  featured?: boolean;
  cta: string;
};

export const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "Free",
    sub: "1,000,000 tokens / month",
    items: ["Chat + voice notes", "Remembers you across chats", "In your own WhatsApp — no new app to install"],
    cta: "Start free",
  },
  {
    id: "companion",
    name: "Companion",
    price: "$14.99",
    per: "/mo",
    sub: "15M tokens / month",
    items: ["Everything in Free", "A persona you shape", "15× the monthly usage of Free"],
    cta: "Choose Companion",
  },
  {
    id: "assistant",
    name: "Assistant",
    price: "$39",
    per: "/mo",
    sub: "60M tokens / month",
    items: ["Everything in Companion", "60M tokens — 4× Companion", "Priority replies"],
    featured: true,
    cta: "Choose Assistant",
  },
  {
    id: "studio",
    name: "Studio",
    price: "$79",
    per: "/mo",
    sub: "200M tokens / month",
    items: ["Everything in Assistant", "200M tokens — the highest cap", "Top of the queue"],
    cta: "Choose Studio",
  },
];

export function tierById(id: string | null | undefined): Tier | undefined {
  return TIERS.find((t) => t.id === id);
}
