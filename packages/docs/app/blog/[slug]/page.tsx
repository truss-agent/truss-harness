import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../../site-chrome";
import { createPageMetadata, siteUrl } from "../../site-metadata";
import { blogArticles, getBlogArticle } from "../blog-content";

type BlogArticlePageProps = {
  readonly params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return blogArticles.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: BlogArticlePageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getBlogArticle(slug);
  if (!article) return {};
  const baseMetadata = createPageMetadata({
    title: article.title,
    description: article.description,
    path: `/blog/${article.slug}`,
  });

  return {
    ...baseMetadata,
    keywords: [...article.keywords],
    alternates: {
      canonical: `/blog/${article.slug}`,
      types: {
        "application/rss+xml": [
          { url: "/blog/feed.xml", title: "Truss Guides" },
        ],
      },
    },
    openGraph: {
      type: "article",
      url: `/blog/${article.slug}`,
      siteName: "Truss",
      title: `${article.title} | Truss`,
      description: article.description,
      images: [
        {
          url: "/og.png",
          width: 1200,
          height: 630,
          alt: `${article.title} | Truss`,
        },
      ],
      publishedTime: article.publishedAt,
      modifiedTime: article.updatedAt,
      authors: ["Truss"],
    },
  };
}

export default async function BlogArticlePage({
  params,
}: BlogArticlePageProps) {
  const { slug } = await params;
  const article = getBlogArticle(slug);
  if (!article) notFound();

  const articleUrl = new URL(`/blog/${article.slug}`, siteUrl).toString();
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        headline: article.title,
        description: article.description,
        datePublished: article.publishedAt,
        dateModified: article.updatedAt,
        author: { "@type": "Organization", name: "Truss" },
        publisher: {
          "@type": "Organization",
          name: "Truss",
          logo: {
            "@type": "ImageObject",
            url: new URL("/brand-logo.png", siteUrl).toString(),
          },
        },
        mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
        keywords: article.keywords.join(", "),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
          {
            "@type": "ListItem",
            position: 2,
            name: "Guides",
            item: new URL("/blog", siteUrl).toString(),
          },
          {
            "@type": "ListItem",
            position: 3,
            name: article.title,
            item: articleUrl,
          },
        ],
      },
      {
        "@type": "FAQPage",
        mainEntity: article.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
      },
    ],
  };

  return (
    <div className="site">
      <SiteHeader />
      <main className="site-page blog-article-page">
        <nav className="blog-breadcrumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/blog">Guides</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{article.title}</span>
        </nav>
        <article className="blog-article">
          <header className="blog-article-header">
            <p className="site-eyebrow">Local-first coding agents</p>
            <h1>{article.title}</h1>
            <p className="blog-article-dek">{article.description}</p>
            <div className="blog-article-meta">
              <span>By Truss</span>
              <time dateTime={article.publishedAt}>
                Published{" "}
                {new Intl.DateTimeFormat("en", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date(`${article.publishedAt}T00:00:00`))}
              </time>
              <span>{article.readingTime}</span>
            </div>
            <div className="blog-keywords" aria-label="Article topics">
              {article.keywords.map((keyword) => (
                <span key={keyword}>{keyword}</span>
              ))}
            </div>
          </header>
          <div className="blog-article-body">
            {article.sections.map((section) => (
              <section key={section.heading}>
                <h2>{section.heading}</h2>
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets ? (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
                {section.code ? (
                  <pre>
                    <code>{section.code}</code>
                  </pre>
                ) : null}
              </section>
            ))}
            <section
              className="blog-article-links"
              aria-labelledby="next-steps-heading"
            >
              <p className="site-eyebrow">Next steps</p>
              <h2 id="next-steps-heading">
                Put it to work in your own workspace.
              </h2>
              <p>
                Pick the surface that fits your day, then connect a model you
                control.
              </p>
              <div className="site-actions">
                <Link
                  className="site-button site-button-primary"
                  href="/download"
                >
                  Download Truss
                </Link>
                <Link
                  className="site-button site-button-secondary"
                  href="/docs/getting-started"
                >
                  Read the setup guide
                </Link>
              </div>
              <div className="blog-related-links">
                <Link href="/features">Explore Truss features</Link>
                <Link href="/clients">Compare every client</Link>
                <Link href="/docs/local-models">Connect a local model</Link>
              </div>
            </section>
            <section className="blog-faq" aria-labelledby="faq-heading">
              <p className="site-eyebrow">FAQ</p>
              <h2 id="faq-heading">
                Questions developers ask before switching.
              </h2>
              {article.faqs.map((faq) => (
                <details key={faq.question}>
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </section>
          </div>
        </article>
      </main>
      <SiteFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
    </div>
  );
}
