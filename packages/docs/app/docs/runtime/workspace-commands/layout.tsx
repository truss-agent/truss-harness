import { createDocsMetadata } from "../../../route-catalog";

export const metadata = createDocsMetadata("/docs/runtime/workspace-commands");

export default function DocsPageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
