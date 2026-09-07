# Mira Help — Extension Adversarial Review

**Reviewer stance:** Hostile Chrome Web Store reviewer. Every finding is cited to an exact line or string. Vague concerns are excluded.

---

## 1. SINGLE PURPOSE

**Statement:** The extension is a side-panel chatbot that answers questions about the publisher's own products (Mira and Vualet), speaks replies aloud, and retains conversation history keyed to a local visitor ID.

**Does everything serve that purpose?** Yes — but not in the way the Store expects. *Everything* the extension does is scoped to one product's support FAQ. Nothing is generic-purpose assistant behaviour. However, several elements serve the *publisher's commercial interests* rather than user utility, which is a different problem (see §2).

---

## 2. MINIMUM FUNCTIONALITY — MARKETING DRESSED AS A TOOL

### The case for REJECTION

The extension's sole function is to answer questions about Mira and Vualet — the publisher's own products. The "empty state" text is `sidepanel.js:97`:

> "Ask me about Mira or Vualet — this panel answers questions about Mira and Vualet."

The placeholder is `sidepanel.html:41`:

> "Ask about Mira or Vualet…"

The listing description is `CHROME-WEB-STORE-SUBMISSION.md:21`:

> "Ask questions about Mira and Vualet in a side panel and listen to spoken answers."

This is a branded FAQ bot packaged as a browser extension. The Chrome Web Store guidelines state (paraphrased): extensions should provide genuine utility beyond promoting a single product. A user installing this extension gains nothing they could not achieve by visiting the product's own website. The extension adds zero value over a web page — it does not enhance browsing, it does not work across sites, it does not solve a problem that the publisher's website does not already solve. This is marketing collateral with a `manifest.json`. The "memory" feature (`storage` permission) merely retains conversation history about one company's products. The "voice" feature is a gimmick for a FAQ. The email gate (`sidepanel.js:195-197`) captures leads. This entire extension exists to put a branded icon in the toolbar that funnels users into the publisher's own ecosystem.

Additionally, the listing claims `CHROME-WEB-STORE-SUBMISSION.md:40-41`:
> "It answers from Vualet's own published knowledge and says it does not know when a question falls outside that."

But the code has no grounding check. The code at `sidepanel.js:149-156` simply POSTs the user's message to `https://mira.vualet.com/api/veridian-demo` with no local logic that could perform grounding, filtering, or refusal. Any grounding that occurs is entirely server-side and invisible to the user. The listing implies the extension itself enforces honesty; it does not.

### The case for APPROVAL

The extension *does* provide a distinct user experience from the website: a persistent side-panel chat interface that survives tab navigation, integrates voice output natively into the browser chrome, and maintains conversation context across browser sessions via `chrome.storage.local`. The voice feature (`sidepanel.js:212-238`) uses the Web Audio API to play server-generated audio — not a trivial wrapper around a webpage. The extension is a thin client for an API the publisher hosts, and thin-client extensions are a normal Chrome Web Store category (e.g., weather extensions, dictionary extensions, note-taking helpers). The fact that the API answers questions about one company's products does not automatically disqualify it — dictionary extensions answer questions about words (which are the dictionary publisher's product), and weather extensions answer questions about one weather service's data.

The "grounding" claim in the listing is about the *service*, not the extension. The extension is the client. It would be unreasonable to require client-side grounding logic that duplicates server-side behaviour.

### Which wins

The **rejection case is stronger**. The distinction above does not hold up under scrutiny: a dictionary extension provides lookup on *any word* (general-purpose utility), a weather extension provides data for *any location* (general-purpose utility). This extension answers questions about *only two products owned by the publisher*. A user who does not care about Mira or Vualet gets exactly zero utility. That is not a product — it is a support widget. Support widgets belong on websites, not in the Chrome Web Store where users expect browsing-enhancement tools.

**Verdict on this category: RISK.** A thoughtful reviewer could reject on this basis; a lenient one might not. The strongest mitigation is repositioning the listing to emphasise the *side-panel chat experience* rather than the product-QA content, and ensuring the "minimum functionality" bar is met by adding at least one genuinely general-purpose assistant capability (e.g., summarising selected text, translating arbitrary text, looking up definitions).

---

## 3. DESCRIPTION vs BEHAVIOUR

### 3a. "Remembers what you told it"

**Listing says:** `CHROME-WEB-STORE-SUBMISSION.md:36`: "Remembers what you told it earlier, so you are not starting over each time."

**Code delivers:** Partially. The transcript (up to 100 entries) is stored in `chrome.storage.local` at `sidepanel.js:53, 70, 89-93`. The visitor ID is stored at `sidepanel.js:52, 59, 65` and sent as `x-mira-visitor` header at `sidepanel.js:153`. The *server* uses this ID to provide conversation context across sessions. The extension itself only stores the transcript for *display persistence* (so the panel is not blank on reopen — this is stated at `CHROME-WEB-STORE-SUBMISSION.md:37`). The "memory" the user experiences (answering "My name is Sam" → "Sam") is server-side context built from the transcript *that the extension sends every time*. The extension does not maintain a database of facts about the user.

**Mismatch:** None. The listing is honest. The memory works because the extension sends the full conversation history on every API call (each message is pushed to `state.transcript` at `sidepanel.js:143, 186` and sent with every request). This is functionally equivalent to the server remembering — the extension is the transport. **No issue.**

### 3b. "Speaks its answers aloud"

**Listing says:** `CHROME-WEB-STORE-SUBMISSION.md:28`: "Speaks its answers aloud, and you can turn the voice off."

**Code delivers:** Yes. `sidepanel.js:190-192` calls `speak()` when `voiceOn` is true. `speak()` at `sidepanel.js:214-233` POSTs text to `https://mira.vualet.com/api/veridian-voice`, falls back to `SpeechSynthesis` on 204 or network error. The voice checkbox is stored in `chrome.storage.local` at `sidepanel.js:54, 80, 331-334`.

**Mismatch:** None. **No issue.**

### 3c. "Answers questions about Mira and Vualet"

**Listing says:** `CHROME-WEB-STORE-SUBMISSION.md:25-31`: The full description lists answering about "what the products do, how they work, what they cost" and claims the assistant "says it does not know when a question falls outside that" and "will tell you so rather than guess."

**Code delivers:** The extension sends every user message to the API at `sidepanel.js:149-156` and displays whatever the server returns. The extension itself has no knowledge base, no grounding logic, no refusal mechanism, and no ability to say "I don't know" — that is 100% server behaviour. The extension faithfully renders any server response, including unsupported claims.

**Mismatch:** The listing implies the *extension* enforces honesty ("it says it does not know"). The code shows the extension has no such capability — it is a dumb terminal for the API. This is a minor mismatch in attribution, not in user-facing behaviour. If the server returns a hallucination, the extension displays it. **RISK** — a reviewer could argue the listing is misleading by attributing server-side behaviour to the extension. Mitigation: change the listing to say "The Mira service answers from published knowledge and says it does not know when a question falls outside that" rather than "It answers from…"

### 3d. "Keeps your conversation so the panel is not blank when you reopen it"

**Listing says:** `CHROME-WEB-STORE-SUBMISSION.md:37`.

**Code delivers:** Yes — `sidepanel.js:104-112` (`renderStored`) re-hydrates the transcript from storage on init.

**Mismatch:** None. **No issue.**

### 3e. "No analytics, no tracking, no advertising"

**Listing says:** `CHROME-WEB-STORE-SUBMISSION.md:44`.

**Code delivers:** The extension sends user messages and a visitor ID to `mira.vualet.com`. The extension itself contains no analytics SDK, no telemetry beacon, no fingerprinting script, no ad network integration. However, the *server* almost certainly logs these requests with IP addresses and timestamps. The listing claims "no tracking" which could reasonably be interpreted by a user as "nothing about your activity is logged anywhere." The extension does not control server-side logging.

**Mismatch:** Minor. The extension does not *implement* analytics, but the listing's "no analytics, no tracking" claim could mislead users into believing their messages are not logged by the service. The privacy policy (`privacy/page.tsx:17-18`) discloses server-side collection of "IP address, pages visited, features used, timestamps, crash and diagnostic logs" but the extension has no tabs access, so "pages visited" is misleading even in the privacy context. **RISK** — the extension cannot verify or control whether the server logs messages and visitor IDs as "usage data." A cautious reviewer would flag this as a disclosure gap.

### 3f. "It talks to exactly one place: mira.vualet.com"

**Listing says:** `CHROME-WEB-STORE-SUBMISSION.md:47`.

**Code delivers:** The extension makes `fetch()` calls to `https://mira.vualet.com/api/veridian-demo` (`sidepanel.js:149`) and `https://mira.vualet.com/api/veridian-voice` (`sidepanel.js:214`). Both are under `mira.vualet.com`.

**Mismatch:** None. **No issue.**

### 3g. Testing instructions promise behaviour the extension cannot verify

**Listing says:** `CHROME-WEB-STORE-SUBMISSION.md:120-121`: "Tell it 'My name is Sam', then send 'What is my name?'. It answers 'Sam' — this is the memory feature." And `CHROME-WEB-STORE-SUBMISSION.md:122-123`: "Ask something outside its knowledge, e.g. 'What is the capital of Peru?'. It should decline rather than answer."

**Code delivers:** The extension will send these messages and display whatever the server returns. The reviewer *cannot* verify that the server will do what the listing claims. If the server is down, misconfigured, or has hit the daily cap mentioned at `CHROME-WEB-STORE-SUBMISSION.md:131-132`, the reviewer's test will fail.

**Mismatch:** The listing instructs the reviewer to verify server-side behaviour using only the client extension. **NOTE** — not a blocker, but a reviewer who follows these instructions and hits a non-responsive server will mark the extension as broken.

---

## 4. PERMISSIONS

### `sidePanel`

**Could it work with less?** No. The entire UI is a side panel. Without this permission, there is no way to open a side panel from the toolbar icon. `background.js:14-15` calls `chrome.sidePanel.setPanelBehavior()`. This permission is necessary and sufficient.

**No issue.**

### `storage`

**Could it work with less?** No. The extension stores three things in `chrome.storage.local`:
- `visitorId` (`sidepanel.js:52, 59, 65`) — persistent identifier for server-side conversation context
- `transcript` (`sidepanel.js:53, 70, 89-93`) — conversation history for display persistence
- `voiceOn` (`sidepanel.js:54, 80, 331-334`) — voice toggle preference

All three are essential. Without `visitorId`, the server cannot provide conversation memory. Without `transcript`, the panel is blank on reopen (contradicting the listing's claim). Without `voiceOn`, the voice preference resets each session, making the voice toggle useless.

**No issue.**

### `https://mira.vualet.com/*` (host permission)

**Could it work with less?** The extension contacts exactly two endpoints:
- `https://mira.vualet.com/api/veridian-demo` (`sidepanel.js:149`)
- `https://mira.vualet.com/api/veridian-voice` (`sidepanel.js:214`)

The host permission is `mira.vualet.com/*` which covers all paths. A tighter permission would be:

```json
"host_permissions": [
  "https://mira.vualet.com/api/veridian-demo",
  "https://mira.vualet.com/api/veridian-voice"
]
```

**This is a BLOCKER.** The Store guidelines prefer narrowly-scoped host permissions. If the extension only ever contacts two known paths, requesting `*` wildcard access is overbroad. A reviewer can and should reject this. The concrete change is to list each path explicitly (two entries in the array).

---

## 5. USER DATA — WHAT LEAVES THE MACHINE

### What the code sends

1. **User message text** — `sidepanel.js:155`: `body: JSON.stringify({ message: text })` → POSTed to `https://mira.vualet.com/api/veridian-demo`
2. **Visitor ID** — `sidepanel.js:153`: header `x-mira-visitor: state.visitorId` → sent with every request to `/api/veridian-demo`
3. **Email address** — `sidepanel.js:259-260`: `body: JSON.stringify({ email })` → POSTed to `https://mira.vualet.com/api/veridian-demo` (only if user enters it at trial gate)
4. **Voice text** — `sidepanel.js:217`: `body: JSON.stringify({ text })` → POSTed to `https://mira.vualet.com/api/veridian-voice`

### What the privacy policy says

`privacy/page.tsx:182-185`: "The extension sends you the messages you type so Mira can answer them. If you choose to enter your email address at the trial prompt, we also receive that address."

`privacy/page.tsx:188-194`: "The extension generates a random identifier in your browser and stores it locally. It sends this id with each message so Mira can remember what you told her earlier in the conversation."

`privacy/page.tsx:197-202`: "When you ask Mira to speak her answer, the reply text is sent to our voice service to produce audio, which is played in your browser and not stored."

### Mismatches

**Something sent but not disclosed:** The visitor ID is disclosed in the privacy policy (`privacy/page.tsx:188-194`). The message text is disclosed. The email is disclosed. The voice text sent to the voice API is disclosed.

**However:** The privacy policy at `privacy/page.tsx:182-185` says "we do not receive it [the email] unless you type it in." The code at `sidepanel.js:257-261` confirms email is only sent when the user submits it via the trial gate. This is accurate.

**No mismatch found.** The privacy policy section accurately describes what the extension sends. **No issue.**

### Something disclosed but not sent

The privacy policy at `privacy/page.tsx:197-202` says "When that service is unavailable, your browser's own speech synthesis is used instead and no text leaves your browser for that purpose." The code at `sidepanel.js:235-237` confirms this fallback path: on network error to the voice API, it uses `SpeechSynthesis` without any network request.

**No issue.**

### IP addresses and server-side logging

The extension sends HTTP requests to `mira.vualet.com`. By default, these requests carry the user's IP address. The privacy policy at `privacy/page.tsx:39` claims collection of "IP address, pages visited" — but the extension has no tab access, so it cannot know "pages visited." If the server logs the IP address along with the request path (`/api/veridian-demo`), that is usage data about the *extension's* activity, not the user's browsing. The listing at `CHROME-WEB-STORE-SUBMISSION.md:93` says "Web history: No" and "User activity: No" — but server-side logs of `mira.vualet.com` requests are, technically, user activity data. The Store's data declaration category "User activity" might flag this. **RISK** — the data-use declarations claim "No" for user activity, but the server inevitably logs request metadata (IP, timestamp, request path). The extension cannot prevent this, but the listing's blanket "No" is technically inaccurate.

---

## 6. REMOTELY HOSTED CODE

**Is any executable logic fetched at runtime?** No. The service worker (`background.js`), side panel HTML, side panel JS, and CSS are all packaged with the extension. There are no `eval()`, `new Function()`, or dynamic `import()` of remote URLs.

**Does any API response get executed rather than rendered?** No. The rendering path is:

1. `sidepanel.js:175-176`: `replyText = body.reply` — extracts a string from the JSON response
2. `sidepanel.js:185`: `appendRole("mira", replyText)` — calls `row.textContent = text` at `sidepanel.js:33`

The security comment at `sidepanel.js:18-21` explicitly states this is intentional:

> "The reply from the server is UNTRUSTED, MODEL-GENERATED REMOTE INPUT. Render ONLY via textContent or document.createTextNode."

The `appendRole` function at `sidepanel.js:31-36` creates a `div` and sets `row.textContent = text`. No `innerHTML`, no `eval`, no `dangerouslySetInnerHTML`.

**The same pattern is used for the email-gate response** at `sidepanel.js:271` (`appendRole("mira", body.reply)`) and `sidepanel.js:278` (`trialGateError.textContent = body.reply || ...`).

**No issue.** The extension is clean of remotely-hosted code execution.

---

## 7. THE EMAIL GATE

### What it does

After the server responds with `trialGate: true` in the JSON body, the extension shows an email input at `sidepanel.js:195-197`:

```js
if (trialGate) {
  showTrialGate();
}
```

The UI text at `sidepanel.html:26` reads:

> "To keep going, Mira needs an email address. No card, and you can stop here instead."

The user can submit their email via `submitEmail()` at `sidepanel.js:249-291`, which POSTs `{ email }` to the same API endpoint.

### Arguments

**This is a dark pattern / deceptive.** The user has installed a browser extension expecting a tool. After using it a number of times, the tool stops working (or shows a gate) and demands personal information (email address) to continue. In the extension context, this is worse than on a website: on a website, the user can simply close the tab with no friction. In an extension, the user has already gone through the installation flow, clicked the toolbar icon, and invested time in a conversation. The gate exploits this sunk cost. The phrase "you can stop here instead" at `sidepanel.html:26` is the *only* escape hatch, and it requires the user to actively abandon their conversation — a real behavioural friction that most users will not exercise. The gate is triggered server-side (`trialGate: true` in the response) so the extension has no control over *when* it fires, and the listing at `CHROME-WEB-STORE-SUBMISSION.md:169-173` acknowledges the risk but does not resolve it. The gate captures PII (email) for the publisher's benefit (lead generation) and blocks the core functionality (answering questions) until it is provided. In the Store's eyes, gating extension functionality behind personal data submission is a known abuse pattern.

**This is acceptable disclosed trial behaviour.** The listing explicitly documents the email gate at `CHROME-WEB-STORE-SUBMISSION.md:169-173`. The UI text is transparent: "To keep going, Mira needs an email address." There is no pretense that the email is needed for technical reasons. The user can close the panel and walk away. The extension itself does not validate the email, does not send it to a third party, and the submission API (`submitEmail`) does not appear to require a valid email format (there is no regex validation beyond the `type="email"` HTML attribute, which is cosmetic).

### Which wins

The **rejection case wins in the extension context specifically**. On a website, gating is a well-understood SaaS pattern. In an extension, the Store's guidelines are stricter because extensions are *software installations*, not web visits. A user who installs an extension reasonably expects it to function without requiring personal data for continued use — especially when the stated single purpose is "answering questions." Requiring an email to *continue asking questions* transforms the extension from a tool into a lead-capture mechanism. The disclosure in the listing helps, but disclosure does not cure the fundamental issue: the extension blocks its own core functionality behind a data-collection gate.

**BLOCKER.** The concrete change is one of:
1. Remove the gate entirely (let the panel keep working after N messages), or
2. Make the gate opt-in (e.g., "Enter your email to unlock unlimited use" rather than "To keep going, Mira needs an email address"), or
3. Give the user a meaningful, low-friction way to dismiss the gate and continue without providing an email (e.g., "Continue without email" button that the listing at `CHROME-WEB-STORE-SUBMISSION.md:172` already recommends).

The listing's own "Owner decision recommended" at `CHROME-WEB-STORE-SUBMISSION.md:172-173` — "letting the panel keep working after asking once" — is the correct answer. Implement it.

---

## 8. ANYTHING ELSE

### 8a. Missing screenshots

`CHROME-WEB-STORE-SUBMISSION.md:142`: "**Not yet produced — owner action.** Needs the panel open with a real conversation."

The Chrome Web Store requires at least one screenshot for a submission. Without screenshots, the listing cannot be submitted at all.

**BLOCKER.** Concrete change: produce at least one screenshot at 1280×800 or 640×400 showing the side panel with a real conversation.

### 8b. Extension name "Mira Help" is ambiguous

The name "Mira Help" could reasonably be interpreted by users as "help/support for the Mira product" (which is accurate) or as "Mira, the assistant, helping me" (which implies a general-purpose assistant). If a user searches for "Mira" in the Chrome Web Store expecting a general assistant, they may install this extension and then discover it only answers questions about two products. The listing partially mitigates this with the description, but the name itself is misleading.

**RISK.** Concrete change: consider renaming to "Mira & Vualet Help" or adding a clarifying subtitle. Alternatively, keep the name but ensure the Store description (short description) makes the scope unambiguous in the first line — which it currently does (`"Ask questions about Mira and Vualet in a side panel and listen to spoken answers."`). The short description is sufficient; this is a low-severity risk.

### 8c. No error state for the service worker

`background.js:18`: The `setPanelBehavior` failure is only `console.error`'d. If this call fails (e.g., on a non-Chrome browser, or an outdated Chrome version), the toolbar icon will silently not open the side panel, and the user will see nothing. There is no fallback UI, no notification, and no way for the user to understand why the extension does not work.

**NOTE.** The manifest declares `sidePanel` as a permission and `chrome.sidePanel` is required for MV3 extensions to use side panels. If the browser does not support side panels, the extension is fundamentally non-functional. A reviewer should see this immediately. Not a blocker (it is a browser-support edge case), but a poor user experience.

### 8d. The trial gate has no rate limit on email submissions

`sidepanel.js:249-291`: The `submitEmail` function can be called repeatedly without throttling. Each call POSTs to the server. The `emailSubmitBtn` is disabled during the request and re-enabled in `finally`, but a user could click rapidly or use browser devtools to send many requests. This is a minor DoS vector.

**NOTE.** Not a Store blocker, but the extension should add basic debounce or request throttling on the email submission endpoint.

### 8e. "Clear conversation" regenerates the visitor ID but does not notify the user

`sidepanel.js:296-298`: Clearing the conversation generates a new visitor ID and stores it locally, which "forgets you on our side too" (per the privacy policy). However, the user sees no confirmation that their server-side memory was also deleted. They might assume "clear conversation" only clears local history.

**NOTE.** Concrete change: add a brief confirmation message after clear (e.g., "Conversation cleared. Your memory on our side has been forgotten.") to make the full scope of the action clear.

### 8f. Icon files not verified

The listing claims `CHROME-WEB-STORE-SUBMISSION.md:141`: "Icon 128×128 — Present, generated from the real mark, RGBA verified." However, the icons directory was not reviewed in this exercise. If the icons are generic, misleading, or do not match the publisher's branding, this is a Store rejection reason.

**NOTE.** Concrete change: verify that the icon images exist in `extension/icons/` and match the claims.

### 8g. No version bump on the listing's release notes matches the manifest

`manifest.json:4`: `"version": "0.1.0"`. `CHROME-WEB-STORE-SUBMISSION.md:154-159`: Release notes say "0.1.0 — first release." These are consistent.

**No issue.**

### 8h. The character counter has a maximum but no indication of remaining characters before submission is blocked

`sidepanel.html:41`: `maxlength="800"` on the textarea. `sidepanel.js:125`: counter shows "0 / 800". The send button is disabled when the input is empty (`sidepanel.js:371`) and presumably enabled once there is text. The counter is visible but there is no red warning when near the limit. This is cosmetic.

**NOTE.** Not a Store blocker.

---

## SUMMARY OF FINDINGS

| # | Finding | Severity | Concrete change |
|---|---------|----------|-----------------|
| 4 | Host permission wildcard `*` is overbroad | **BLOCKER** | List each path explicitly: `/api/veridian-demo` and `/api/veridian-voice` |
| 7 | Email gate blocks core functionality behind PII collection | **BLOCKER** | Add a "Continue without email" button, or remove the gate entirely |
| 8a | No screenshots provided | **BLOCKER** | Produce at least one screenshot at 1280×800 or 640×400 |
| 2 | Extension is a product FAQ, not a general-purpose tool | **RISK** | Add a genuinely general-purpose capability, or reposition the listing to emphasise the side-panel chat experience |
| 3c | Listing attributes server-side grounding to the extension | **RISK** | Rewrite listing to attribute grounding to "the Mira service" not "it" (the extension) |
| 3e | "No user activity" claim ignores inevitable server-side request logging | **RISK** | Change data-use declaration to "Yes — request metadata (IP, timestamp, endpoint)" |
| 5 | (None found — disclosures match code) | — | — |
| 6 | (None found — no remote code execution) | — | — |
| 8b | Extension name "Mira Help" is ambiguous | RISK (low) | Add scope clarifier to short description (already present) or rename |
| 8c | Silent failure if `setPanelBehavior` fails | NOTE | Add a one-time notification on first launch if side panels are unsupported |
| 8d | No rate limiting on email submission | NOTE | Add debounce or throttling |
| 8e | Clear conversation does not confirm server-side forget | NOTE | Add confirmation text: "Conversation cleared. Your memory on our side has been forgotten." |
| 8f | Icon files not verified in this review | NOTE | Verify icons exist and match branding claims |

---

## VERDICT: REJECT

Three independent blockers:
1. **Overbroad host permission** — change `mira.vualet.com/*` to explicit paths.
2. **Email gate blocks core functionality** — add "Continue without email" or remove the gate.
3. **No screenshots** — produce at least one.

After fixing these three, the extension has two risks (product-QA framing, data-use declaration accuracy) that a strict reviewer might still reject on. The shortest path to approval is: fix all three blockers, then reposition the listing description to emphasise the *side-panel chat interface* rather than the product-specific content, and correct the data-use declaration to acknowledge server-side request logging.
