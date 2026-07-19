import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import { brand } from "@truss-harness/branding";
import "nextra-theme-docs/style.css";

export const metadata = {
  title: { default: "Docs", template: `%s | ${brand.productName}` },
  description: `Documentation for the local-first ${brand.productName} coding-agent runtime and clients.`,
  applicationName: brand.productName,
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
