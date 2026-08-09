import { describe, expect, it } from "vitest";
import { previewServerUrlFromOutput } from "./preview-url.js";

describe("previewServerUrlFromOutput", () => {
  it("uses the actual port announced by a server", () => {
    expect(
      previewServerUrlFromOutput(
        "Error: port 3000 is already in use\nINFO  Accepting connections at http://localhost:45541\n",
      ),
    ).toBe("http://localhost:45541/");
  });

  it("uses common local server announcements and connects to all interfaces locally", () => {
    expect(
      previewServerUrlFromOutput(
        "Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...\n",
      ),
    ).toBe("http://127.0.0.1:8000/");
    expect(
      previewServerUrlFromOutput("  Local:   http://localhost:5173/\n"),
    ).toBe("http://localhost:5173/");
  });

  it("does not treat an arbitrary local URL as a server preview", () => {
    expect(
      previewServerUrlFromOutput("curl http://localhost:4567/health\n"),
    ).toBeUndefined();
  });
});
