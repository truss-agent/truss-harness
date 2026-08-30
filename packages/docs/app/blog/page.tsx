import Link from "next/link";
import { SiteFooter, SiteHeader } from "../site-chrome";
import { createPageMetadata, siteUrl } from "../site-metadata";
import { blogArticles } from "./blog-content";

const blogMetadata = createPageMetadata({
  title: "Coding Agent Guides",
  description:
    "Practical guides for using local-first coding agents, local models, BYOK providers, and Truss across the desktop, VS Code, terminal, Neovim, and mobile.",
  path: "/blog",
});

export const metadata = {
  ...blogMetadata,
  alternates: {
    canonical: "/blog",
    types: {
      "application/rss+xml": [{ url: "/blog/feed.xml", title: "Truss Guides" }],
    },
  },
};

export default function BlogIndexPage() {
  const blogStructuredData = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Truss Guides",
    description:
      "Practical guides for local-first coding agents, local models, and BYOK providers.",
    url: new URL("/blog", siteUrl).toString(),
    inLanguage: "en",
    blogPost: blogArticles.map((article) => ({
      "@type": "BlogPosting",
      headline: article.title,
      description: article.description,
      datePublished: article.publishedAt,
      dateModified: article.updatedAt,
      mainEntityOfPage: new URL(`/blog/${article.slug}`, siteUrl).toString(),
    })),
  };

  return (
    <div className="site">
      <SiteHeader />
      <main className="site-page blog-index-page">
        <header className="site-page-intro blog-index-intro">
          <p className="site-eyebrow">Truss guides</p>
          <h1>Practical guides for coding agents you control.</h1>
          <p>
            Clear explanations of local models, BYOK providers, permissions, and
            the workflows that let you use an agent without giving up your tools
            or your workspace.
          </p>
        </header>
        <section className="blog-index-grid" aria-label="Coding agent guides">
          {blogArticles.map((article) => (
            <article key={article.slug} className="blog-card">
              <div className="blog-card-meta">
                <span>{article.readingTime}</span>
                <time dateTime={article.publishedAt}>
                  {new Intl.DateTimeFormat("en", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  }).format(new Date(`${article.publishedAt}T00:00:00`))}
                </time>
              </div>
              <h2>
                <Link href={`/blog/${article.slug}`}>{article.title}</Link>
              </h2>
              <p>{article.excerpt}</p>
              <div className="blog-card-tags" aria-label="Topics">
                {article.keywords.slice(0, 3).map((keyword) => (
                  <span key={keyword}>{keyword}</span>
                ))}
              </div>
              <Link className="site-text-link" href={`/blog/${article.slug}`}>
                Read the guide <span aria-hidden="true">→</span>
              </Link>
            </article>
          ))}
        </section>
      </main>
      <SiteFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(blogStructuredData).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
