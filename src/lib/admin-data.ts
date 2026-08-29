/**
 * Replaces the deleted stub's fabricated data with metrics derived from the live
 * subscription store. Any metric this app cannot truthfully know is declared
 * as unavailable rather than invented.
 */
import { listSubscriptions } from "@/lib/store";

export type AdminCustomer = {
  id: string;
  email: string;
  plan: string;
  channel: string;
  status: string;
  joined: string;
  bound: boolean;
};

export type AdminKpis = {
  totalCustomers: number;
  activeSubscriptions: number;
  trials: number;
  /** Metrics this app cannot source truthfully. Each is a short human reason. */
  unavailable: Record<string, string>;
};

const UNAVAILABLE_BASE: Record<string, string> = {
  mrrUsd: "plan prices live in Dodo; this app has no authoritative price list",
  creditsUsed: "usage is metered in the engine database, not reachable from the web app",
  todaySpendUsd: "provider cost is not recorded in this app",
  todayRevenueUsd: "recognised revenue requires Dodo payment data this app does not store",
};

export async function getAdminCustomers(limit?: number): Promise<AdminCustomer[]> {
  try {
    const subs = await listSubscriptions(limit);
    const customers: AdminCustomer[] = subs.map(({ customerId, rec }) => ({
      id: customerId,
      email: rec.email ?? "",
      plan: rec.plan,
      channel: rec.channel ?? "unknown",
      status: rec.status,
      joined: rec.createdAt ?? "",
      bound: typeof rec.telegramId === "number",
    }));
    // Newest-first by joined; empty joined sorts last
    customers.sort((a, b) => {
      if (a.joined === "" && b.joined === "") return 0;
      if (a.joined === "") return 1;
      if (b.joined === "") return -1;
      return b.joined.localeCompare(a.joined);
    });
    return customers;
  } catch {
    return [];
  }
}

export async function getAdminKpis(): Promise<AdminKpis> {
  try {
    const subs = await listSubscriptions();
    const totalCustomers = subs.length;
    let activeSubscriptions = 0;
    let trials = 0;
    for (const { rec } of subs) {
      if (rec.status === "active") activeSubscriptions++;
      // "trialing" is not a member of this record's status union, so the plan field is the only honest trial signal
      if (rec.plan === "trial") trials++;
    }
    return {
      totalCustomers,
      activeSubscriptions,
      trials,
      unavailable: { ...UNAVAILABLE_BASE },
    };
  } catch {
    return {
      totalCustomers: 0,
      activeSubscriptions: 0,
      trials: 0,
      unavailable: {
        ...UNAVAILABLE_BASE,
        counts: "the subscription store could not be read",
      },
    };
  }
}
