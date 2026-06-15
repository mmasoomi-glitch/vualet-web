"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Stepper } from "../_components/Stepper";

const card: React.CSSProperties = {
  background: "var(--mira-canvas)",
  border: "1px solid var(--mira-fog)",
  borderRadius: "var(--mira-radius-lg)",
  boxShadow: "var(--mira-shadow-sm)",
  padding: 28,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "13px 15px",
  fontSize: 15,
  borderRadius: "var(--mira-radius-md)",
  border: "1px solid var(--mira-fog)",
  background: "var(--mira-cream)",
  color: "var(--mira-ink)",
  outline: "none",
};

export default function MiraSignup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // No backend yet — remember locally so the next steps can greet them.
    localStorage.setItem("mira_signup", JSON.stringify({ name, email }));
    router.push("/mira/plans");
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px 80px" }}>
      <Stepper current={1} />
      <header style={{ textAlign: "center", marginBottom: 24 }}>
        <h1 className="display" style={{ fontSize: "clamp(28px,4.5vw,40px)", margin: "0 0 6px" }}>
          Let&apos;s <span className="grad">meet you</span>
        </h1>
        <p style={{ color: "var(--mira-graphite)", fontSize: 15.5, margin: 0 }}>
          Just a name and an email. Mira does the rest.
        </p>
      </header>

      <form onSubmit={submit} style={card}>
        <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", marginBottom: 6 }}>Your name</label>
        <input
          style={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Maya"
          required
          autoFocus
        />
        <label style={{ display: "block", fontSize: 13, color: "var(--mira-graphite)", margin: "16px 0 6px" }}>Email</label>
        <input
          style={input}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          required
        />
        <button
          type="submit"
          className="btn-mira"
          style={{ width: "100%", marginTop: 22, justifyContent: "center", fontSize: 15.5, padding: "15px" }}
        >
          Continue →
        </button>
        <p style={{ textAlign: "center", fontSize: 12.5, color: "var(--mira-slate)", margin: "14px 0 0" }}>
          No password yet — we&apos;ll set that up after you choose a plan.
        </p>
      </form>
    </main>
  );
}
