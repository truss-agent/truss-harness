import { describe, expect, it } from "vitest";
import {
  allApprovalModes,
  parsePairing,
  parsePreferences,
  upsertGateway,
} from "./pairing.js";

describe("mobile pairing", () => {
  it("parses a complete trusted Truss pairing URI", () => {
    expect(
      parsePairing(
        "truss://pair?gateway=http%3A%2F%2F192.168.1.20%3A4787&token=abcdefghijklmnopqrstuvwxyz&name=Studio",
      ),
    ).toEqual({
      id: "http://192.168.1.20:4787",
      name: "Studio",
      url: "http://192.168.1.20:4787",
      token: "abcdefghijklmnopqrstuvwxyz",
    });
  });

  it("rejects incomplete or non-Truss pairing input", () => {
    expect(() => parsePairing("https://example.com")).toThrow(
      "This is not a Truss pairing QR code.",
    );
    expect(() => parsePairing("truss://pair?gateway=http://host")).toThrow(
      "The pairing QR code is incomplete.",
    );
  });

  it("normalizes stored preferences and deduplicates saved gateways", () => {
    expect(
      parsePreferences('{"mode":"edit","approvalMode":"auto-read"}'),
    ).toEqual({ mode: "edit", approvalMode: "auto-read" });
    expect(parsePreferences('{"mode":"nope","approvalMode":"nope"}')).toEqual(
      {},
    );
    expect(allApprovalModes).toEqual(["ask", "auto-read", "auto-all"]);
    expect(
      upsertGateway(
        [
          {
            id: "one",
            name: "Old",
            url: "http://one",
            token: "old-token",
          },
          {
            id: "two",
            name: "Two",
            url: "http://two",
            token: "two-token",
          },
        ],
        {
          id: "one",
          name: "New",
          url: "http://one",
          token: "new-token",
        },
      ),
    ).toEqual([
      {
        id: "one",
        name: "New",
        url: "http://one",
        token: "new-token",
      },
      { id: "two", name: "Two", url: "http://two", token: "two-token" },
    ]);
  });
});
