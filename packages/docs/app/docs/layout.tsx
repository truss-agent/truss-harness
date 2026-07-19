import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import { brand } from "@truss-harness/branding";
import "nextra-theme-docs/style.css";

export const metadata = {
  title: { default: "Docs", template: `%s | ${brand.productName}` },
  description: `Documentation for the local-first ${brand.productName} coding-agent runtime and clients.`,
  applicationName: brand.productName,
  alternates: { canonical: "/docs" },
  openGraph: {
    type: "website",
    url: "/docs",
    siteName: brand.productName,
    title: `${brand.productName} Documentation`,
    description: `Documentation for the local-first ${brand.productName} coding-agent runtime and clients.`,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: `${brand.productName} Documentation` }]
  },
  twitter: {
    card: "summary_large_image",
    title: `${brand.productName} Documentation`,
    description: `Documentation for the local-first ${brand.productName} coding-agent runtime and clients.`,
    images: ["/og.png"]
  },
  icons: {
    icon: "/brand-logo.png",
    shortcut: "/brand-logo.png",
    apple: "/brand-logo.png"
  }
};

const navbar = <Navbar logo={<span style={{ alignItems: "center", display: "inline-flex", gap: 8 }}><img src="/brand-logo.png" width={26} height={26} alt="" /><b>{brand.productName}</b></span>} projectLink={brand.repositoryUrl} />;
const footer = <Footer>{brand.productName} documentation</Footer>;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <Layout navbar={navbar} pageMap={await getPageMap()} footer={footer} docsRepositoryBase={`${brand.repositoryUrl}/tree/${brand.repositoryBranch}/packages/docs`}>{children}</Layout>;
}
