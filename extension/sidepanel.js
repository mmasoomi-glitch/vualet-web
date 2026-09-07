// extension/sidepanel.js — Single ES module loaded via <script type="module" src="./sidepanel.js">.
// No bundler, no framework, no dependencies. Plain browser API only.

// ─── ELEMENT BINDINGS ────────────────────────────────────────────────────────

const transcript    = document.getElementById("transcript");
const messageInput  = document.getElementById("messageInput");
const sendBtn       = document.getElementById("sendBtn");
const charCounter   = document.getElementById("charCounter");
const thinking      = document.getElementById("thinking");
const voiceCheckbox = document.getElementById("voiceCheckbox");
const clearBtn      = document.getElementById("clearBtn");
const trialGate     = document.getElementById("trialGate");
const emailInput    = document.getElementById("emailInput");
const emailSubmitBtn= document.getElementById("emailSubmitBtn");
const trialGateError= document.getElementById("trialGateError");

// ─── SECURITY: NEVER use innerHTML / insertAdjacentHTML / outerHTML on server data ──
// The reply from the server is UNTRUSTED, MODEL-GENERATED REMOTE INPUT.
// Render ONLY via textContent or document.createTextNode. This is the single
// most important rule in this file.

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function el(tag, cls) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  return d;
}

function appendRole(role, text) {
  const row = el("div", "msg " + role);
  row.textContent = text;
  transcript.appendChild(row);
  row.scrollIntoView({ behavior: "smooth", block: "end" });
  return row;
}

// ─── VISITOR ID ──────────────────────────────────────────────────────────────
// Bearer capability: whoever holds this ID can read this visitor's memory.
// It is random (never derived from user/machine) precisely because it is a key,
// not an identifier tied to a person.

function generateVisitorId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// ─── STATE (chrome.storage.local only) ───────────────────────────────────────

const STORAGE_KEY_VISITOR  = "visitorId";
const STORAGE_KEY_TRANSCRIPT = "transcript";
const STORAGE_KEY_VOICE    = "voiceOn";

async function getState() {
  let visitorId;
  try {
    visitorId = (await chrome.storage.local.get(STORAGE_KEY_VISITOR))[STORAGE_KEY_VISITOR];
  } catch {
    visitorId = undefined;
  }
  if (!visitorId || !/^[0-9a-f]{64}$/.test(visitorId)) {
    visitorId = generateVisitorId();
    await chrome.storage.local.set({ [STORAGE_KEY_VISITOR]: visitorId });
  }

  let storedTranscript;
  try {
    storedTranscript = (await chrome.storage.local.get(STORAGE_KEY_TRANSCRIPT))[STORAGE_KEY_TRANSCRIPT];
  } catch {
    storedTranscript = undefined;
  }
  if (!Array.isArray(storedTranscript)) storedTranscript = [];
  // Cap to most recent 100 entries
  if (storedTranscript.length > 100) storedTranscript = storedTranscript.slice(-100);

  let voiceOn;
  try {
    voiceOn = (await chrome.storage.local.get(STORAGE_KEY_VOICE))[STORAGE_KEY_VOICE];
  } catch {
    voiceOn = undefined;
  }
  if (typeof voiceOn !== "boolean") voiceOn = true;

  return { visitorId, transcript: storedTranscript, voiceOn };
}

async function saveTranscript(items) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_TRANSCRIPT]: items });
  } catch { /* best effort — storage failure does not block the UI */ }
}

// ─── RENDER ──────────────────────────────────────────────────────────────────

const EMPTY_STATE = "Ask me about Mira or Vualet — this panel answers questions about Mira and Vualet.";

function renderEmpty() {
  transcript.replaceChildren();
  appendRole("mira", EMPTY_STATE);
}

function renderStored() {
  transcript.replaceChildren();
  if (state.transcript.length === 0) {
    renderEmpty();
  } else {
    for (const m of state.transcript) {
      appendRole(m.role, m.text);
    }
  }
}

// ─── CHARACTER COUNTER ───────────────────────────────────────────────────────
// IMPORTANT: Do NOT make this an assertive/polite live announcement on every
// keystroke — announcing a number on every character typed makes the panel
// unusable with a screen reader. Disable aria-live if the markup carries it.

if (charCounter.hasAttribute("aria-live")) {
  charCounter.setAttribute("aria-live", "off");
}

function updateCounter() {
  charCounter.textContent = messageInput.value.length + " / 800";
}

// ─── SEND MESSAGE ────────────────────────────────────────────────────────────

let inflight = false;

async function sendUserMessage() {
  const text = messageInput.value.trim();
  if (!text || inflight) return;

  inflight = true;
  sendBtn.disabled = true;
  thinking.hidden = false;

  try {
    // Append user message immediately
    appendRole("user", text);
    state.transcript.push({ role: "user", text });
    saveTranscript(state.transcript);
    messageInput.value = "";
    updateCounter();

    // Call the API
    const resp = await fetch("https://mira.vualet.com/api/veridian-demo", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-mira-visitor": state.visitorId,
      },
      body: JSON.stringify({ message: text }),
    });

    let replyText;
    let trialGate = false;

    if (resp.status === 429) {
      // 429 -> body { "reply": string }. Display THAT text.
      const body = await resp.json().catch(() => null);
      if (body && typeof body.reply === "string") {
        replyText = body.reply;
      } else {
        replyText = "I could not reach Mira. Check your connection and try again.";
      }
    } else if (!resp.ok) {
      replyText = "I could not reach Mira. Check your connection and try again.";
    } else {
      // 200
      const body = await resp.json().catch(() => null);
      // Validate response shape: must be an object with a string "reply" field
      if (body && typeof body === "object" && typeof body.reply === "string") {
        replyText = body.reply;
        trialGate = !!body.trialGate;
      } else {
        // Malformed body
        replyText = "Sorry, I could not read the reply. Please try again.";
      }
    }

    // Render reply via textContent ONLY — server data is untrusted
    appendRole("mira", replyText);
    state.transcript.push({ role: "mira", text: replyText });
    saveTranscript(state.transcript);

    // Speak if voiceOn
    if (state.voiceOn) {
      speak(replyText);
    }

    // Trial gate
    if (trialGate) {
      showTrialGate();
    }
  } catch (e) {
    // Network failure or any unexpected error
    appendRole("mira", "I could not reach Mira. Check your connection and try again.");
    state.transcript.push({ role: "mira", text: "I could not reach Mira. Check your connection and try again." });
    saveTranscript(state.transcript);
  } finally {
    inflight = false;
    sendBtn.disabled = messageInput.value.trim().length === 0;
    thinking.hidden = true;
  }
}

// ─── VOICE ───────────────────────────────────────────────────────────────────

function speak(text) {
  // POST to veridian-voice, fall back to SpeechSynthesis on 204
  fetch("https://mira.vualet.com/api/veridian-voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  })
    .then(async (resp) => {
      if (resp.status === 204) {
        // 204 NO CONTENT is NORMAL, not an error. Fall back to speechSynthesis.
        window.speechSynthesis.speak(
          new SpeechSynthesisUtterance(text)
        );
        return;
      }
      if (!resp.ok) return;
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      audio.play().catch(() => URL.revokeObjectURL(url));
    })
    .catch(() => {
      // Network failure during voice — fall back gracefully
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    });
}

// ─── TRIAL GATE ──────────────────────────────────────────────────────────────

function showTrialGate() {
  trialGate.hidden = false;
  trialGateError.hidden = true;
  emailInput.value = "";
}

async function submitEmail() {
  const email = emailInput.value.trim();
  if (!email) return;

  emailSubmitBtn.disabled = true;
  trialGateError.hidden = true;

  try {
    const resp = await fetch("https://mira.vualet.com/api/veridian-demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const body = await resp.json().catch(() => null);

    if (body && typeof body === "object" && typeof body.ok === "boolean") {
      if (body.ok) {
        // Hide gate and show the reply
        trialGate.hidden = true;
        trialGateError.hidden = true;
        if (typeof body.reply === "string") {
          appendRole("mira", body.reply);
          state.transcript.push({ role: "mira", text: body.reply });
          saveTranscript(state.transcript);
          if (state.voiceOn) speak(body.reply);
        }
      } else {
        // ok: false — show server's reply text in trialGateError
        trialGateError.textContent = body.reply || "Something went wrong. Please try again.";
        trialGateError.hidden = false;
      }
    } else {
      trialGateError.textContent = "Sorry, I could not read the reply. Please try again.";
      trialGateError.hidden = false;
    }
  } catch {
    trialGateError.textContent = "I could not reach Mira. Check your connection and try again.";
    trialGateError.hidden = false;
  } finally {
    emailSubmitBtn.disabled = false;
  }
}

// ─── CLEAR ───────────────────────────────────────────────────────────────────

function clearAll() {
  // Regenerate visitorId so server-side memory is no longer reachable
  state.visitorId = generateVisitorId();
  chrome.storage.local.set({ [STORAGE_KEY_VISITOR]: state.visitorId });

  // Empty transcript
  state.transcript = [];
  chrome.storage.local.set({ [STORAGE_KEY_TRANSCRIPT]: [] });

  // Re-render empty state
  renderEmpty();
  trialGate.hidden = true;
  trialGateError.hidden = true;
}

// ─── EVENT LISTENERS ─────────────────────────────────────────────────────────

// Character counter
messageInput.addEventListener("input", updateCounter);

// Send on click
sendBtn.addEventListener("click", sendUserMessage);

// Send on Enter; Shift+Enter inserts newline
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (e.shiftKey) {
      // Shift+Enter: insert newline (let default behavior handle it)
      return;
    }
    e.preventDefault();
    sendUserMessage();
  }
});

// Voice toggle
voiceCheckbox.addEventListener("change", () => {
  state.voiceOn = voiceCheckbox.checked;
  chrome.storage.local.set({ [STORAGE_KEY_VOICE]: state.voiceOn });
});

// Clear
clearBtn.addEventListener("click", clearAll);

// Email submit
emailSubmitBtn.addEventListener("click", submitEmail);

emailInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    submitEmail();
  }
});

// ─── INIT ────────────────────────────────────────────────────────────────────

let state = null; // populated below

async function init() {
  // Ensure hidden states are consistent on load
  thinking.hidden = true;
  trialGate.hidden = true;
  trialGateError.hidden = true;

  state = await getState();

  // Restore voice checkbox state
  voiceCheckbox.checked = state.voiceOn;

  // Render stored transcript (or empty state)
  renderStored();

  // Update counter
  updateCounter();

  // Initial button state
  sendBtn.disabled = messageInput.value.trim().length === 0;
}

init();
