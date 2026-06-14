export type Product = {
  slug: string;
  glyph: string;
  name: string;
  category: "Customer Conversations" | "Sales & CRM" | "HR & People" | "Automation";
  tagline: string;
  description: string;
  bullets: string[];
  startingPriceUsd: number;
  comingSoon?: boolean;
};

export const PRODUCTS: Product[] = [
  {
    slug: "mira",
    glyph: "M",
    name: "Mira — Personal Assistant",
    category: "Customer Conversations",
    tagline: "Your own assistant, in the chat you already use. No app.",
    description:
      "Mira lives in your Telegram or WhatsApp. She talks, remembers you, and quietly gets things done — from answering a question to building you a small app — delivered like a voice note from a friend. Scan a code, talk to yourself, and she's there.",
    bullets: [
      "No app to install — she messages you on Telegram or WhatsApp",
      "Voice-first and multilingual, on the fly",
      "Remembers you across every conversation",
      "Feed her a PDF, link, or notes and she becomes the expert",
    ],
    startingPriceUsd: 19,
  },
  {
    slug: "whatsapp-agents",
    glyph: "W",
    name: "WhatsApp AI Agents",
    category: "Customer Conversations",
    tagline: "24/7 sales and support on the world's most-used messaging app.",
    description:
      "Deploy AI agents on your WhatsApp Business number that qualify leads, answer questions, book meetings, and hand off to humans when the conversation gets real.",
    bullets: [
      "Plug into your existing WhatsApp Business number",
      "Trained on your products, pricing, and policies in minutes",
      "Human handoff with full transcript and customer context",
      "Multilingual — English, Arabic, French, and 30+ more",
    ],
    startingPriceUsd: 49,
  },
  {
    slug: "crm",
    glyph: "C",
    name: "CRM Automation",
    category: "Sales & CRM",
    tagline: "Pipelines, sequences, and follow-ups that work without you.",
    description:
      "A CRM that auto-enriches contacts, scores leads, and runs the follow-up sequences your team would write if they had the time.",
    bullets: [
      "Auto-enrichment from email signatures, LinkedIn, and the web",
      "Visual pipelines with drag-and-drop stages",
      "Sequence builder with conditional branches",
      "Built-in calling, email, and WhatsApp",
    ],
    startingPriceUsd: 29,
  },
  {
    slug: "hr",
    glyph: "H",
    name: "Employee Hub",
    category: "HR & People",
    tagline: "Onboarding, leave, payroll inputs, performance — one place.",
    description:
      "Your team's home base. From offer letters to leave requests to performance reviews — all the people ops in one calm interface.",
    bullets: [
      "UAE-compliant offer letters and contracts",
      "Leave calendar with auto-accrual",
      "Payroll-ready exports for WPS",
      "Performance reviews and 1:1 notes",
    ],
    startingPriceUsd: 6,
    comingSoon: true,
  },
  {
    slug: "inbox",
    glyph: "I",
    name: "Omnichannel Inbox",
    category: "Customer Conversations",
    tagline: "WhatsApp, email, Instagram and web chat — one queue.",
    description:
      "Stop juggling tabs. Every customer message routes to one inbox, with shared assignments, canned replies, and AI suggestions.",
    bullets: [
      "WhatsApp, email, IG DM, web chat, SMS",
      "Round-robin and load-balanced assignment",
      "AI reply suggestions trained on your past resolutions",
      "Tags, SLAs, and team analytics",
    ],
    startingPriceUsd: 19,
    comingSoon: true,
  },
  {
    slug: "quotes",
    glyph: "Q",
    name: "Quote-to-Cash",
    category: "Sales & CRM",
    tagline: "Quotes, invoices, and payment links — branded, signed, paid.",
    description:
      "From the first quote to the final payment — sent in seconds, signed with one tap, paid with a Stripe link.",
    bullets: [
      "Branded quote templates",
      "E-signature with audit trail",
      "VAT-aware invoicing for UAE",
      "Auto-reminders and payment links",
    ],
    startingPriceUsd: 19,
    comingSoon: true,
  },
  {
    slug: "performance",
    glyph: "P",
    name: "Performance",
    category: "HR & People",
    tagline: "Reviews, 1:1s, and goals that actually get done.",
    description:
      "A lightweight performance practice your team will actually use. Goals, weekly check-ins, and review cycles in one tool.",
    bullets: [
      "OKR and KPI templates",
      "Weekly 1:1 agendas",
      "360-degree review cycles",
      "Calibration tools for managers of managers",
    ],
    startingPriceUsd: 8,
    comingSoon: true,
  },
];
