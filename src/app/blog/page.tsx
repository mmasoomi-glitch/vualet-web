import type { Metadata } from "next";
import Link from "next/link";
import { allPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Engineering notes",
  description:
    "True accounts of how Vualet's software actually behaved, including the mistakes.",
};

export default function BlogIndexPage() {
  return (
    <main className="container mx-auto px-4 py-16 max-w-3xl">
      <header>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--muted)]">
          Vualet engineering
        </p>
        <h1
          className="mt-4 text-4xl font-bold tracking-tight text-[var(--foreground)] sm:text-5xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Engineering notes
        </h1>
        <p className="mt-6 max-w-[62ch] text-lg leading-relaxed text-[var(--muted)]">
          These are real incidents from our engineering records: what broke, what
          it cost, and what changed. We publish the mistakes too, because a
          company that only publishes its successes is telling you less than it
          knows.
        </p>
      </header>

      <div className="mt-16 divide-y divide-[var(--border)]">
        {allPosts().map((post) => (
          <article key={post.slug} className="py-10 first:pt-0 last:pb-0">
            <p className="text-sm text-[var(--muted)]">
              {new Date(post.date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              <span className="mx-2">&middot;</span>
              {post.readingMinutes} min read
            </p>
            <h2
              className="mt-3 text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <Link
                href={`/blog/${post.slug}`}
                className="transition-colors hover:text-[var(--color-vualet-indigo)]"
              >
                {post.title}
              </Link>
            </h2>
            <p className="mt-3 max-w-[62ch] leading-relaxed text-[var(--muted)]">
              {post.dek}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1 text-sm text-[var(--muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
