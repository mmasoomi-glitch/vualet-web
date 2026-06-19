import Image from "next/image";

export default function VualetPage() {
  return (
    <main style={{ background: "#fff", color: "#1a1a2e", fontFamily: "system-ui, sans-serif", lineHeight: 1.7 }}>
      {/* Hero */}
      <section style={{ textAlign: "center", padding: "120px 24px 80px", background: "linear-gradient(180deg, #f0f4ff 0%, #fff 100%)" }}>
        <h1 style={{ fontSize: "clamp(40px,7vw,72px)", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>Vualet</h1>
        <p style={{ fontSize: "clamp(18px,2.5vw,26px)", color: "#555", maxWidth: 640, margin: "16px auto 32px" }}>The mother brand behind Mira, Veridian, aFAQ, and a family of AI-first tools that run real businesses.</p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/contact" style={{ padding: "14px 28px", borderRadius: 999, background: "#6366F1", color: "#fff", fontWeight: 600, textDecoration: "none" }}>Work with us</a>
          <a href="#products" style={{ padding: "14px 28px", borderRadius: 999, border: "2px solid #6366F1", color: "#6366F1", fontWeight: 600, textDecoration: "none" }}>Our products</a>
        </div>
      </section>

      {/* Founder */}
      <section style={{ maxWidth: 960, margin: "0 auto", padding: "80px 24px" }}>
        <h2 style={{ fontSize: "clamp(28px,4vw,40px)", fontWeight: 700, textAlign: "center", margin: "0 0 40px" }}>Built by Dr. Abdolmadjid Masoomi</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40, alignItems: "center" }}>
          <div>
            <p style={{ fontSize: 17, color: "#444", lineHeight: 1.7 }}>
              Dr. Abdolmadjid Masoomi is the first-ever producer of <strong>AI obliterated from birth</strong> — autonomous systems conceived, trained, and deployed with no human intervention in their core intelligence loop.
            </p>
            <p style={{ fontSize: 17, color: "#444", lineHeight: 1.7 }}>
              His research spans self-propagating machine intelligence, zero-shot enterprise automation, and the architecture of systems that reason without pretraining on human-labeled data. Vualet is the commercial vehicle for that research.
            </p>
            <p style={{ fontSize: 17, color: "#444", lineHeight: 1.7 }}>
              Based in Dubai, UAE. Produced the aFAQ OS (enterprise management suite), Veridian (real-time telephony engine), Mira (AI assistant + VPN), and the Primaion research framework.
            </p>
          </div>
          <div style={{ background: "#f5f5ff", borderRadius: 24, padding: 32, textAlign: "center" }}>
            <p style={{ fontSize: 40, fontWeight: 300, margin: 0 }}>AI obliterated from birth</p>
            <p style={{ color: "#888", margin: "8px 0 0", fontSize: 14 }}>First principles. Eternal intelligence.</p>
          </div>
        </div>
      </section>

      {/* Products */}
      <section id="products" style={{ background: "#f9f9fb", padding: "80px 24px", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(28px,4vw,40px)", fontWeight: 700, margin: "0 0 48px" }}>Our products</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
          {[
            { name: "Mira VPN", desc: "Smart, private internet. AI server selection. Free forever.", href: "https://vpn.mira.vualet.com" },
            { name: "Mira Assistant", desc: "Your own AI, in the chat you already use. Voice-first.", href: "/mira" },
            { name: "Veridian", desc: "Real-time telephony + dispatch. SIP-to-GSM bridge.", href: "#" },
            { name: "aFAQ OS", desc: "Enterprise management suite. UAE VAT, inventory, POS.", href: "#" },
            { name: "Primaion", desc: "Research framework. First-principles intelligence.", href: "https://primaion.com" },
            { name: "WhatsApp AI Agents", desc: "24/7 sales and support bots on WhatsApp Business.", href: "/products/whatsapp-agents" },
          ].map((p) => (
            <a key={p.name} href={p.href} style={{ textDecoration: "none", background: "#fff", padding: 28, borderRadius: 16, textAlign: "left", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", color: "inherit", display: "block" }}>
              <h3 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 6px" }}>{p.name}</h3>
              <p style={{ fontSize: 14, color: "#666", margin: 0 }}>{p.desc}</p>
            </a>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section style={{ maxWidth: 640, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(28px,4vw,40px)", fontWeight: 700, margin: "0 0 18px" }}>Contact</h2>
        <p style={{ fontSize: 17, color: "#555" }}>
          <a href="tel:+16039993369" style={{ color: "#6366F1", fontWeight: 600, textDecoration: "none" }}>+1 (603) 999-3369</a>
        </p>
        <p style={{ fontSize: 14, color: "#888", marginTop: 4 }}>Vualet · Dubai, UAE · American number</p>
      </section>

      <footer style={{ borderTop: "1px solid #eee", padding: "32px 24px", textAlign: "center", fontSize: 13, color: "#888" }}>
        Vualet · Established 2026 · All rights reserved
      </footer>
    </main>
  );
}
