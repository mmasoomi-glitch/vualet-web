# Payment lifecycle runbook — buy → cancel → refund, in Dodo TEST MODE

How to prove the full money lifecycle end to end **without moving one real cent**.

---

## ⛔ READ THIS FIRST — the card rule

> **NEVER put real card details in a file. Not in this repo, not in a scratch file,
> not in a chat message, not in an env var, not in a ticket, not "just for a minute".**
>
> A real PAN in a plaintext file is a PCI-DSS breach the moment it is written, and it
> stays a breach in your shell history, your editor's undo buffer, your backups and
> your ledger. There is no safe version of it.
>
> **This lifecycle is proven with Dodo's published TEST-MODE cards only.** Test cards
> are synthetic numbers that only exist inside Dodo's sandbox. They move no money,
> settle to no bank, and belong to no human.

This was not a hypothetical. The owner offered real card details in a plaintext file
to get this proven; jury #107 constraint 2 **refused** it and ordered this route
instead — *identical code path, zero real money*.

Second rule, equally hard: **never read, print, log or commit an API key.** Everything
below refers to env vars **by NAME only**. If a step tempts you to echo a key to check
it, the check is wrong, not the rule.

---

## What is already proven, and what only this runbook can prove

| Layer | Proven by | Covers |
|---|---|---|
| **Our request contract** | `scripts/payment-lifecycle-test.mjs` — 44 tests, injected fake HTTP, no network | method, path, body fields, Bearer auth shape, fail-closed errors, test/live URL switch |
| **Dodo accepts it** | **this runbook only** | real sandbox HTTP, hosted checkout, webhook delivery, real state transitions |

Run the offline suite as the gate before you touch a sandbox:

```bash
cd C:\vualet-web
node --test scripts/payment-lifecycle-test.mjs
```

Expect `pass 44`, `fail 0`. If it is red, **stop** — do not go looking for the problem
in the sandbox. (There is intentionally no `npm run` alias: `package.json` is owned by
another concern. Invoke the file directly.)

---

## Preconditions (owner / Dodo dashboard — all human)

1. A Dodo merchant account with **test mode** available.
2. Three **test-mode** subscription products created (Companion / Assistant / Studio).
   Test-mode product ids are *different objects* from live-mode ones — never reuse.
3. A **test-mode** webhook endpoint pointed at a URL your machine can receive on.
4. A **test-mode** API key. Test and live keys are different credentials; a live key
   sent to the test host will simply fail auth, which is the fail-safe you want.

### Where the test cards come from

From **Dodo's own published test-mode card list** — the test-payments page of
`docs.dodopayments.com`, or the test-mode banner inside the Dodo dashboard itself.

- Read them at the moment you need them; **do not copy them into this repo**, into a
  notes file, or into the ledger. A saved card number — even a fake one — trains the
  habit that ends with a real one in a file.
- Dodo publishes distinct numbers for *success*, *decline*, and *3-D Secure challenge*.
  Use the success card for the main path, and run the decline card once (step 3b) so
  you know the failure branch is real and not just theoretical.

---

## Environment (names only — never paste values into a shared surface)

> ## ⛔ NEVER SET THESE ON THE PRODUCTION SERVER
>
> An earlier draft of this section said to set them in `/opt/mira-web/runtime.conf`.
> **That is the LIVE money-taking server.** Setting `DODO_MODE=test` there would
> point `mira.vualet.com` at the Dodo sandbox: real customers would be sent to a
> checkout that takes no real money, and real revenue would silently stop while
> everything still looked healthy. Corrected 2026-08-04 after an adversarial
> review caught it.
>
> Run this lifecycle **only** in a local shell or a dedicated staging instance —
> a process that is *not* serving `mira.vualet.com`.

Set these **in your local shell / staging environment only**. **Never in git, and
never in the production `runtime.conf`.**

```bash
# local shell — scoped to this one process, gone when you close the terminal
export DODO_API_KEY=…        # your TEST-mode key (never the live key)
export DODO_MODE=test        # selects https://test.dodopayments.com
export DODO_PAYMENTS_LIVE=1  # opens the money path in THIS process only
```

| Env var | Test-mode value | Why |
|---|---|---|
| `DODO_API_KEY` | your **test-mode** key | auth — must be the test key, never the live one |
| `DODO_MODE` | `test` | selects `https://test.dodopayments.com` |
| `DODO_PAYMENTS_LIVE` | `1` | opens the money path; otherwise checkout returns "coming soon" 503 |

**Before you start, confirm you are not on the production host:** if
`/opt/mira-web/runtime.conf` exists on the machine you are typing into, stop —
you are on the live server and this runbook does not belong there.
| `DODO_PRODUCT_COMPANION` | **test-mode** product id | tier mapping |
| `DODO_PRODUCT_ASSISTANT` | **test-mode** product id | tier mapping |
| `DODO_PRODUCT_STUDIO` | **test-mode** product id | tier mapping |
| `DODO_WEBHOOK_SECRET` | **test-mode** signing secret | webhook verification |
| `MIRA_WEB_URL` | your local/staging origin | the `return_url` sent to Dodo |
| `REFUND_REQUEST_FILE` | a path **outside** the deploy tree | where refund requests land |

### ⚠️ The gotcha that will bite you

`DODO_MODE` and `DODO_PAYMENTS_LIVE` are **independent variables**. They sound like the
same switch. They are not:

- `DODO_MODE` chooses **which host** gets the traffic (test vs live).
- `DODO_PAYMENTS_LIVE` chooses **whether the money path is open at all**.

So `DODO_PAYMENTS_LIVE=1` with `DODO_MODE=test` is exactly right for this runbook: the
path is open, the traffic is sandboxed. And `DODO_PAYMENTS_LIVE=1` alone does **not**
put you on the live host. Both facts are asserted in the offline suite
(`gate: GOTCHA — DODO_PAYMENTS_LIVE=1 alone still sends traffic to the TEST host`).

The base-URL check is an **exact, case-sensitive `"live"`**. `LIVE`, `Live`, `production`,
`true`, `1` and unset all fall back to the **test** host. That is deliberate fail-safe
behaviour: a typo can only ever cost you a sandbox request, never a real charge.

> **Do not run this against production.** Do not restart `mira-web` on the Hetzner box
> to do it. `mira.vualet.com` is live and taking real money; a config flip there is an
> owner-attended change, not a test step.

---

## The sequence

Legend: 🤖 = automatable · 🧍 = **requires a human** · 📋 = evidence to capture

### Step 1 — 🤖 Create the checkout

Call `POST /api/checkout` (or `createDodoCheckout()` directly) for one plan. It returns
a hosted `payment_link`.

📋 Capture: the request timestamp, the plan, the `connect_token` you sent, the returned
`subscription_id`, and the **host** of the payment link — it must be Dodo's test host.
Do **not** capture the Authorization header.

**Guard:** if the URL you got back is on `live.dodopayments.com`, stop immediately and
fix `DODO_MODE` before doing anything else.

### Step 2 — 🧍 Pay on the hosted checkout page

**This step cannot be automated, and should not be.** The checkout page is Dodo's,
rendered on Dodo's domain, and it is a PCI boundary — that is the entire point of a
hosted page. Card entry happens in a human's browser, in Dodo's iframe, and never
touches our servers, our logs, or an agent's context.

Open the `payment_link` in a browser, and enter a **Dodo published test card** (success
variant) with any future expiry and any CVC, per Dodo's test-mode instructions.

📋 Capture: a screenshot of the **test-mode banner** on the checkout page (proof you
were in the sandbox), and the redirect you land on — it should be
`{MIRA_WEB_URL}/mira/welcome?token={connect_token}`. **Never screenshot the card fields.**

### Step 2b — 🧍 (recommended) Run the decline card once

Repeat step 2 with Dodo's **decline** test card. Confirm the user sees an honest failure
and that **no tier is activated**. A payment path you have only ever seen succeed is a
payment path you have not tested.

📋 Capture: the error the customer sees, and proof that no `ConnectRecord` was activated.

### Step 3 — 🤖/🧍 Observe the webhook

Dodo posts to your test-mode webhook endpoint (`/api/webhooks/dodo`). Our route verifies
the Standard-Webhooks signature, dedupes on the `webhook-id` header, and activates the tier.

Activating events: `subscription.active`, `subscription.renewed`, `payment.succeeded`.

📋 Capture:
- the event type and the `webhook-id`
- that the route returned 2xx and **verified the signature** (a 4xx here means the
  secret is wrong — fix it; do not disable verification)
- the resulting `ConnectRecord`: `status`, `plan`, `subscriptionId`, `customerId`
- the **`payment_id`** — you need it for step 5, and it is easiest to grab now
- that the tier matches the product you bought (`planForProductId` round-trip)

If the webhook cannot reach your machine, use a tunnel or replay the event from the Dodo
dashboard. **Do not** "prove" this step by calling the activation function by hand —
that skips signature verification, which is a third of what the step exists to test.

### Step 4 — 🤖 Cancel

Call `POST /api/subscription/cancel`. It takes **no request body**: identity comes only
from the signed session cookie. That is the anti-IDOR shape — there is nothing for a
caller to tamper with.

Under the hood: `PATCH /subscriptions/{id}` with `cancel_at_next_billing_date: true` and
`cancel_reason: "cancelled_by_customer"`.

📋 Capture:
- the Dodo subscription state afterwards — it should be **cancel-at-period-end**, *not*
  terminated on the spot. The customer keeps what they already paid for.
- our stored `status` — and confirm it flipped to `cancelled` **only after** Dodo confirmed
- that a second cancel is idempotent, not a 500
- the cancellation event webhook (`subscription.cancelled` / `.canceled` / `.expired`)

### Step 5 — 🧍 Refund

**The refund is deliberately not reachable from any customer-facing route.** Cancelling
is the customer's own right; refunding moves money *out* and is a fraud surface, so it
stays behind a human. Jury #107 constraint 3: the support bot may *file* a refund request
and *summarise* the evidence — it must never adjudicate whether a reason is legitimate,
and never accuse anyone of a false claim. **A human decides.**

So there are exactly two legitimate ways to refund:

- **Preferred:** issue it from the **Dodo test-mode dashboard**.
- **Operator path:** a human runs `refundDodoPayment(payment_id)` from a trusted
  operator context (`POST /refunds`, `payment_id` from step 3).

**Do not wire `refundDodoPayment` into a route to make this step convenient.**
`scripts/cancel-refund-test.mjs` asserts that it is not imported by the customer-facing
route, and that assertion is load-bearing — if you break it to run this step, you have
turned a jury constraint into a bug.

📋 Capture: the `refund_id`, the refund `status`, the resulting Dodo payment state, and
**who authorised it** (a named human). Also confirm the customer-facing
`POST /api/subscription/refund-request` still only appends to the `REFUND_REQUEST_FILE`
JSONL and emails the operator — it must never call the provider.

### Step 6 — 🤖 Teardown

Revert `DODO_PAYMENTS_LIVE` and `DODO_MODE` to their prior values. Delete any test
`ConnectRecord`s you created. Leave no dangling unpaid probe subscriptions — and if one
is left to auto-expire, record its id so nobody later mistakes it for a real customer.

---

## Evidence bundle

One run should produce:

1. `node --test scripts/payment-lifecycle-test.mjs` output — 44 pass, 0 fail
2. Checkout response: plan, `subscription_id`, payment-link **host** (test)
3. Screenshot of the checkout page's **test-mode banner** (never the card fields)
4. Decline-card result (step 2b)
5. Webhook: event type, `webhook-id`, signature-verified 2xx, activated `ConnectRecord`, `payment_id`
6. Cancel: Dodo state = cancel-at-period-end, our `status` = cancelled, second call idempotent
7. Refund: `refund_id`, status, **authorising human's name**
8. Teardown confirmation

Record the result in the ledger as a `verification` row. Log `pass` **only** for steps
you actually observed. A truthful "steps 1–4 verified, 5 pending an operator" is worth
more than a `pass` that nobody can reproduce.

---

## Known limit carried forward

`createDodoCheckout` / `cancelDodoSubscription` / `refundDodoPayment` each embed up to
300 characters of the provider's error body verbatim in the `Error` they throw. Our key
is never placed in a URL or a request body (asserted by the offline suite), so Dodo has
nothing to reflect back — but a provider that *did* echo a credential in an error body
would reach that string. Redacting the key substring before interpolation belongs to
whoever owns `src/lib/dodo.ts`; it is recorded here so it is tracked rather than
forgotten. The offline suite pins the current behaviour, so a future fix will flip that
test loudly instead of passing in silence.

---

## Related files

- `C:\vualet-web\scripts\payment-lifecycle-test.mjs` — the offline contract proof (44 tests)
- `C:\vualet-web\scripts\cancel-refund-test.mjs` — the anti-IDOR / refund-boundary assertions
- `C:\vualet-web\scripts\dodo-webhook-test.mjs` — signature verification, replay guard, activation
- `C:\vualet-web\docs\DODO_PAYMENTS_SETUP.md` — product/webhook configuration checklist
- `C:\vualet-web\src\lib\dodo.ts` — the client under test *(owned by another concern — do not edit here)*
