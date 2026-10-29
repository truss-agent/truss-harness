import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";
import { createRequire } from "node:module";

it("adapts only the exact reviewed Nextra layout and preserves other validation", async () => {
  const { patchNextraLayout } = await import(
    new URL("../next.config.mjs", import.meta.url).href
  );
  const dir = dirname(
    createRequire(import.meta.url).resolve("nextra-theme-docs/style.css"),
  );
  const source = readFileSync(resolve(dir, "layout.js"), "utf8");
  const patched = patchNextraLayout(source, dir, "4.6.1");
  expect(patched).toContain(
    "LayoutPropsSchema.omit({ children: true }).safeParse(themeConfig)",
  );
  expect(patched).toContain("throw z.prettifyError(error)");
  expect(patched).not.toMatch(/from ["']\.\//);
  expect(patched.match(/LayoutPropsSchema\.omit/g)).toHaveLength(1);
  expect(() => patchNextraLayout(patched, dir, "4.6.1")).toThrow(
    "Nextra layout changed",
  );
  expect(() => patchNextraLayout(source, dir, "4.6.2")).toThrow(
    "Nextra layout changed",
  );
  expect(() => patchNextraLayout(`${source}\n`, dir, "4.6.1")).toThrow(
    "Nextra layout changed",
  );
});
