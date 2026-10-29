import { createDocsMetadata } from "../../../route-catalog";

export const metadata = createDocsMetadata("/docs/runtime/workspace-memory");

export default function DocsPageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
