# Mira Help — Chrome Web Store submission material

Every statement below was checked against the built package. Nothing here describes behaviour the
extension does not have. This file is documentation and is **not** included in the submission ZIP.

Package: `extension/dist/mira-help-0.1.0.zip` — built by `node extension/tools/package.mjs`.

---

## Item name

**Mira Help**

## Single-purpose statement

> Mira Help answers questions about Mira and Vualet in a browser side panel, speaks the answers, and
> remembers what you told it.

## Short description (132 char limit)

> Ask questions about Mira and Vualet in a side panel and listen to spoken answers.

## Full description

```
Mira Help puts a small assistant in your browser's side panel that answers questions about
Mira and Vualet — what the products do, how they work, what they cost.

It is a focused helper, not a general-purpose assistant. The Mira service answers from
Vualet's own published knowledge and says it does not know when a question falls outside
that, so asking something unrelated gets you a straight "I don't know" rather than a guess.
The extension is the panel you read it in.

WHAT IT DOES
• Answers questions about Mira and Vualet in a side panel you can open on any tab
• Speaks its answers aloud, and you can turn the voice off
• Remembers what you told it earlier, so you are not starting over each time
• Keeps your conversation so the panel is not blank when you reopen it

WHAT IT DOES NOT DO
• It cannot see the pages you visit. It has no access to your tabs, history, bookmarks or
  cookies, and it injects nothing into any website.
• It is not the Mira assistant that runs in WhatsApp. That one is connected separately by
  pairing a device, and this extension cannot reach it.
• It contains no analytics, no tracking and no advertising.

PRIVACY
It talks to exactly one place: mira.vualet.com. It sends the messages you type, and your
email address only if you choose to enter it. It stores your conversation and your voice
preference on your own machine. "Clear conversation" deletes them and also forgets you on
our side.

Privacy policy: https://vualet.com/legal/privacy
```

**Copy rule that binds this listing.** The absolutes "zero hallucination", "she can't make anything
up", "perfect recall", "zero fabrication" and "never invents" were removed from Vualet's published
copy at commit `9f6fac7` for being unevidenced (`verifications#1105`, `#1104`). They must not
reappear here. The evidenced claim — and the only one permitted — is that a grounding check runs on
every reply and rewrites an unsupported answer into an honest "I don't know" before it is sent
(`verifications#908`, 8/8 adversarial cases). The description above deliberately makes the weaker,
true claim instead.

---

## Permission justifications

Each is one sentence, which is the test a reviewer applies.

| Permission | Justification |
|---|---|
| `sidePanel` | The extension's entire user interface is a browser side panel; this API is what opens it. |
| `storage` | Stores the conversation transcript, the voice on/off preference, and the random visitor id on the user's own machine so the panel is not blank on reopen. |

### Host permission

| Host | Justification |
|---|---|
| `https://mira.vualet.com/api/veridian-demo` | Returns the assistant's reply to a question. |
| `https://mira.vualet.com/api/veridian-voice` | Returns the spoken audio for a reply. |

Narrowed from `https://mira.vualet.com/*` after an adversarial review: the wildcard granted the whole
origin when exactly two endpoints are used. No other origin is contacted.

**Not requested, deliberately:** `tabs`, `activeTab`, `scripting`, `cookies`, `webRequest`,
`management`, `privacy`, `notifications`, `alarms`, `contextMenus`, `downloads`, `identity`,
`<all_urls>`, and there are no `content_scripts`.

---

## Data-use declarations

| Category | Collected? | Detail |
|---|---|---|
| Personally identifiable information | **Yes — email only** | Only if the user types it at the trial prompt. Nothing else in this category. |
| Health, financial, authentication, location, personal communications | No | — |
| Web history | **No** | The extension has no permission that could read it. |
| User activity | **No** | No analytics, telemetry, click tracking or fingerprinting in the extension. Note that the server applies per-IP rate limiting, so a request's IP address and timestamp are seen server-side like any HTTP request; that is disclosed here rather than claimed away. |
| Website content | **No** | No content script exists; the extension cannot read any page. |

Required certifications, all of which the implementation supports:

- Data is **not** sold to third parties.
- Data is used **only** for the single purpose above.
- Data is **not** used to determine creditworthiness or for lending.

**The messages a user types are transmitted** to `mira.vualet.com` and on to the model provider to
produce a reply. This is the product working as described and is disclosed in the listing and the
privacy policy.

---

## Reviewer testing instructions

```
No account, sign-in, payment or promo code is needed. The extension is fully usable
immediately after install.

1. Install and click the Mira Help toolbar icon. The side panel opens.
2. Type "What is Mira?" and press Enter. A reply appears within a few seconds and is
   read aloud.
3. Turn off the "Voice" checkbox and send another message. The reply appears as text
   with no audio.
4. Tell it "My name is Sam", then send "What is my name?". It answers "Sam" — this is
   the memory feature.
5. Ask something outside its knowledge, e.g. "What is the capital of Peru?". It should
   decline rather than answer. This is intended: it answers only from Vualet's own
   knowledge.
6. Close and reopen the panel. The conversation is still there.
7. Click "Clear conversation". The transcript empties and the memory is reset.

WHAT YOU WILL NOT SEE, because the extension cannot do it: any interaction with the page
you are on. It has no tabs, activeTab or scripting permission and no content script.

NOTE ON A SHARED LIMIT: the answering service has a daily cap across all users. Past that
cap it returns a plain knowledge-base answer instead of a model-written one. The panel
still works; the replies are simply shorter and more generic.
```

---

## Required assets inventory

| Asset | Requirement | Status |
|---|---|---|
| Icon 128×128 | Required | Present, generated from the real mark, RGBA verified |
| Screenshots 1280×800 or 640×400 | At least 1, up to 5 | **Owner action.** Capture the whole Chrome window with the panel open and a real conversation, then run `node extension/tools/pad-screenshot.mjs <file>.png` — it scales to fit, centres, and pads to exactly 1280×800 in the site's paper colour, and refuses rather than guessing if it cannot hit the size exactly. |
| Small promo tile 440×280 | Optional | Not produced |
| Marquee 1400×560 | Optional | Not produced |
| Privacy policy URL | Required | `https://vualet.com/legal/privacy` — live, 200 |
| Single purpose | Required | §Single-purpose statement above |
| Category | Required | Suggested: **Productivity** |
| Language | Required | English |

---

## Version / release notes

**0.1.0 — first release**

```
First release. A side panel that answers questions about Mira and Vualet, speaks its
answers, and remembers what you told it.
```

---

## Known limitations, stated rather than hidden

1. **It is not the WhatsApp assistant.** That capability lives in a separate service the extension
   cannot reach. The listing says so explicitly instead of letting the name imply otherwise.
2. **The answering service has a global daily cap** shared with the website. Past it, replies come
   from the knowledge base rather than the model. Graceful, but real.
3. **The email trial gate.** After a number of messages the assistant asks for an email address to
   continue. This is existing product behaviour and is disclosed — but on a website it reads as a
   trial, and inside an extension it is closer to gating a feature behind lead capture. **Owner
   decision recommended:** letting the panel keep working after asking once would remove this risk
   entirely. It has not been changed unilaterally because the brief forbids removing capability.
4. **Not yet tested in a live Chrome profile.** The package is built and statically verified; it has
   not been loaded unpacked and exercised in a browser. That is the next step and it is named here
   rather than glossed over.
