# Mira Chrome Extension — conversion audit

Source of truth: the vualet-web repository and the canonical ledger. Facts below were traced
through runtime behaviour, not inferred from filenames. Ledger rows are cited by id.

Scope boundary: **vualet-web only.** The Mira WhatsApp engine lives in the `ballerina` project and
is out of bounds for this work; nothing here reads or writes it.

---

## 1. Capability map

What the product actually is: Mira is an assistant whose real capability lives in the customer's own
WhatsApp, reached by pairing a device with a QR code. That engine is a different project.

What exists **in this repository**, browser-side:

| Capability | Implementation | Notes |
|---|---|---|
| Conversational assistant | `POST /api/veridian-demo` → `{ reply, trialGate }` | Its own header calls it a *strict read-only sandbox*. Grounded ONLY in a curated public knowledge base about Vualet/Mira plus what this visitor previously said. No tools, no function-calling, no browsing, no side effects. |
| Durable per-visitor memory | `src/lib/veridian-memory.ts`, keyed by `vd_visitor` cookie | HttpOnly, Secure, SameSite=Lax, ~1 year. Remembers a returning visitor's name and volunteered facts. Survives restarts and redeploys. |
| Spoken replies | `POST /api/veridian-voice` → `audio/mpeg` | ElevenLabs. Returns **204** when the key is unset, on error, or past its cap; the client then falls back to browser `speechSynthesis`, so a voice is always available. |
| Free-trial email gate | `trialGate` flag; `POST { email }` | After N messages with no email on file the assistant asks for one. No card is requested. |
| Account / billing | `/api/portal`, `/api/subscription`, `/api/checkout` | Behind an HMAC-signed HttpOnly session cookie. |
| WhatsApp pairing | `/api/begin`, `/api/pair/start` | Mints a connect token; the QR is served by the engine. |

**There is no authenticated chat endpoint anywhere in this repository.** A signed-in customer cannot
reach their real assistant through vualet-web. This is the single most important finding, because it
bounds what the extension can honestly be.

Caps that already exist and must be preserved: message 800 chars; reply 520 tokens; 20 req/min per
IP; **global** daily cap of 2000 model calls (`VERIDIAN_DAILY_CAP`), beyond which a grounded
knowledge-base answer is served instead; voice 700 chars, 30/min, 1500/day.

Obsolete / out of scope for the extension: the marketing pages, checkout funnel, admin surface, CSP
report sink, blog, VPN preview. None of it belongs in an extension package.

---

## 2. Single purpose

> **Mira Help answers questions about Mira and Vualet in a browser side panel, speaks its answers,
> and remembers what you told it.**

Every capability shipped supports that one sentence. Ruled by the judge over three rejected
alternatives (see §6).

The extension is **not** titled "your AI assistant" and does not imply a general-purpose assistant.
The listing must state plainly that answers are limited to Mira/Vualet knowledge and that the real
WhatsApp assistant is paired separately.

---

## 3. Architecture conversion decision

| Decision | Choice | Why |
|---|---|---|
| Surface | **Side panel** (`chrome.sidePanel`) | Persistent, reachable on any tab, does not touch page content. The workflow being converted is a conversation, which suits a panel rather than a transient popup. |
| Content scripts | **None** | Nothing requires page access. Adding one would need host permissions and a new data flow for a capability Mira does not have. |
| Service worker | Minimal | Opens the panel on action click and nothing else. No alarms, no polling, no persistent state. |
| Business logic | **Stays server-side** | The assistant, grounding check, memory and caps already exist and are not duplicated into the client. |
| Client state | `chrome.storage.local` | Conversation transcript for redisplay, voice on/off, and the visitor id (§5). |
| Remote code | **None** | All logic ships in the package. API responses are DATA, rendered as text, never executed. |

This is a conversion, not a wrapper: the interface is implemented natively in the extension and
reuses the existing backend. It never opens, embeds, or redirects to mira.vualet.com to do its job.

### Backend change the extension genuinely requires

The website's `vd_visitor` cookie is `SameSite=Lax`, so it is **not sent** on a cross-site fetch from
an extension origin. Server-side memory would silently break — every message would look like a new
visitor. Two options were considered:

- Relax the cookie to `SameSite=None` — **rejected**, it weakens the website's CSRF posture for a
  reason that has nothing to do with the website.
- **Chosen:** a dedicated extension route that accepts an explicit, opaque visitor id supplied by the
  extension. The website's cookie is untouched.

---

## 4. Permission map

Every entry must survive the one-sentence reviewer test.

| Permission | Justification | Why nothing weaker works |
|---|---|---|
| `sidePanel` | The entire user interface is a side panel. | There is no lesser form of this API. |
| `storage` | Persists the conversation transcript, the voice on/off preference, and the visitor id across browser restarts. | `session` storage is cleared on restart and would lose the transcript and the identity that carries memory. |
| host `https://mira.vualet.com/*` | The only origin the extension talks to: the assistant endpoint and the voice endpoint. | `activeTab` grants nothing here — this is an outbound API call, not page access. |

**Deliberately absent, and each would be a rejection risk:** `tabs`, `activeTab`, `scripting`,
`<all_urls>`, `cookies`, `webRequest`, `management`, `privacy`, `notifications`, `alarms`,
`contextMenus`, `downloads`, `identity`.

---

## 5. Data-flow map

| Data | Origin | Where it goes | Retention |
|---|---|---|---|
| Message text the user types | User | `POST https://mira.vualet.com/api/extension/chat` over HTTPS, then to the model provider | Server-side visitor memory; transcript in `chrome.storage.local` |
| Reply text | Server | Rendered as **text** in the panel | Transcript in `chrome.storage.local` |
| Reply audio | `/api/veridian-voice` | Played, not stored | Not retained |
| Visitor id | Generated **in the extension** | Sent as a header so memory works | `chrome.storage.local` until the user clears it |
| Email address, only if the user types it into the trial gate | User | Server, same as on the website | Server-side |

The visitor id is a **256-bit value from `crypto.getRandomValues`**. It is a bearer capability: anyone
holding it can read that visitor's memory. It is therefore unguessable by construction, is never
derived from anything about the person or the machine, and is not an identifier that can be
correlated to them. This is stated plainly because it is the one place the extension is weaker than
the website, whose cookie is HttpOnly and unreadable by script.

**Not collected:** browsing history, page content, tab URLs, cookies, credentials, location,
analytics, telemetry, advertising identifiers, behavioural profiling. No content script exists, so
the extension cannot see any page.

---

## 6. Policy-risk assessment

Ranked by the chance of a reviewer stopping the submission.

| # | Risk | Assessment |
|---|---|---|
| 1 | **Promotional / minimum functionality.** An assistant that answers questions about the publisher's own product can read as marketing rather than a tool. | The judge ruled this shippable: Chrome's rule bars useless, promo-only and single-page-wrapper items, not vendor support assistants. A persistent side panel with voice and durable memory, usable on any tab, is functional utility. **This remains the top rejection risk and is stated honestly rather than dressed up.** |
| 2 | **Description vs behaviour.** Calling it "your AI assistant" would imply a general assistant while the behaviour is a scoped knowledge-base bot. | Mitigated by the single-purpose statement in §2 and a listing that says what it does and does not do. |
| 3 | **Copy that overclaims.** The site's absolutes were removed at `9f6fac7` (`verifications#1105`, `#1104`): "zero hallucination", "she can't make anything up", "perfect recall", "zero fabrication". | The listing MUST NOT reintroduce them. The evidenced claim, and the only one permitted, is that **a grounding check runs on every reply and rewrites an unsupported answer into an honest "I don't know" before it is sent** (`verifications#908`, 8/8 adversarial cases). The terms say Mira is *designed* not to fabricate — a design commitment, not a fact. |
| 4 | **Email trial gate.** After N messages the assistant asks for an email to continue. In an extension this is closer to gating functionality behind lead capture than it is on a website. | Existing product behaviour, preserved per the brief, but it must be disclosed in the store data declarations and the privacy policy. **Flagged for the owner:** consider letting the panel keep working after the ask rather than gating, which removes the risk entirely. Not changed unilaterally. |
| 5 | **Shared global cap.** The assistant endpoint has a 2000/day cap across all visitors. Store users consume the same budget as website visitors. | Not a policy issue but a product one: past the cap users get a grounded knowledge-base answer rather than a model reply. Behaviour is graceful, and the same as the website's. **Flagged for the owner.** |
| 6 | Remotely hosted code | None. All logic is in the package; API output is data rendered as text. |
| 7 | CSP | `script-src 'self'; object-src 'none'`. No `eval`, no `new Function`, no inline handlers. |

---

## 7. What is explicitly NOT preserved, and why

The brief forbids silently dropping capability, so this is stated rather than omitted.

- **The real WhatsApp assistant.** Its engine is another project and out of bounds. The extension
  cannot reach it, and the listing says so instead of implying otherwise.
- **Checkout, billing and account management.** Out of the single purpose. A user manages billing on
  the website; putting it in the extension would broaden the purpose and the permission set for no
  browser-native benefit.
- **WhatsApp pairing.** Requires scanning a QR with a phone. Nothing about it is improved by being in
  a side panel.
