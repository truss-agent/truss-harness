import { createDocsMetadata } from "../../route-catalog";

export const metadata = createDocsMetadata("/docs/development");

export default function DocsPageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
