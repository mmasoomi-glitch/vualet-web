# Engine ↔ web contract: automatic channel recovery

**Status:** the web side is built, deployed and tested. The engine side is not
written. Until it is, **the automatic recovery loop does not run in production** —
a disconnected customer who messages Mira still gets nothing back.

This document is the whole specification of what the engine has to do. It is
written here rather than implemented there because the engine is a separate
project.

---

## The problem this solves

A customer's WhatsApp session breaks. They message Mira. Today nothing happens:
the gateway has no session for them, so the message goes nowhere and they wait.
Two customers sat disconnected for days that way.

The rule is that **there must be no normal manual recovery workflow**. A
customer who says "Hi" should get a secure reconnect link back automatically,
with no employee involved.

## Why the work is split

The engine holds the WhatsApp socket and is the only thing that sees a message
arrive. The web app holds the identity — bindings, accounts, entitlement, and
the policy that decides whether a sender may be served at all.

So the engine **asks**, and the web app **answers**. Same shape and same shared
secret as the existing `POST /api/pair/bind`, because it is the same trust
relationship.

---

## 1. Ask on every inbound message from an unrecognised or unserved sender

```http
POST https://mira.vualet.com/api/channel/inbound
x-mira-bind-secret: <MIRA_BIND_SECRET>
Content-Type: application/json

{ "channelType": "whatsapp",
  "identifier": "<account JID, e.g. 12025551234@s.whatsapp.net>" }
```

**The message text is deliberately not accepted.** Do not send it. Whether a
sender is authenticated must never depend on what they typed — "I changed my
number" is a claim, not a credential.

### Response

```json
{ "action": "...", "class": "...", "accountId": "...|null",
  "bindingId": "...|null", "reply": "...|null",
  "reconnectUrl": "...", "expiresInSeconds": 600 }
```

| `action` | What the engine does |
|---|---|
| `SERVE` | Business as usual. Run the assistant. `reply` is `null`. |
| `OFFER_RECONNECT` | Send `reply`, then send `reconnectUrl` as its own message. **Do not run the assistant.** |
| `OFFER_ONBOARDING` | Send `reply`. Unknown number — do not attach it to any account. |
| `HOLD_FOR_MIGRATION` | Send `reply`. A number change is in flight; do not serve. |
| `REFUSE` | Send `reply`. Do not serve, and do not retry. |

Other statuses: `400` malformed body, `401` wrong or missing secret, `503`
secret unset in production or the binding store is unreachable. **On any
non-200, do not serve the sender** — failing open here would serve a revoked
number.

### Rate limiting is already handled

Calling this repeatedly for the same sender is safe and expected. A customer who
sends "hi" three times gets the **same** live link back, not three different
ones. When the limiter declines, the response still carries a warm `reply` and
omits `reconnectUrl` — send the reply anyway.

---

## 2. Report disconnections as they happen

Not yet implemented on the web side. When it is, the engine should report a
session ending with a structured cause rather than a log line, so the timeline
can distinguish a customer unpairing from a provider revoking from our own
deploy breaking. The reason codes are in `src/lib/channel-binding-core.mjs`
(`REASON_CODES`), and the sources are `USER_INITIATED`, `PROVIDER_INITIATED`,
`SYSTEM_INITIATED`, `SECURITY_INITIATED`, `INFRASTRUCTURE_FAILURE`, `UNKNOWN`.

Until then, disconnection is inferred from the gateway's `/healthz` counts by
the reliability poller, which is enough to alert but **not** enough to attribute
fault to anybody.

---

## 3. What already works and must not change

`POST /api/pair/bind` is unchanged in shape. Two new refusals can now come back
from it and the engine should surface both as "this didn't work, try again from
the link", not as a retryable error:

- `409 { "error": "foreign" }` — the scanning account is not the one this
  pairing session was created for. This now also fires for a **reconnect** or a
  **number-change** session scanned by the wrong number.
- `409 { "error": "revoked" }` — this WhatsApp account has a revoked or
  superseded binding. Revoked means revoked; it does not come back by scanning.

---

## Security notes for whoever implements this

- **Never log the JID.** It is a phone number wearing a suffix. The web side
  hashes it on arrival and never stores or logs the raw value.
- **Never cache the verdict.** A binding can be revoked between two messages,
  and a cached `SERVE` is exactly how a revoked number keeps working.
- **`reconnectUrl` is single-use and expires in ten minutes.** Do not persist
  it, do not re-send an old one; ask again and you will get a fresh one or the
  same live one, whichever is correct.
- **Fail closed.** If this endpoint cannot be reached, do not serve the sender.

## How to verify it end to end once built

1. Disconnect a test binding (or use one already `DISCONNECTED`).
2. Message Mira from that number.
3. Expect a reply plus a `https://mira.vualet.com/mira/reconnect?t=…` link.
4. Open it, tap **Reconnect WhatsApp**, scan the QR from that same number.
5. The binding returns to `ACTIVE`; the subscription is untouched.
6. `GET /api/ops/channel/timeline?account=<id>` (needs `health.read`) shows
   `RecoveryLinkIssued` → `RecoveryLinkUsed`, correlated by the same id.

Scanning step 4 from a **different** number must be refused with `foreign`.
