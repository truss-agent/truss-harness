import { brand } from "@truss-harness/branding";
import "./site.css";

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

export const metadata = {
  title: { default: brand.productName, template: `%s | ${brand.productName}` },
  description: `A local-first coding-agent runtime with a CLI, TUI, VS Code extension, and desktop app.`,
  metadataBase: new URL(siteUrl),
  openGraph: {
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
