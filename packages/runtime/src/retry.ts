import {
  ModelRequestError,
  type ModelProvider,
  type ModelRequest,
  type ModelStreamEvent,
} from "./contracts.js";

export interface ModelRetryPolicy {
  /** Total attempts, including the initial provider request. Defaults to 3. */
  readonly maxAttempts?: number;
  /** Initial exponential-backoff delay in milliseconds. Defaults to 1 second. */
  readonly baseDelayMs?: number;
  /** Maximum retry delay in milliseconds. Defaults to 30 seconds. */
  readonly maxDelayMs?: number;
}

export interface ModelRetryAttempt {
  /** The attempt about to begin, starting at 2 after the initial request. */
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs: number;
  readonly reason: "rate_limited" | "transient";
  /** Sanitized provider error text suitable for visible progress. */
  readonly message: string;
}

const defaultPolicy: Required<ModelRetryPolicy> = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isRetryable(error: unknown): error is ModelRequestError | TypeError {
  if (error instanceof ModelRequestError) {
    const status = error.status;
    return (
      status === 408 ||
      status === 425 ||
      status === 429 ||
      Boolean(status && status >= 500)
    );
  }
  // fetch reports connection, DNS, and TLS failures as TypeError.
  return error instanceof TypeError;
}

function retryDelay(
  error: ModelRequestError | TypeError,
  attempt: number,
  policy: Required<ModelRetryPolicy>,
): number {
  if (error instanceof ModelRequestError && error.retryAfterMs !== undefined)
    return Math.min(policy.maxDelayMs, Math.max(0, error.retryAfterMs));
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * Retries transient provider failures before a stream produces output. Once a
 * provider has emitted an event, repeating the request could duplicate text or tools.
 */
export function withModelRetries(
  provider: ModelProvider,
  configuredPolicy: ModelRetryPolicy = {},
  onRetry?: (retry: ModelRetryAttempt) => void | Promise<void>,
): ModelProvider {
  const policy = { ...defaultPolicy, ...configuredPolicy };
  return {
    id: provider.id,
    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      for (let attempt = 0; ; attempt++) {
        let emitted = false;
        try {
          for await (const event of provider.stream(request)) {
            emitted = true;
            yield event;
          }
          return;
        } catch (error) {
          if (
            emitted ||
            request.signal?.aborted ||
            isAbort(error) ||
            !isRetryable(error) ||
            attempt + 1 >= policy.maxAttempts
          )
            throw error;
          const delayMs = retryDelay(error, attempt, policy);
          await onRetry?.({
            attempt: attempt + 2,
            maxAttempts: policy.maxAttempts,
            delayMs,
            reason:
              error instanceof ModelRequestError && error.status === 429
                ? "rate_limited"
                : "transient",
            message: error instanceof Error ? error.message : "Provider request failed.",
          });
          await wait(delayMs, request.signal);
        }
      }
    },
  };
}
