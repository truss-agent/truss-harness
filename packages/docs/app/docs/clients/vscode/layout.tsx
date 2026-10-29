import { createDocsMetadata } from "../../../route-catalog";

export const metadata = createDocsMetadata("/docs/clients/vscode");

export default function DocsPageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
