"use client";

import { useMemo, useState } from "react";

/**
 * Client-only onboarding for a Mira VPN access link.
 *
 * SAFETY: this component runs entirely in the browser. The access link you
 * paste is NEVER sent to Mira's servers, logged, or persisted — it is parsed
 * locally to help you import it into a VPN app. That is why the page can make
 * the "we never see your key" promise truthfully: there is no network call here.
 */

type Parsed = {
  ok: boolean;
  reason?: string;
  host?: string;
  port?: string;
  security?: string;
  sni?: string;
  fp?: string;
  label?: string;
  maskedId?: string;
};

function parseVless(raw: string): Parsed {
  const link = raw.trim();
  if (!link) return { ok: false, reason: "Paste the vless:// line you were given." };
  if (!link.startsWith("vless://")) {
    return { ok: false, reason: "That doesn't look right — a Mira link starts with vless://" };
  }
  try {
    // vless://<uuid>@<host>:<port>?<params>#<label>
    const afterScheme = link.slice("vless://".length);
    const hash = afterScheme.indexOf("#");
    const label = hash >= 0 ? decodeURIComponent(afterScheme.slice(hash + 1)) : undefined;
    const noHash = hash >= 0 ? afterScheme.slice(0, hash) : afterScheme;
    const at = noHash.indexOf("@");
    if (at <= 0) return { ok: false, reason: "The link is missing its account section." };
    const id = noHash.slice(0, at);
    const rest = noHash.slice(at + 1);
    const q = rest.indexOf("?");
    const hostport = q >= 0 ? rest.slice(0, q) : rest;
    const query = q >= 0 ? rest.slice(q + 1) : "";
    const colon = hostport.lastIndexOf(":");
    if (colon <= 0) return { ok: false, reason: "The link is missing the server address or port." };
    const host = hostport.slice(0, colon);
    const port = hostport.slice(colon + 1);
    if (!/^\d+$/.test(port)) return { ok: false, reason: "The port in the link isn't valid." };
    const params = new URLSearchParams(query);
    const maskedId =
      id.length >= 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : "••••";
    return {
      ok: true,
      host,
      port,
      security: params.get("security") ?? "none",
      sni: params.get("sni") ?? undefined,
      fp: params.get("fp") ?? undefined,
      label,
      maskedId,
    };
  } catch {
    return { ok: false, reason: "The link couldn't be read. Copy it again and retry." };
  }
}

const field: React.CSSProperties = {
  fontSize: 13,
  color: "var(--mira-slate)",
  margin: 0,
  letterSpacing: ".02em",
  textTransform: "uppercase",
};
const value: React.CSSProperties = {
  fontSize: 15,
  color: "var(--mira-ink)",
  margin: "2px 0 0",
  fontWeight: 500,
  wordBreak: "break-all",
};

export default function Connect() {
  const [raw, setRaw] = useState("");
  const [copied, setCopied] = useState(false);
  const parsed = useMemo(() => parseVless(raw), [raw]);
  const showResult = raw.trim().length > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(raw.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const blob = new Blob([raw.trim() + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "mira-vpn-link.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const hiddifyDeepLink = parsed.ok
    ? `hiddify://import/${encodeURIComponent(raw.trim())}`
    : "#";

  return (
    <div
      style={{
        background: "var(--mira-canvas)",
        border: "1px solid var(--mira-fog)",
        borderRadius: "var(--mira-radius-xl)",
        boxShadow: "var(--mira-shadow-md)",
        padding: "clamp(22px, 4vw, 34px)",
      }}
    >
      <label htmlFor="mira-vpn-link" className="display" style={{ fontSize: 22, fontWeight: 400, display: "block" }}>
        Paste your access link
      </label>
      <p style={{ color: "var(--mira-graphite)", fontSize: 14.5, margin: "8px 0 16px", lineHeight: 1.6 }}>
        It starts with <code style={{ background: "var(--mira-frost)", padding: "1px 6px", borderRadius: 6 }}>vless://</code>.
        Everything below happens on your device — your link never leaves this page.
      </p>

      <textarea
        id="mira-vpn-link"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder="vless://…"
        rows={3}
        style={{
          width: "100%",
          resize: "vertical",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13.5,
          lineHeight: 1.5,
          padding: "14px 16px",
          borderRadius: "var(--mira-radius-lg)",
          border: `1px solid ${showResult && !parsed.ok ? "var(--mira-rose-deep)" : "var(--mira-fog)"}`,
          background: "var(--mira-cream)",
          color: "var(--mira-ink)",
          outline: "none",
          boxSizing: "border-box",
        }}
      />

      {showResult && !parsed.ok && (
        <p role="alert" style={{ color: "var(--mira-rose-deep)", fontSize: 14, margin: "12px 2px 0" }}>
          {parsed.reason}
        </p>
      )}

      {parsed.ok && (
        <>
          <div
            style={{
              marginTop: 18,
              padding: "18px 20px",
              borderRadius: "var(--mira-radius-lg)",
              background: "var(--mira-frost)",
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0,1fr))",
              gap: 16,
            }}
          >
            <div>
              <p style={field}>Server</p>
              <p style={value}>{parsed.host}:{parsed.port}</p>
            </div>
            <div>
              <p style={field}>Camouflage</p>
              <p style={value}>
                {parsed.security === "reality" ? "REALITY" : parsed.security}
                {parsed.sni ? ` · ${parsed.sni}` : ""}
              </p>
            </div>
            <div>
              <p style={field}>Account</p>
              <p style={value}>{parsed.maskedId}</p>
            </div>
            <div>
              <p style={field}>Profile</p>
              <p style={value}>{parsed.label ?? "Mira VPN"}</p>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 18 }}>
            <button className="btn-mira" onClick={copy} type="button">
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <a className="btn-mira-soft" href={hiddifyDeepLink}>
              Open in Hiddify
            </a>
            <button className="btn-mira-soft" onClick={download} type="button">
              Download .txt
            </button>
          </div>

          <p style={{ color: "var(--mira-slate)", fontSize: 12.5, margin: "16px 2px 0", lineHeight: 1.6 }}>
            After copying, open your VPN app → <strong>New profile</strong> → <strong>Add from clipboard</strong> → tap
            connect. Keep this link private: anyone who has it can use your data allowance.
          </p>
        </>
      )}
    </div>
  );
}
