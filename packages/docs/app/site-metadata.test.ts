import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocsMetadata, docsRoutes } from "./route-catalog";
afterEach(() => vi.unstubAllEnvs());

async function siteUrl(environment: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(environment))
    vi.stubEnv(key, value);
  vi.resetModules();
  return (await import("./site-metadata")).siteUrl;
}

describe("route metadata", () => {
  it("gives branded component headings explicit plaintext metadata and self social URLs", () => {
    expect(createDocsMetadata("/docs/clients/neovim")).toMatchObject({
      title: { default: "Truss for Neovim", template: "%s | Truss" },
      alternates: { canonical: "/docs/clients/neovim" },
      openGraph: {
        url: "/docs/clients/neovim",
        title: "Truss for Neovim | Truss",
      },
    });
    expect(createDocsMetadata("/docs/clients/truss-go")).toMatchObject({
      title: { default: "Truss Go for Android", template: "%s | Truss" },
      alternates: { canonical: "/docs/clients/truss-go" },
    });
    const metadata = docsRoutes.map((route) => createDocsMetadata(route.path));
    expect(new Set(metadata.map((entry) => entry.description)).size).toBe(19);
  });
  it("uses the preferred production origin while keeping explicit preview configuration separate", async () => {
    expect(
      await siteUrl({
        NEXT_PUBLIC_SITE_URL: undefined,
        VERCEL_ENV: "production",
        VERCEL_URL: "build.vercel.app",
      }),
    ).toBe("https://www.truss-agent.com");
    expect(
      await siteUrl({
        NEXT_PUBLIC_SITE_URL: undefined,
        VERCEL_ENV: "preview",
        VERCEL_URL: "preview.vercel.app",
      }),
    ).toBe("https://preview.vercel.app");
    expect(
      await siteUrl({
        NEXT_PUBLIC_SITE_URL: "https://custom.example",
        VERCEL_ENV: "preview",
        VERCEL_URL: "preview.vercel.app",
      }),
    ).toBe("https://custom.example");
  });
});
