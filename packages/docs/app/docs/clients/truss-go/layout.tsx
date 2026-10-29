import { createDocsMetadata } from "../../../route-catalog";

export const metadata = createDocsMetadata("/docs/clients/truss-go");

export default function DocsPageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
