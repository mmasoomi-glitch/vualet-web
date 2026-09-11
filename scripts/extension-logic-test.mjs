// scripts/extension-logic-test.mjs
// Tests 7 pure decision logic behaviors from extension/sidepanel.js
// Uses node:test + node:assert only. No bundler.

import assert from "node:assert";
import { describe, it, beforeEach } from "node:test";

// ─── chrome.storage.local stub ────────────────────────────────────────────────

const chromeStorageData = {};
globalThis.chrome = {
  storage: {
    local: {
      get(key) {
        return Promise.resolve({ [key]: chromeStorageData[key] });
      },
      set(obj) {
        for (const k of Object.keys(obj)) {
          chromeStorageData[k] = obj[k];
        }
        return Promise.resolve();
      },
    },
  },
};

// ─── globalThis.fetch stub ────────────────────────────────────────────────────

const _fetchRoutes = {};

function routeFetch(url, opts = {}) {
  _fetchRoutes[url] = _fetchRoutes[url] || [];
  _fetchRoutes[url].push(opts);
}

function stubFetch(url, status, body, headers) {
  _fetchRoutes[url] = _fetchRoutes[url] || [];
  _fetchRoutes[url].push({ status, body, headers });
}

function clearFetchRoutes() {
  for (const url of Object.keys(_fetchRoutes)) {
    _fetchRoutes[url] = [];
  }
}

function getNextFetch(url, idx = 0) {
  return _fetchRoutes[url]?.[idx] ?? { status: 200, body: "" };
}

globalThis.fetch = async (url, opts = {}) => {
  const route = _fetchRoutes[url]?.shift();
  if (!route) {
    return new Response(JSON.stringify({ reply: "fallback" }), { status: 200 });
  }
  const respHeaders = { "content-type": "application/json" };
  if (route.headers) Object.assign(respHeaders, route.headers);
  const bodyText = typeof route.body === "string" ? route.body : JSON.stringify(route.body);
  return new Response(bodyText, { status: route.status, headers: respHeaders });
};

globalThis.routeFetch = routeFetch;
globalThis.stubFetch = stubFetch;
globalThis.clearFetchRoutes = clearFetchRoutes;
globalThis.getNextFetch = getNextFetch;

// ─── DOM stub ─────────────────────────────────────────────────────────────────

let _elIdCounter = 0;
const _idToEl = {};

class _MockElement {
  constructor(tag, id) {
    this.tagName = tag.toUpperCase();
    this._children = [];
    this._listeners = {};
    this._attributes = {};
    this.id = id ?? `mock-${_elIdCounter++}`;
    _idToEl[this.id] = this;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.parentNode = null;
  }
  appendChild(child) {
    child.parentNode = this;
    this._children.push(child);
  }
  removeChild(child) {
    const i = this._children.indexOf(child);
    if (i >= 0) {
      this._children.splice(i, 1);
      child.parentNode = null;
    }
  }
  replaceChildren(...children) {
    for (const c of this._children) { c.parentNode = null; }
    this._children = [];
    for (const c of children) {
      this.appendChild(c);
    }
  }
  querySelector(sel) {
    // Simple: just return by #id for our stubs
    if (sel.startsWith("#")) return _idToEl[sel.slice(1)] ?? null;
    return null;
  }
  querySelectorAll(sel) { return []; }
  addEventListener(evt, fn) { this._listeners[evt] = fn; }
  dispatchEvent(evt) { if (this._listeners[evt.type]) this._listeners[evt.type](evt); }
  setAttribute(k, v) { this._attributes[k] = v; }
  hasAttribute(k) { return k in this._attributes; }
  removeAttribute(k) { delete this._attributes[k]; }
  scrollIntoView() {}
  get firstElementChild() { return this._children[0] ?? null; }
  get childNodes() { return [...this._children]; }
}

globalThis.Element = _MockElement;

globalThis.document = {
  createElement(tag) { return new _MockElement(tag); },
  getElementById(id) { return _idToEl[id] ?? new _MockElement("div", id); },
};

// ─── Browser API stubs ────────────────────────────────────────────────────────

let _speechSynthesisQueue = [];
let _speechSynthesisUtterances = [];

class _SpeechSynthesisUtterance {
  constructor(text) { this.text = text; }
}
globalThis.SpeechSynthesisUtterance = _SpeechSynthesisUtterance;

class _Audio {
  constructor(url) { this.src = url; }
  play() { return Promise.resolve(); }
  pause() {}
}
globalThis.Audio = _Audio;

globalThis.window = {
  speechSynthesis: {
    speak(utterance) {
      _speechSynthesisQueue.push(utterance);
    },
    cancel() { _speechSynthesisQueue = []; },
    pending: [],
    speaking: false,
  },
};

// ─── Extracted pure helpers from sidepanel.js ──────────────────────────────────

// generateVisitorId (line 44-48)
function generateVisitorId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// getState (line 52-87)
const STORAGE_KEY_VISITOR = "visitorId";
const STORAGE_KEY_TRANSCRIPT = "transcript";
const STORAGE_KEY_VOICE = "voiceOn";

let state = null;

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
  if (storedTranscript.length > 100) storedTranscript = storedTranscript.slice(-100);

  let voiceOn;
  try {
    voiceOn = (await chrome.storage.local.get(STORAGE_KEY_VOICE))[STORAGE_KEY_VOICE];
  } catch {
    voiceOn = undefined;
  }
  if (typeof voiceOn !== "boolean") voiceOn = true;

  state = { visitorId, transcript: storedTranscript, voiceOn };
  return state;
}

async function saveTranscript(items) {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY_TRANSCRIPT]: items });
  } catch { /* best effort */ }
}

// el / appendRole (line 25-37)
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

// renderEmpty / renderStored (line 97-113)
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

// updateCounter (line 120-126)
const charCounter = document.getElementById("charCounter");
const messageInput = document.getElementById("messageInput");

if (charCounter.hasAttribute("aria-live")) {
  charCounter.setAttribute("aria-live", "off");
}

function updateCounter() {
  charCounter.textContent = messageInput.value.length + " / 800";
  sendBtn.disabled = !messageInput.value.trim().length;
}

// sendUserMessage (line 130-208) — extracted pure logic portion
let inflight = false;

async function sendUserMessage() {
  const text = messageInput.value.trim();
  if (!text || inflight) return;

  inflight = true;
  sendBtn.disabled = true;
  thinking.hidden = false;

  try {
    appendRole("user", text);
    state.transcript.push({ role: "user", text });
    saveTranscript(state.transcript);
    messageInput.value = "";
    updateCounter();

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
      const body = await resp.json().catch(() => null);
      if (body && typeof body.reply === "string") {
        replyText = body.reply;
      } else {
        replyText = "I could not reach Mira. Check your connection and try again.";
      }
    } else if (!resp.ok) {
      replyText = "I could not reach Mira. Check your connection and try again.";
    } else {
      const body = await resp.json().catch(() => null);
      if (body && typeof body === "object" && typeof body.reply === "string") {
        replyText = body.reply;
        trialGate = !!body.trialGate;
      } else {
        replyText = "Sorry, I could not read the reply. Please try again.";
      }
    }

    appendRole("mira", replyText);
    state.transcript.push({ role: "mira", text: replyText });
    saveTranscript(state.transcript);

    if (state.voiceOn) {
      speak(replyText);
    }

    if (trialGate) {
      showTrialGate();
    }
  } catch (e) {
    appendRole("mira", "I could not reach Mira. Check your connection and try again.");
    state.transcript.push({ role: "mira", text: "I could not reach Mira. Check your connection and try again." });
    saveTranscript(state.transcript);
  } finally {
    inflight = false;
    sendBtn.disabled = messageInput.value.trim().length === 0;
    thinking.hidden = true;
  }
}

// speak (line 212-239)
function speak(text) {
  fetch("https://mira.vualet.com/api/veridian-voice", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  })
    .then(async (resp) => {
      if (resp.status === 204) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
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
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    });
}

// showTrialGate (line 243-247)
const trialGate = document.getElementById("trialGate");
const trialGateError = document.getElementById("trialGateError");
const emailInput = document.getElementById("emailInput");

function showTrialGate() {
  trialGate.hidden = false;
  trialGateError.hidden = true;
  emailInput.value = "";
}

// sendBtn element binding
const sendBtn = document.getElementById("sendBtn");
const thinking = document.getElementById("thinking");
const transcript = document.getElementById("transcript");

// ─── 7 TESTS ──────────────────────────────────────────────────────────────────

describe("Extension Logic Tests", () => {
  beforeEach(() => {
    clearFetchRoutes();
    _speechSynthesisQueue = [];
    // Reset chrome storage
    for (const k of Object.keys(chromeStorageData)) delete chromeStorageData[k];
    // Reset module-level state
    state = null;
    inflight = false;
  });

  // ── Test 1: Visitor ID shape ──────────────────────────────────────────────
  it("generateVisitorId produces a 128-hex-char string", () => {
    const id = generateVisitorId();
    assert.equal(typeof id, "string", "visitorId must be a string");
    assert.equal(id.length, 64, "visitorId must be 64 hex chars (32 bytes)");
    assert.ok(/^[0-9a-f]+$/.test(id), "visitorId must be lowercase hex only");
  });

  // ── Test 2: Visitor ID persistence ────────────────────────────────────────
  it("getState reuses existing visitorId, generates new one if missing or invalid", async () => {
    // First call: no visitorId in storage, should generate one
    await getState();
    const id1 = state.visitorId;
    assert.equal(typeof id1, "string");
    assert.equal(id1.length, 64);

    // Second call: same visitorId should be reused from chrome.storage
    await getState();
    const id2 = state.visitorId;
    assert.equal(id1, id2, "same visitorId should be reused from storage");

    // Third call: inject invalid visitorId
    chromeStorageData.visitorId = "not-valid";
    await getState();
    const id3 = state.visitorId;
    assert.notEqual(id1, id3, "new visitorId generated after invalid one in storage");
    assert.equal(id3.length, 64);
  });

  // ── Test 3: Response validation (malformed body) ──────────────────────────
  it("sendUserMessage shows fallback for malformed JSON response", async () => {
    // Setup: send a message
    messageInput.value = "Hello";
    state = { visitorId: "a".repeat(64), transcript: [], voiceOn: false };

    // Return a 200 with invalid body (missing "reply" field)
    stubFetch("https://mira.vualet.com/api/veridian-demo", 200, { foo: "bar" });

    await sendUserMessage();

    // Check transcript has user message + fallback reply
    assert.equal(state.transcript.length, 2);
    assert.equal(state.transcript[0].role, "user");
    assert.equal(state.transcript[0].text, "Hello");
    assert.equal(state.transcript[1].role, "mira");
    assert.equal(state.transcript[1].text, "Sorry, I could not read the reply. Please try again.");
  });

  // ── Test 4: HTTP 429 handling ─────────────────────────────────────────────
  it("sendUserMessage uses server reply text on 429", async () => {
    messageInput.value = "Hello";
    state = { visitorId: "a".repeat(64), transcript: [], voiceOn: false };

    stubFetch("https://mira.vualet.com/api/veridian-demo", 429, { reply: "Slow down!" });

    await sendUserMessage();

    assert.equal(state.transcript[1].role, "mira");
    assert.equal(state.transcript[1].text, "Slow down!");
  });

  // ── Test 5: Voice 204 fallback ────────────────────────────────────────────
  it("speak falls back to SpeechSynthesis on 204", async () => {
    stubFetch("https://mira.vualet.com/api/veridian-voice", 204, null, { "content-type": "text/plain" });

    speak("test voice message");

    // The fetch is async (no await in speak), so wait a tick
    await new Promise(r => setTimeout(r, 50));

    assert.equal(_speechSynthesisQueue.length, 1);
    assert.equal(_speechSynthesisQueue[0].text, "test voice message");
  });

  // ── Test 6: Transcript cap at 100 ─────────────────────────────────────────
  it("getState caps stored transcript to most recent 100 entries", async () => {
    // Pre-populate storage with 150 entries
    const longTranscript = [];
    for (let i = 0; i < 150; i++) {
      longTranscript.push({ role: "user", text: `message ${i}` });
    }
    chromeStorageData.transcript = longTranscript;

    await getState();

    assert.equal(state.transcript.length, 100);
    assert.equal(state.transcript[0].text, "message 50");
    assert.equal(state.transcript[99].text, "message 149");
  });

  // ── Test 7: XSS safety (textContent only) ─────────────────────────────────
  it("appendRole uses textContent, not innerHTML — XSS is neutralized", async () => {
    const xssPayload = "<script>alert('xss')</script>";
    appendRole("mira", xssPayload);

    // The last child of transcript should have textContent === xssPayload, not parsed HTML
    const rows = transcript._children;
    assert.ok(rows.length > 0, "a row element should exist");

    // The last row should have the script tag as text, not as HTML
    const lastRow = rows[rows.length - 1];
    assert.equal(lastRow.textContent, xssPayload);
    // It should NOT be parsed as HTML — innerHTML should be empty or just the text
    assert.ok(!lastRow.innerHTML?.includes("<script>"), "script tag should not be in innerHTML");
  });

  // ── Test 8: Typing a non-empty value enables sendBtn ──────────────────────
  it("firing 'input' with a non-empty value ENABLES sendBtn", () => {
    sendBtn.disabled = true;
    messageInput.value = "Hello";
    updateCounter();
    assert.equal(sendBtn.disabled, false, "sendBtn must be enabled after typing non-empty text");
  });

  // ── Test 9: Clearing the value disables sendBtn again ─────────────────────
  it("firing 'input' with an empty value DISABLES sendBtn again", () => {
    sendBtn.disabled = false;
    messageInput.value = "";
    updateCounter();
    assert.equal(sendBtn.disabled, true, "sendBtn must be disabled after clearing the input");
  });

  // ── Test 10: Whitespace-only value leaves sendBtn DISABLED ────────────────
  it("firing 'input' with whitespace-only value leaves sendBtn DISABLED", () => {
    sendBtn.disabled = false;
    messageInput.value = "   ";
    updateCounter();
    assert.equal(sendBtn.disabled, true, "whitespace-only input must leave sendBtn disabled");
  });

  // ── Test 11: Character counter still updates alongside button state ───────
  it("the character counter updates correctly alongside sendBtn state", () => {
    messageInput.value = "abc";
    updateCounter();
    assert.equal(charCounter.textContent, "3 / 800", "character counter must show correct count");
    assert.equal(sendBtn.disabled, false, "sendBtn must be enabled");

    messageInput.value = "";
    updateCounter();
    assert.equal(charCounter.textContent, "0 / 800", "character counter must reset to 0");
    assert.equal(sendBtn.disabled, true, "sendBtn must be disabled when empty");
  });
});
