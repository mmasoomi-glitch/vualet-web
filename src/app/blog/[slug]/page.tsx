import { notFound } from "next/navigation";
import { POSTS, type Post } from "@/lib/blog";
import Link from "next/link";
import { Metadata } from "next";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) return {};
  return {
    title: `${post.title} — Vualet Blog`,
    description: post.excerpt,
    openGraph: { title: post.title, description: post.excerpt, type: "article", publishedTime: post.date },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = POSTS.find((p) => p.slug === slug);
  if (!post) notFound();

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px", fontFamily: "system-ui, sans-serif", color: "#1a1a2e", lineHeight: 1.8 }}>
      <Link href="/blog" style={{ color: "#6366F1", fontSize: 14, textDecoration: "none" }}>← All posts</Link>
      <article style={{ marginTop: 24 }}>
        <small style={{ color: "#888", fontSize: 12 }}>{post.date} · {post.category}</small>
        <h1 style={{ fontSize: "clamp(28px,4vw,42px)", fontWeight: 700, margin: "8px 0 16px", lineHeight: 1.2 }}>{post.title}</h1>
        <div style={{ display: "flex", gap: 8, marginBottom: 32, flexWrap: "wrap" }}>
          {post.tags.map((t) => <span key={t} style={{ background: "#f0f4ff", padding: "4px 10px", borderRadius: 999, fontSize: 12, color: "#6366F1" }}>{t}</span>)}
        </div>
        <div style={{ fontSize: 17, color: "#444", lineHeight: 1.8 }}>
          <p>{post.excerpt}</p>
          <p>This post is published as part of the Vualet knowledge base. For detailed technical documentation, see the <Link href="/docs" style={{ color: "#6366F1" }}>docs</Link> section.</p>
        </div>
      </article>
      <nav style={{ marginTop: 48, borderTop: "1px solid #eee", paddingTop: 24 }}>
        <Link href="/blog" style={{ color: "#6366F1", textDecoration: "none", fontWeight: 500 }}>← Back to all posts</Link>
      </nav>
    </main>
  );
}
