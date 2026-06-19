import Link from "next/link";
import { POSTS } from "@/lib/blog";

export default function BlogPage() {
  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "64px 24px", fontFamily: "system-ui, sans-serif", color: "#1a1a2e", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: "clamp(32px,5vw,48px)", fontWeight: 700, margin: "0 0 8px" }}>Vualet Blog</h1>
      <p style={{ color: "#888", margin: "0 0 40px", fontSize: 16 }}>AI, VPN, privacy, and the business of autonomous intelligence.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {POSTS.map((p) => (
          <article key={p.slug}>
            <Link href={`/blog/${p.slug}`} style={{ textDecoration: "none", color: "inherit" }}>
              <small style={{ color: "#888", fontSize: 12 }}>{p.date} · {p.category}</small>
              <h2 style={{ fontSize: 20, fontWeight: 600, margin: "4px 0 6px", lineHeight: 1.3 }}>{p.title}</h2>
              <p style={{ fontSize: 15, color: "#555", margin: 0 }}>{p.excerpt}</p>
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
