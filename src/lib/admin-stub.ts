// ============================================================================
// ADMIN STUB DATA — Mira / Vualet internal ops dashboard
// ============================================================================
// This module is a SCAFFOLD. Every export here is hard-coded fake data so the
// admin UI can be built and reviewed without a live backend.
//
// >>> REAL API/DB HOOKS GO HERE <<<
// Replace each `get*` function below with a real data fetch:
//   - Customers / subscriptions: Postgres (or your billing DB) + Stripe API
//   - MRR / revenue / cost: Stripe + provider usage meters
//   - Provider health: live healthchecks / status pages for each provider
// Keep the *return shapes* the same and the UI will not need to change.
// ============================================================================

export type Plan = "Free" | "Starter" | "Pro" | "Business" | "Vualet One";
export type Channel = "Telegram" | "WhatsApp" | "Web";
export type CustomerStatus = "active" | "trialing" | "past_due" | "suspended" | "canceled";

export type Customer = {
  id: string;
  name: string;
  email: string;
  plan: Plan;
  channel: Channel;
  status: CustomerStatus;
  creditsUsed: number;
  creditsIncluded: number;
  mrrUsd: number;
  joined: string; // ISO date
  country: string;
};

export type UsageEvent = {
  date: string; // ISO date
  kind: "voice" | "chat" | "app_build" | "doc_ingest";
  credits: number;
  detail: string;
};

export type RefundRequest = {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amountUsd: number;
  reason: string;
  requested: string; // ISO date
  status: "pending" | "approved" | "denied";
};

export type Subscription = {
  id: string;
  customerName: string;
  plan: Plan;
  amountUsd: number;
  interval: "monthly" | "yearly";
  status: CustomerStatus;
  nextInvoice: string; // ISO date
};

export type ProviderHealth = {
  name: string;
  category: "AI" | "Voice" | "Compute" | "Channel" | "Payments";
  status: "operational" | "degraded" | "down";
  latencyMs: number;
  uptime30d: number; // percent
  note: string;
  lastChecked: string; // ISO timestamp
};

export type Kpis = {
  totalCustomers: number;
  activeSubscriptions: number;
  mrrUsd: number;
  trials: number;
  todaySpendUsd: number;
  todayRevenueUsd: number;
};

// ---------------------------------------------------------------------------
// CUSTOMERS
// ---------------------------------------------------------------------------

export const CUSTOMERS: Customer[] = [
  { id: "cus_001", name: "Layla Haddad", email: "layla@nooragency.ae", plan: "Pro", channel: "WhatsApp", status: "active", creditsUsed: 4210, creditsIncluded: 6000, mrrUsd: 49, joined: "2025-11-03", country: "AE" },
  { id: "cus_002", name: "Marcus Bauer", email: "m.bauer@bauer-gmbh.de", plan: "Business", channel: "Telegram", status: "active", creditsUsed: 18800, creditsIncluded: 25000, mrrUsd: 149, joined: "2025-09-17", country: "DE" },
  { id: "cus_003", name: "Priya Nair", email: "priya@kochi-foods.in", plan: "Starter", channel: "WhatsApp", status: "trialing", creditsUsed: 320, creditsIncluded: 1000, mrrUsd: 0, joined: "2026-06-08", country: "IN" },
  { id: "cus_004", name: "Omar Khalil", email: "omar@khalil-realty.ae", plan: "Vualet One", channel: "Telegram", status: "active", creditsUsed: 41200, creditsIncluded: 60000, mrrUsd: 299, joined: "2025-07-22", country: "AE" },
  { id: "cus_005", name: "Sofia Rossi", email: "sofia@milanoboutique.it", plan: "Pro", channel: "Web", status: "past_due", creditsUsed: 5980, creditsIncluded: 6000, mrrUsd: 49, joined: "2025-12-01", country: "IT" },
  { id: "cus_006", name: "James Okoro", email: "james@lagostech.ng", plan: "Starter", channel: "Telegram", status: "active", creditsUsed: 740, creditsIncluded: 1000, mrrUsd: 19, joined: "2026-02-14", country: "NG" },
  { id: "cus_007", name: "Aisha Rahman", email: "aisha@rahman-clinic.ae", plan: "Pro", channel: "WhatsApp", status: "suspended", creditsUsed: 6000, creditsIncluded: 6000, mrrUsd: 49, joined: "2025-10-09", country: "AE" },
  { id: "cus_008", name: "Daniel Schmidt", email: "daniel@schmidt-law.de", plan: "Business", channel: "Web", status: "active", creditsUsed: 12030, creditsIncluded: 25000, mrrUsd: 149, joined: "2025-08-30", country: "DE" },
  { id: "cus_009", name: "Fatima Zahra", email: "fatima@zahra-tutoring.ma", plan: "Free", channel: "Telegram", status: "active", creditsUsed: 180, creditsIncluded: 250, mrrUsd: 0, joined: "2026-05-19", country: "MA" },
  { id: "cus_010", name: "Chen Wei", email: "chen.wei@weicommerce.sg", plan: "Pro", channel: "WhatsApp", status: "trialing", creditsUsed: 1100, creditsIncluded: 6000, mrrUsd: 0, joined: "2026-06-11", country: "SG" },
  { id: "cus_011", name: "Elena Petrova", email: "elena@petrova-design.bg", plan: "Starter", channel: "Web", status: "canceled", creditsUsed: 0, creditsIncluded: 1000, mrrUsd: 0, joined: "2025-11-28", country: "BG" },
  { id: "cus_012", name: "Yusuf Demir", email: "yusuf@demir-export.tr", plan: "Business", channel: "Telegram", status: "active", creditsUsed: 21400, creditsIncluded: 25000, mrrUsd: 149, joined: "2025-06-15", country: "TR" },
  { id: "cus_013", name: "Grace Mwangi", email: "grace@nairobifresh.ke", plan: "Starter", channel: "WhatsApp", status: "active", creditsUsed: 610, creditsIncluded: 1000, mrrUsd: 19, joined: "2026-03-02", country: "KE" },
  { id: "cus_014", name: "Lucas Almeida", email: "lucas@almeida-imoveis.br", plan: "Pro", channel: "Web", status: "past_due", creditsUsed: 5500, creditsIncluded: 6000, mrrUsd: 49, joined: "2025-12-20", country: "BR" },
  { id: "cus_015", name: "Hana Suzuki", email: "hana@suzuki-wellness.jp", plan: "Vualet One", channel: "Telegram", status: "active", creditsUsed: 33800, creditsIncluded: 60000, mrrUsd: 299, joined: "2025-09-05", country: "JP" },
];

// REAL HOOK: SELECT * FROM customers ... (paginate / filter server-side)
export function getCustomers(): Customer[] {
  return CUSTOMERS;
}

export function getCustomer(id: string): Customer | undefined {
  return CUSTOMERS.find((c) => c.id === id);
}

// REAL HOOK: usage ledger for a single customer
export function getUsageHistory(customerId: string): UsageEvent[] {
  void customerId; // same stub for every customer in the scaffold
  return [
    { date: "2026-06-13", kind: "voice", credits: 120, detail: "42 voice replies · ElevenLabs" },
    { date: "2026-06-12", kind: "app_build", credits: 850, detail: "Built 'invoice tracker' mini-app" },
    { date: "2026-06-12", kind: "chat", credits: 64, detail: "318 chat turns · DeepSeek" },
    { date: "2026-06-11", kind: "doc_ingest", credits: 200, detail: "Ingested 2 PDFs (88 pages)" },
    { date: "2026-06-10", kind: "voice", credits: 95, detail: "31 voice replies · ElevenLabs" },
    { date: "2026-06-09", kind: "chat", credits: 51, detail: "240 chat turns · DeepSeek" },
  ];
}

// ---------------------------------------------------------------------------
// BILLING
// ---------------------------------------------------------------------------

export const SUBSCRIPTIONS: Subscription[] = [
  { id: "sub_001", customerName: "Layla Haddad", plan: "Pro", amountUsd: 49, interval: "monthly", status: "active", nextInvoice: "2026-07-03" },
  { id: "sub_002", customerName: "Marcus Bauer", plan: "Business", amountUsd: 149, interval: "monthly", status: "active", nextInvoice: "2026-07-17" },
  { id: "sub_003", customerName: "Omar Khalil", plan: "Vualet One", amountUsd: 299, interval: "monthly", status: "active", nextInvoice: "2026-06-22" },
  { id: "sub_004", customerName: "Sofia Rossi", plan: "Pro", amountUsd: 49, interval: "monthly", status: "past_due", nextInvoice: "2026-06-01" },
  { id: "sub_005", customerName: "Daniel Schmidt", plan: "Business", amountUsd: 149, interval: "monthly", status: "active", nextInvoice: "2026-06-30" },
  { id: "sub_006", customerName: "Yusuf Demir", plan: "Business", amountUsd: 1490, interval: "yearly", status: "active", nextInvoice: "2026-06-15" },
  { id: "sub_007", customerName: "Hana Suzuki", plan: "Vualet One", amountUsd: 299, interval: "monthly", status: "active", nextInvoice: "2026-07-05" },
  { id: "sub_008", customerName: "James Okoro", plan: "Starter", amountUsd: 19, interval: "monthly", status: "active", nextInvoice: "2026-07-14" },
];

// REAL HOOK: Stripe subscriptions list
export function getSubscriptions(): Subscription[] {
  return SUBSCRIPTIONS;
}

export const REFUND_REQUESTS: RefundRequest[] = [
  { id: "rf_001", customerId: "cus_005", customerName: "Sofia Rossi", customerEmail: "sofia@milanoboutique.it", amountUsd: 49, reason: "Charged after cancellation request", requested: "2026-06-13", status: "pending" },
  { id: "rf_002", customerId: "cus_007", customerName: "Aisha Rahman", customerEmail: "aisha@rahman-clinic.ae", amountUsd: 49, reason: "Voice quality issues all month", requested: "2026-06-12", status: "pending" },
  { id: "rf_003", customerId: "cus_014", customerName: "Lucas Almeida", customerEmail: "lucas@almeida-imoveis.br", amountUsd: 49, reason: "Duplicate charge", requested: "2026-06-11", status: "pending" },
  { id: "rf_004", customerId: "cus_002", customerName: "Marcus Bauer", customerEmail: "m.bauer@bauer-gmbh.de", amountUsd: 30, reason: "Partial — downgraded mid-cycle", requested: "2026-06-10", status: "approved" },
  { id: "rf_005", customerId: "cus_011", customerName: "Elena Petrova", customerEmail: "elena@petrova-design.bg", amountUsd: 19, reason: "Did not use the service", requested: "2026-06-08", status: "denied" },
];

// REAL HOOK: refund queue table (or Stripe disputes / refund intents)
export function getRefundRequests(): RefundRequest[] {
  return REFUND_REQUESTS;
}

// ---------------------------------------------------------------------------
// PROVIDER HEALTH
// ---------------------------------------------------------------------------

export const PROVIDER_HEALTH: ProviderHealth[] = [
  { name: "DeepSeek", category: "AI", status: "operational", latencyMs: 740, uptime30d: 99.92, note: "Primary LLM for chat + app builds", lastChecked: "2026-06-14T09:41:00Z" },
  { name: "ElevenLabs", category: "Voice", status: "degraded", latencyMs: 2180, uptime30d: 99.41, note: "Elevated TTS latency since 08:00 UTC", lastChecked: "2026-06-14T09:41:00Z" },
  { name: "RunPod", category: "Compute", status: "operational", latencyMs: 310, uptime30d: 99.78, note: "GPU pool for ingestion / embeddings", lastChecked: "2026-06-14T09:41:00Z" },
  { name: "Telegram Bot API", category: "Channel", status: "operational", latencyMs: 180, uptime30d: 99.99, note: "20 bots polling, all healthy", lastChecked: "2026-06-14T09:41:00Z" },
  { name: "WhatsApp Bridge", category: "Channel", status: "operational", latencyMs: 420, uptime30d: 99.65, note: "Cloud API + on-host bridge", lastChecked: "2026-06-14T09:41:00Z" },
  { name: "Stripe", category: "Payments", status: "operational", latencyMs: 260, uptime30d: 100.0, note: "Live mode, webhooks current", lastChecked: "2026-06-14T09:41:00Z" },
];

// REAL HOOK: live healthchecks per provider (cron or on-demand ping)
export function getProviderHealth(): ProviderHealth[] {
  return PROVIDER_HEALTH;
}

// ---------------------------------------------------------------------------
// KPIs / OVERVIEW
// ---------------------------------------------------------------------------

// REAL HOOK: aggregate from billing DB + provider usage meters
export function getKpis(): Kpis {
  const active = CUSTOMERS.filter((c) => c.status === "active");
  const trials = CUSTOMERS.filter((c) => c.status === "trialing");
  const mrr = CUSTOMERS.reduce((sum, c) => sum + c.mrrUsd, 0);
  return {
    totalCustomers: CUSTOMERS.length,
    activeSubscriptions: active.length,
    mrrUsd: mrr,
    trials: trials.length,
    todaySpendUsd: 312.4, // provider cost so far today
    todayRevenueUsd: 884.0, // recognized revenue so far today
  };
}

// 14-day spend vs revenue sparkline-ish series for the overview chart
export const REVENUE_VS_COST_14D: { date: string; revenueUsd: number; costUsd: number }[] = [
  { date: "06-01", revenueUsd: 790, costUsd: 280 },
  { date: "06-02", revenueUsd: 810, costUsd: 295 },
  { date: "06-03", revenueUsd: 760, costUsd: 270 },
  { date: "06-04", revenueUsd: 905, costUsd: 330 },
  { date: "06-05", revenueUsd: 880, costUsd: 312 },
  { date: "06-06", revenueUsd: 640, costUsd: 240 },
  { date: "06-07", revenueUsd: 620, costUsd: 235 },
  { date: "06-08", revenueUsd: 940, costUsd: 360 },
  { date: "06-09", revenueUsd: 970, costUsd: 351 },
  { date: "06-10", revenueUsd: 1010, costUsd: 372 },
  { date: "06-11", revenueUsd: 990, costUsd: 365 },
  { date: "06-12", revenueUsd: 1040, costUsd: 388 },
  { date: "06-13", revenueUsd: 1080, costUsd: 401 },
  { date: "06-14", revenueUsd: 884, costUsd: 312 },
];

// ---------------------------------------------------------------------------
// FORMAT HELPERS
// ---------------------------------------------------------------------------

export function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function usd2(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export const STATUS_LABEL: Record<CustomerStatus, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  suspended: "Suspended",
  canceled: "Canceled",
};
