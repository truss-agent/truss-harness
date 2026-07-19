import { brand } from "@truss-harness/branding";
import type { Metadata, Viewport } from "next";
import { siteUrl } from "./site-metadata";
import "./site.css";

export const metadata: Metadata = {
  title: { default: brand.productName, template: `%s | ${brand.productName}` },
  description: `A local-first coding-agent runtime with a CLI, TUI, VS Code extension, and desktop app.`,
  applicationName: brand.productName,
  category: "Developer tools",
  keywords: ["coding agent", "local models", "Ollama", "LM Studio", "llama.cpp", "CLI", "terminal UI", "VS Code", "desktop app"],
  metadataBase: new URL(siteUrl),
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  openGraph: {
    type: "website",
    url: "/",
    siteName: brand.productName,
    title: brand.productName,
    description: `Local-first coding agents for the CLI, TUI, VS Code, and desktop.`,
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: brand.productName,
    description: `Local-first coding agents for the CLI, TUI, VS Code, and desktop.`,
    images: ["/og.png"],
  },
  icons: {
    icon: "/brand-logo.png",
    shortcut: "/brand-logo.png",
    apple: "/brand-logo.png",
  },
};

export const viewport: Viewport = { colorScheme: "light dark", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f7f1" }, { media: "(prefers-color-scheme: dark)", color: "#0c1613" }] };

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
