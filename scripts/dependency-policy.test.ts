import { expect, it } from "vitest";
import { verifyAudit } from "./check-dependencies.mts";

const known = () => ({
  vulnerabilities: {
    deepmerge: {
      via: [
        {
          url: "https://github.com/advisories/GHSA-gcqx-w48m-w2h4",
          range: ">=4.2.0 <=4.3.1",
        },
      ],
      nodes: ["node_modules/deepmerge"],
    },
  },
});
const beforeExpiry = new Date("2026-11-01T00:00:00Z");
it("leaves the bounded unresolved advisory visible and rejects its expiry", () => {
  expect(verifyAudit(known(), beforeExpiry)).toEqual(["deepmerge"]);
  expect(() => verifyAudit(known(), new Date("2026-11-28T00:00:00Z"))).toThrow(
    "Unapproved",
  );
});
it("rejects new advisories and copies outside the reviewed Expo graph", () => {
  const unexpected = known();
  unexpected.vulnerabilities.deepmerge.via[0].url =
    "https://example.invalid/another-advisory";
  expect(() => verifyAudit(unexpected, beforeExpiry)).toThrow("Unapproved");
  const extraCopy = known();
  extraCopy.vulnerabilities.deepmerge.nodes.push(
    "node_modules/other/node_modules/deepmerge",
  );
  expect(() => verifyAudit(extraCopy, beforeExpiry)).toThrow(
    "additional deepmerge copies",
  );
  expect(() =>
    verifyAudit(
      { vulnerabilities: { unrelated: { via: ["deepmerge"], nodes: [] } } },
      beforeExpiry,
    ),
  ).toThrow("Unapproved");
  expect(() =>
    verifyAudit({ error: "registry unavailable" }, beforeExpiry),
  ).toThrow("valid vulnerability graph");
});
