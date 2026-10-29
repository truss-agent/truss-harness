import { createDocsMetadata } from "../../route-catalog";

export const metadata = createDocsMetadata("/docs/local-models");

export default function DocsPageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
