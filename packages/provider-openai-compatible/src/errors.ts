import { ModelRequestError } from "@truss-harness/runtime";

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

/** Maps provider responses to credential-safe runtime errors and retry data. */
export async function requestError(
  response: Response,
  label: string,
  model: string,
): Promise<ModelRequestError> {
  const detail = await providerErrorDetail(response);
  let rateLimited =
    response.status === 429 ||
    (response.status === 400 && response.headers.has("retry-after"));
  if (!rateLimited)
    rateLimited = /rate.?limit|too.?many.?requests/i.test(detail);
  return new ModelRequestError(
    rateLimited
      ? rateLimitMessage(label, model, detail)
      : requestFailureMessage(label, response.status),
    {
      status: rateLimited ? 429 : response.status,
      retryAfterMs: retryAfterMs(response) ?? retryDelayFromMessage(detail),
    },
  );
}

async function providerErrorDetail(response: Response): Promise<string> {
  // Inspect only to classify the failure. Raw provider text is never surfaced.
  const text = (await response.text().catch(() => "")).slice(0, 32_000);
  if (!text) return "";
  try {
    return safeErrorFields(JSON.parse(text));
  } catch {
    return text;
  }
}

function safeErrorFields(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(safeErrorFields).join(" ");
  const record = value as Record<string, unknown>;
  return ["error", "message", "type", "code", "detail"]
    .flatMap((key) => safeErrorFields(record[key]))
    .join(" ");
}

function retryDelayFromMessage(message: string): number | undefined {
  const seconds = /try again in\s+([\d.]+)\s*s(?:econds?)?/i.exec(message)?.[1];
  const delay = seconds ? Number(seconds) : Number.NaN;
  return Number.isFinite(delay) ? Math.max(0, delay * 1_000) : undefined;
}

function rateLimitMessage(
  label: string,
  model: string,
  detail: string,
): string {
  const numberAfter = (pattern: RegExp): string | undefined =>
    pattern.exec(detail)?.[1]?.replace(/,+$/, "");
  const limit = numberAfter(/\blimit\s+([\d,]+)/i);
  const used = numberAfter(/\bused\s+([\d,]+)/i);
  const requested = numberAfter(/\brequested\s+([\d,]+)/i);
  const budget = [
    limit ? `limit ${limit} tokens per minute` : undefined,
    used ? `${used} used` : undefined,
    requested ? `${requested} requested` : undefined,
  ]
    .filter(Boolean)
    .join("; ");
  return `${label} rate limit reached for ${model}.${budget ? ` ${budget}.` : ""}`;
}

function requestFailureMessage(label: string, status: number): string {
  if (status === 400)
    return `${label} request was rejected (400). Check the selected model, context size, and whether the model supports requested tools.`;
  if (status === 401 || status === 403)
    return `${label} rejected the configured API key (${status}).`;
  if (status === 402)
    return `${label} account has insufficient credit or billing is not enabled.`;
  if (status === 404)
    return `${label} could not find the selected model or endpoint.`;
  if (status >= 500) return `${label} is temporarily unavailable (${status}).`;
  return `${label} request failed (${status}).`;
}
