import { describe, expect, it, vi } from "vitest";
import {
  ModelRequestError,
  withModelRetries,
  type ModelProvider,
  type ModelStreamEvent,
} from "./index.js";

async function collect(provider: ModelProvider): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of provider.stream({ messages: [], tools: [] }))
    events.push(event);
  return events;
}

describe("withModelRetries", () => {
  it("retries a rate-limited request before the stream emits output", async () => {
    let attempts = 0;
    const provider: ModelProvider = {
      id: "fake",
      async *stream() {
        attempts += 1;
        if (attempts === 1)
          throw new ModelRequestError("limited", { status: 429 });
        yield { type: "text_delta", text: "ok" } as const;
      },
    };

    await expect(
      collect(withModelRetries(provider, { baseDelayMs: 0 })),
    ).resolves.toEqual([{ type: "text_delta", text: "ok" }]);
    expect(attempts).toBe(2);
  });

  it("honors a provider retry delay", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const provider: ModelProvider = {
      id: "fake",
      async *stream() {
        attempts += 1;
        if (attempts === 1)
          throw new ModelRequestError("limited", {
            status: 429,
            retryAfterMs: 1_000,
          });
        yield { type: "finish", reason: "stop" } as const;
      },
    };

    const result = collect(withModelRetries(provider, { baseDelayMs: 0 }));
    await vi.advanceTimersByTimeAsync(999);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual([{ type: "finish", reason: "stop" }]);
    expect(attempts).toBe(2);
    vi.useRealTimers();
  });

  it("does not retry invalid requests", async () => {
    let attempts = 0;
    const error = new ModelRequestError("invalid", { status: 400 });
    const provider: ModelProvider = {
      id: "fake",
      async *stream() {
        attempts += 1;
        throw error;
      },
    };

    await expect(
      collect(withModelRetries(provider, { baseDelayMs: 0 })),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it("does not repeat a stream after it emits output", async () => {
    let attempts = 0;
    const error = new ModelRequestError("unavailable", { status: 503 });
    const provider: ModelProvider = {
      id: "fake",
      async *stream() {
        attempts += 1;
        yield { type: "text_delta", text: "partial" } as const;
        throw error;
      },
    };

    await expect(
      collect(withModelRetries(provider, { baseDelayMs: 0 })),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it("retries transient network failures", async () => {
    let attempts = 0;
    const provider: ModelProvider = {
      id: "fake",
      async *stream() {
        attempts += 1;
        if (attempts === 1) throw new TypeError("fetch failed");
        yield { type: "finish", reason: "stop" } as const;
      },
    };

    await expect(
      collect(withModelRetries(provider, { baseDelayMs: 0 })),
    ).resolves.toEqual([{ type: "finish", reason: "stop" }]);
    expect(attempts).toBe(2);
  });
});
