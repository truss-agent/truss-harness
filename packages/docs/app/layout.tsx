import { brand } from "@truss-harness/branding";
import "./site.css";

export const metadata = {
  title: { default: brand.productName, template: `%s | ${brand.productName}` },
  description: `A local-first coding-agent harness designed for effective local models.`,
  icons: {
    icon: "/brand-logo.png",
    shortcut: "/brand-logo.png",
    apple: "/brand-logo.png"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" dir="ltr" suppressHydrationWarning><body>{children}</body></html>;
}
