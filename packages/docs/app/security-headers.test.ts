import { describe, expect, it } from "vitest";

describe("website response policy", () => {
  it("registers browser hardening for every route without enforcing an unverified script policy", async () => {
    const { default: config } = await import(
      new URL("../next.config.mjs", import.meta.url).href
    );
    const rules = await config.headers?.();
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/:path*",
          headers: expect.arrayContaining([
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "X-Frame-Options", value: "DENY" },
            {
              key: "Content-Security-Policy",
              value:
                "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
            },
            expect.objectContaining({
              key: "Content-Security-Policy-Report-Only",
              value: expect.stringContaining("script-src 'self'"),
            }),
          ]),
        }),
      ]),
    );
  });
});
