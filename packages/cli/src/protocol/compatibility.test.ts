import { describe, expect, it } from "vitest";
import { validateRuntimeServiceHandshake } from "./compatibility.js";

describe("validateRuntimeServiceHandshake", () => {
  it("accepts a negotiated Truss runtime protocol", () => {
    expect(
      validateRuntimeServiceHandshake(
        {
          protocolVersion: 1,
          server: {
            name: "truss-cli",
            version: "0.1.21",
            identity: {
              runtime: {
                packageName: "@truss-harness/runtime",
                version: "0.1.10",
              },
              protocolVersions: [1],
            },
          },
        },
        [1],
      ),
    ).toEqual({
      compatible: true,
      protocolVersion: 1,
      runtime: {
        packageName: "@truss-harness/runtime",
        version: "0.1.10",
      },
    });
  });

  it("rejects a legacy or incompatible service before it runs a chat", () => {
    expect(validateRuntimeServiceHandshake({}, [1])).toEqual({
      compatible: false,
      reason: "The service did not negotiate a compatible protocol version.",
    });
    expect(
      validateRuntimeServiceHandshake(
        {
          protocolVersion: 1,
          server: { name: "truss-cli", version: "0.1.20" },
        },
        [1],
      ),
    ).toEqual({
      compatible: false,
      reason: "The service did not provide a compatible Truss runtime identity.",
    });
  });
});
