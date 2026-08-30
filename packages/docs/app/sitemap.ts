import type { MetadataRoute } from "next";
import { siteUrl } from "./site-metadata";
import { blogArticles } from "./blog/blog-content";

const paths = [
  "/",
  "/about",
  "/blog",
  "/changelog",
  "/roadmap",
  "/clients",
  "/clients/cli",
  "/clients/tui",
  "/clients/vscode",
  "/clients/desktop",
  "/download",
  "/features",
  "/docs",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const siteEntries: MetadataRoute.Sitemap = paths.map((path) => ({
    url: new URL(path, siteUrl).toString(),
    lastModified: new Date(),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path.startsWith("/clients") ? 0.8 : 0.7,
  }));
  const articleEntries: MetadataRoute.Sitemap = blogArticles.map((article) => ({
    url: new URL(`/blog/${article.slug}`, siteUrl).toString(),
    lastModified: new Date(`${article.updatedAt}T00:00:00`),
    changeFrequency: "monthly",
    priority: 0.8,
  }));
  return [...siteEntries, ...articleEntries];
}
