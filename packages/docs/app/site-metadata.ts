import type { Metadata } from "next";
import { brand } from "@truss-harness/branding";

export const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export function createPageMetadata(options: {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly image?: string;
}): Metadata {
  const title = options.title === brand.productName ? brand.productName : `${options.title} | ${brand.productName}`;
  const image = options.image ?? "/og.png";

  return {
    title: options.title,
    description: options.description,
    alternates: { canonical: options.path },
    openGraph: {
      type: "website",
      url: options.path,
      siteName: brand.productName,
      title,
      description: options.description,
      images: [{ url: image, width: 1200, height: 630, alt: title }]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: options.description,
      images: [image]
    }
  };
}
