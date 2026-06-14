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
    id: "trial",
    name: "Trial",
    price: "Free",
    sub: "1 hour · 20 msgs/day",
    items: ["Everything, to taste", "Voice + chat", "No card to start"],
    cta: "Start free",
  },
  {
    id: "companion",
    name: "Companion",
    price: "$19",
    per: "/mo",
    sub: "chat & voice",
    items: ["Unlimited-ish chat", "Everyday helpers", "Your language"],
    cta: "Choose Companion",
  },
  {
    id: "assistant",
    name: "Assistant",
    price: "$59",
    per: "/mo",
    sub: "+ small builds",
    items: ["Everything in Companion", "Builds little apps", "Priority replies"],
    featured: true,
    cta: "Choose Assistant",
  },
  {
    id: "studio",
    name: "Studio",
    price: "$199",
    per: "/mo",
    sub: "+ full builds",
    items: ["Full app builds", "Your own number", "Top of the queue"],
    cta: "Choose Studio",
  },
];

export function tierById(id: string | null | undefined): Tier | undefined {
  return TIERS.find((t) => t.id === id);
}
