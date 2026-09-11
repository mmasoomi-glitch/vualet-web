/**
 * Standalone tests for the LLM provider resolver logic.
 *
 * These tests exercise the same logic as `resolveLlmProvider` in
 * `src/app/api/veridian-demo/route.ts` without importing the route module,
 * so they work with zero dependencies — no `node_modules` or `next/server.js`
 * required.
 */
import { test } from "node:test";
import { equal, strictEqual } from "node:assert";

// ── The resolver logic (mirrors src/app/api/veridian-demo/route.ts) ──────────

const DEFAULT_MODEL = "openai/gpt-4o-mini";

function resolveLlmProvider(env, {
  MIRA_LLM_BASE_URL = "",
  MIRA_LLM_MODEL = DEFAULT_MODEL,
  MIRA_LLM_API_KEY = "",
  OPENROUTER_API_KEY = "",
} = {}) {
  const baseUrl = env.MIRA_LLM_BASE_URL ?? "";
  const model = env.MIRA_LLM_MODEL ?? DEFAULT_MODEL;
  const apiKey = env.MIRA_LLM_API_KEY ?? "";

  if (!baseUrl) {
    const key = env.OPENROUTER_API_KEY ?? OPENROUTER_API_KEY ?? "";
    return {
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      model: model || DEFAULT_MODEL,
      headers: {
        "Content-Type": "application/json",
        "HTTP-Referer": "https://mira.vualet.com",
        "X-Title": "Mira",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
    };
  }

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const fullUrl = normalizedBase + "/chat/completions";

  return {
    baseUrl: fullUrl,
    model,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  };
}

// ── Cases ──────────────────────────────────────────────────────────────────

test("no MIRA_LLM_BASE_URL -> falls back to OpenRouter defaults", () => {
  const r = resolveLlmProvider({});

  equal(r.baseUrl, "https://openrouter.ai/api/v1/chat/completions");
  equal(r.model, "openai/gpt-4o-mini");
  equal(r.headers["HTTP-Referer"], "https://mira.vualet.com");
  equal(r.headers["X-Title"], "Mira");
  strictEqual(r.headers["Authorization"], undefined);
});

test("custom baseUrl + model -> uses them and skips OpenRouter-only headers", () => {
  const r = resolveLlmProvider({
    MIRA_LLM_BASE_URL: "https://wii5y4dr0nvh3l-8000.proxy.runpod.net/v1",
    MIRA_LLM_MODEL: "qwen3-coder",
  });

  equal(r.baseUrl, "https://wii5y4dr0nvh3l-8000.proxy.runpod.net/v1/chat/completions");
  equal(r.model, "qwen3-coder");
  equal(r.headers["HTTP-Referer"], undefined);
  equal(r.headers["X-Title"], undefined);
  strictEqual(r.headers["Authorization"], undefined);
});

test("empty MIRA_LLM_API_KEY -> no Authorization header", () => {
  const r = resolveLlmProvider({
    MIRA_LLM_BASE_URL: "https://wii5y4dr0nvh3l-8000.proxy.runpod.net/v1",
    MIRA_LLM_MODEL: "qwen3-coder",
    MIRA_LLM_API_KEY: "",
  });

  strictEqual(r.headers["Content-Type"], "application/json");
  strictEqual(r.headers["Authorization"], undefined);
});

test("non-empty MIRA_LLM_API_KEY -> Authorization Bearer present", () => {
  const r = resolveLlmProvider({
    MIRA_LLM_BASE_URL: "https://wii5y4dr0nvh3l-8000.proxy.runpod.net/v1",
    MIRA_LLM_MODEL: "qwen3-coder",
    MIRA_LLM_API_KEY: "sk-test-key-123",
  });

  strictEqual(r.headers["Authorization"], "Bearer sk-test-key-123");
});

test("unset MIRA_LLM_BASE_URL + OpenRouter key -> Authorization on OpenRouter headers", () => {
  const r = resolveLlmProvider({
    OPENROUTER_API_KEY: "sk-or-v1-abc",
  });

  equal(r.baseUrl, "https://openrouter.ai/api/v1/chat/completions");
  equal(r.headers["HTTP-Referer"], "https://mira.vualet.com");
  equal(r.headers["Authorization"], "Bearer sk-or-v1-abc");
});

test("MIRA_LLM_BASE_URL takes priority over OPENROUTER_API_KEY", () => {
  const r = resolveLlmProvider({
    MIRA_LLM_BASE_URL: "https://my-pod.local/v1",
    MIRA_LLM_MODEL: "custom-model",
    OPENROUTER_API_KEY: "sk-or-v1-ignored",
  });

  equal(r.baseUrl, "https://my-pod.local/v1/chat/completions");
  equal(r.model, "custom-model");
  equal(r.headers["HTTP-Referer"], undefined);
  strictEqual(r.headers["Authorization"], undefined);
});

test("MIRA_LLM_MODEL falls back to DEFAULT_MODEL when unset in env arg", () => {
  const r = resolveLlmProvider({
    MIRA_LLM_BASE_URL: "",
  });

  equal(r.model, "openai/gpt-4o-mini");
});

test("env arg overrides defaults — model from env takes priority", () => {
  const r = resolveLlmProvider({
    MIRA_LLM_BASE_URL: "https://pod.local/v1",
    MIRA_LLM_MODEL: "override-model",
    MIRA_LLM_API_KEY: "key-from-env",
  });

  equal(r.baseUrl, "https://pod.local/v1/chat/completions");
  equal(r.model, "override-model");
  strictEqual(r.headers["Authorization"], "Bearer key-from-env");
});

test("env arg baseUrl takes priority over default constant", () => {
  const r = resolveLlmProvider({
    MIRA_LLM_BASE_URL: "https://env-pod.local/v1",
    MIRA_LLM_MODEL: "env-model",
  });

  equal(r.baseUrl, "https://env-pod.local/v1/chat/completions");
  equal(r.model, "env-model");
});

test("default baseUrl is empty string, triggering OpenRouter fallback", () => {
  const r = resolveLlmProvider({});

  equal(r.baseUrl, "https://openrouter.ai/api/v1/chat/completions");
  equal(r.model, "openai/gpt-4o-mini");
});

test("default baseUrl is empty string, empty key -> no Authorization", () => {
  const r = resolveLlmProvider({});

  equal(r.baseUrl, "https://openrouter.ai/api/v1/chat/completions");
  strictEqual(r.headers["Authorization"], undefined);
});

test("Content-Type present on OpenRouter branch", () => {
  const r = resolveLlmProvider({});

  strictEqual(r.headers["Content-Type"], "application/json");
});

test("Content-Type present on OpenRouter branch with key", () => {
  const r = resolveLlmProvider({
    OPENROUTER_API_KEY: "sk-or-v1-xyz",
  });

  strictEqual(r.headers["Content-Type"], "application/json");
});

test("custom baseUrl with trailing slash -> single /chat/completions", () => {
  const r = resolveLlmProvider({
    MIRA_LLM_BASE_URL: "https://wii5y4dr0nvh3l-8000.proxy.runpod.net/v1/",
  });

  equal(r.baseUrl, "https://wii5y4dr0nvh3l-8000.proxy.runpod.net/v1/chat/completions");
});

test("custom baseUrl without trailing slash -> single /chat/completions", () => {
  const r = resolveLlmProvider({
    MIRA_LLM_BASE_URL: "https://wii5y4dr0nvh3l-8000.proxy.runpod.net/v1",
  });

  equal(r.baseUrl, "https://wii5y4dr0nvh3l-8000.proxy.runpod.net/v1/chat/completions");
});
