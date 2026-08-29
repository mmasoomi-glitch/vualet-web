import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { allPosts, getPost, type BlogBlock } from "@/lib/blog";
import { JsonLd, articleSchema, breadcrumbSchema } from "@/components/json-ld";

export async function generateStaticParams() {
  return allPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);

  if (!post) {
    return { title: "Engineering notes" };
  }

  return { title: post.title, description: post.dek };
}

function Block({ block }: { block: BlogBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="mt-6 leading-relaxed text-[var(--foreground)]">
          {block.text}
        </p>
      );
    case "h2":
      return (
        <h2
          className="mt-12 text-2xl font-semibold text-[var(--foreground)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {block.text}
        </h2>
      );
    case "list":
      return (
        <ul className="mt-6 space-y-2 list-disc pl-6 text-[var(--foreground)]">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote className="mt-8 border-l-2 border-[var(--color-vualet-indigo)] pl-6 italic text-[var(--muted)]">
          <p>{block.text}</p>
        </blockquote>
      );
    default:
      return null;
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);

  if (!post) {
    notFound();
  }

  return (
    <main className="container mx-auto px-4 py-16 max-w-[68ch]">
      <JsonLd
        data={articleSchema({
          title: post.title,
          description: post.dek,
          datePublished: post.date,
          path: `/blog/${post.slug}`,
        })}
      />
      <JsonLd
        data={breadcrumbSchema([
          { name: "Vualet", path: "/" },
          { name: "Engineering notes", path: "/blog" },
          { name: post.title, path: `/blog/${post.slug}` },
        ])}
      />

      <Link
        href="/blog"
        className="text-sm text-[var(--muted)] hover:text-[var(--color-vualet-indigo)]"
      >
        &larr; Engineering notes
      </Link>

      <p className="mt-2 text-sm text-[var(--muted)]">
        {new Date(post.date).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
        <span className="mx-2">&middot;</span>
        {post.readingMinutes} min read
      </p>

      <h1
        className="mt-4 text-4xl font-semibold leading-tight text-[var(--foreground)] md:text-5xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {post.title}
      </h1>

      <p className="mt-4 text-xl leading-relaxed text-[var(--muted)]">
        {post.dek}
      </p>

      <hr className="mt-10 border-[var(--border)]" />

      <div>
        {post.body.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>

      <footer className="mt-16">
        <hr className="border-[var(--border)]" />

        <div className="mt-6 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-sm text-[var(--muted)]"
            >
              {tag}
            </span>
          ))}
        </div>

        <p className="mt-6 text-sm text-[var(--muted)]">
          If you think something here is wrong, we genuinely want to hear it.{" "}
          <a
            href="mailto:info@vualet.com"
            className="text-[var(--color-vualet-indigo)] underline decoration-[var(--color-vualet-indigo)]"
          >
            info@vualet.com
          </a>
        </p>
      </footer>
    </main>
  );
}
