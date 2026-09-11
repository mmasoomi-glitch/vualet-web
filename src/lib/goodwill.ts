/**
 * Goodwill — the record of what the business owes a customer after an outage.
 *
 * Today that gets decided in a chat message and forgotten. This makes it an
 * auditable record: what was owed, to whom, why, what was offered, and whether
 * an operator has actually discharged it.
 *
 * IT MOVES NO MONEY. There is no verified discount or credit API in this
 * codebase — the promo path runs on Stripe, which is off for good, and the Dodo
 * client exposes checkout, cancel and refund but nothing that applies a
 * percentage or extends a period. So applying the credit stays a MANUAL
 * operator action against the processor's admin. Crediting wrongly is worse
 * than crediting late.
 *
 * It is pure: no imports, no I/O, no Date.now(). The caller supplies every
 * timestamp and id, so every rule here is deterministic and testable.
 */

export type GoodwillOfferKind = "percent_off" | "free_days";

export type GoodwillStatus = "owed" | "applied" | "waived";

export type GoodwillEntry = {
  id: string;
  createdAt: string;
  /** An OPAQUE reference — a tenant id or a hash. Never a raw phone or email. */
  subjectRef: string;
  incidentId: string | null;
  reason: string;
  kind: GoodwillOfferKind;
  /** A percentage for percent_off; a whole number of days for free_days. */
  value: number;
  status: GoodwillStatus;
  appliedAt: string | null;
  appliedBy: string | null;
  note: string | null;
};

/** Above these, the decision is big enough that no automated path should mint it. */
export const OFFER_LIMITS = Object.freeze({ maxPercent: 50, maxDays: 90 });

export function describeOffer(kind: GoodwillOfferKind, value: number): string {
  if (kind === "percent_off") return `${value}% off the next month`;
  return value === 1 ? "1 free day" : `${value} free days`;
}

export function validateOffer(
  kind: unknown,
  value: unknown,
): { ok: true } | { ok: false; reason: string } {
  if (kind !== "percent_off" && kind !== "free_days") {
    return { ok: false, reason: `Offer kind "${String(kind)}" is not one we recognise.` };
  }
  // Zero goodwill is not goodwill, and a fractional day or percent is a bug
  // rather than an intention.
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    return { ok: false, reason: "The offer value must be a whole number greater than zero." };
  }
  if (kind === "percent_off" && value > OFFER_LIMITS.maxPercent) {
    return { ok: false, reason: `A discount above ${OFFER_LIMITS.maxPercent}% needs a human, not an automated path.` };
  }
  if (kind === "free_days" && value > OFFER_LIMITS.maxDays) {
    return { ok: false, reason: `More than ${OFFER_LIMITS.maxDays} free days needs a human, not an automated path.` };
  }
  return { ok: true };
}

/** A raw phone or email must never reach storage — only an opaque reference. */
function looksLikeRawIdentifier(value: string): boolean {
  if (value.includes("@")) return true;
  if (/^\+[\d\s-]+$/.test(value)) return true;
  if (/^\d{7,}$/.test(value)) return true;
  return false;
}

export function createEntry(input: {
  id: string;
  nowIso: string;
  subjectRef: string;
  incidentId?: string | null;
  reason: string;
  kind: GoodwillOfferKind;
  value: number;
}): { ok: true; entry: GoodwillEntry } | { ok: false; reason: string } {
  if (!input.id || input.id.trim().length === 0) {
    return { ok: false, reason: "An entry needs an id." };
  }
  if (!input.subjectRef || input.subjectRef.trim().length === 0) {
    return { ok: false, reason: "An entry needs a subject reference." };
  }
  if (looksLikeRawIdentifier(input.subjectRef)) {
    return {
      ok: false,
      reason: "That looks like a raw phone or email. Store an opaque reference such as a tenant id or a hash instead.",
    };
  }
  if (!input.reason || input.reason.trim().length === 0) {
    return { ok: false, reason: "An entry needs a reason — someone will read this months from now." };
  }

  const offer = validateOffer(input.kind, input.value);
  if (!offer.ok) return offer;

  return {
    ok: true,
    entry: {
      id: input.id,
      createdAt: input.nowIso,
      subjectRef: input.subjectRef,
      incidentId: input.incidentId ?? null,
      reason: input.reason,
      kind: input.kind,
      value: input.value,
      status: "owed",
      appliedAt: null,
      appliedBy: null,
      note: null,
    },
  };
}

export function applyEntry(
  entry: GoodwillEntry,
  atIso: string,
  operator: string,
  note?: string,
): { ok: true; entry: GoodwillEntry } | { ok: false; reason: string } {
  // An obligation must not be discharged twice.
  if (entry.status !== "owed") {
    return { ok: false, reason: `This entry is already ${entry.status}; it cannot be applied again.` };
  }
  // An audit record with no actor is not an audit record.
  if (!operator || operator.trim().length === 0) {
    return { ok: false, reason: "Applying goodwill needs the operator who did it." };
  }
  return {
    ok: true,
    entry: { ...entry, status: "applied", appliedAt: atIso, appliedBy: operator, note: note ?? null },
  };
}

export function waiveEntry(
  entry: GoodwillEntry,
  atIso: string,
  operator: string,
  note: string,
): { ok: true; entry: GoodwillEntry } | { ok: false; reason: string } {
  if (entry.status !== "owed") {
    return { ok: false, reason: `This entry is already ${entry.status}; it cannot be waived.` };
  }
  if (!operator || operator.trim().length === 0) {
    return { ok: false, reason: "Waiving goodwill needs the operator who decided it." };
  }
  // Declining to pay someone what you said you would owes an explanation on the record.
  if (!note || note.trim().length === 0) {
    return { ok: false, reason: "Waiving goodwill requires a note explaining why." };
  }
  return {
    ok: true,
    entry: { ...entry, status: "waived", appliedAt: atIso, appliedBy: operator, note },
  };
}

export function outstanding(entries: readonly GoodwillEntry[]): GoodwillEntry[] {
  if (!entries || !Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && e.status === "owed")
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
