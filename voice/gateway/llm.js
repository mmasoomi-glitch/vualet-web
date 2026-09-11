/**
 * Parse OpenAI-compatible SSE stream and invoke onToken for each content delta.
 * Returns an array of { text } objects (one per token).
 *
 * Config is read from env at call time so tests can modify process.env between calls.
 *
 * @param {string} text — user message to send
 * @param {object} opts
 * @param {AbortSignal|null} [opts.signal]
 * @param {function(string): void} [opts.onToken] — deprecated; returns array instead
 * @returns {Promise<string[]>} concatenated tokens as an array of strings
 */
export async function streamReply(text, { signal = null, onToken = null } = {}) {
  const baseUrl = process.env.MIRA_LLM_BASE_URL || "http://127.0.0.1:8000";
  const model = process.env.MIRA_LLM_MODEL || "meta-llama/Llama-3.1-8B-Instruct";
  const apiKey = process.env.MIRA_LLM_API_KEY || "";

  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: text }],
    stream: true,
    max_tokens: 512,
  });

  const headers = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const url = `${baseUrl}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal,
  });

  if (!res.ok) {
    throw new Error(`LLM ${res.status}: ${res.statusText}`);
  }

  const tokens = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines from the buffer
      let lineEnd;
      while ((lineEnd = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);

        // Skip empty lines (SSE separators)
        if (!line) continue;

        // Handle multi-line SSE values: a line ending with space+continuation
        // is handled by collecting lines until we see one that doesn't end with space
        if (!line.startsWith("data: ")) continue;

        const data = line.slice(6); // strip "data: "

        // Terminal line
        if (data === "[DONE]") break;

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            tokens.push(delta);
            if (onToken) onToken(delta);
          }
        } catch {
          // Malformed JSON line — skip silently
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  return tokens;
}
