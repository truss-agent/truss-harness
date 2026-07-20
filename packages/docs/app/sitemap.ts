import type { MetadataRoute } from "next";
import { siteUrl } from "./site-metadata";

const paths = ["/", "/about", "/changelog", "/roadmap", "/clients", "/clients/cli", "/clients/tui", "/clients/vscode", "/clients/desktop", "/download", "/features", "/docs"];

export default function sitemap(): MetadataRoute.Sitemap {
  return paths.map((path) => ({ url: new URL(path, siteUrl).toString(), lastModified: new Date(), changeFrequency: path === "/" ? "weekly" : "monthly", priority: path === "/" ? 1 : path.startsWith("/clients") ? 0.8 : 0.7 }));
}
