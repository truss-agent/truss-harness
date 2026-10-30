import type { CloudProviderDefinition, CloudProviderId } from "./contracts.js";

/** A model a cloud provider lists, with the metadata clients show when choosing one. */
export interface CloudModelInfo {
  readonly id: string;
  readonly contextWindow?: number;
  /** USD per one million input tokens, when published by the provider. */
  readonly inputCostPerMillion?: number;
  /** USD per one million output tokens, when published by the provider. */
  readonly outputCostPerMillion?: number;
  readonly supportsTools?: boolean;
  readonly kind?:
    | "chat"
    | "embedding"
    | "image"
    | "audio"
    | "moderation"
    | "other";
}

export function publishedContextWindow(
  provider: CloudProviderId,
  modelId: string,
): number | undefined {
  if (provider !== "openai") return undefined;
  const normalized = modelId.toLowerCase();
  return ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(
    normalized,
  )
    ? 1_050_000
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function modelKind(value: unknown): CloudModelInfo["kind"] {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  if (normalized.includes("embed")) return "embedding";
  if (normalized.includes("moderation")) return "moderation";
  if (normalized.includes("image")) return "image";
  if (normalized.includes("audio") || normalized.includes("speech"))
    return "audio";
  if (normalized.includes("chat") || normalized.includes("language"))
    return "chat";
  return "other";
}

export function modelInfoFromRecord(
  value: unknown,
  provider: CloudProviderId,
): CloudModelInfo | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const id = [source.id, source.name, source.model]
    .find(
      (candidate): candidate is string =>
        typeof candidate === "string" && Boolean(candidate.trim()),
    )
    ?.trim();
  if (!id || source.archived === true) return undefined;
  const capabilities = source.capabilities as
    | Record<string, unknown>
    | undefined;
  const supportedParameters = Array.isArray(source.supported_parameters)
    ? source.supported_parameters.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const supportedGenerationMethods = Array.isArray(
    source.supportedGenerationMethods,
  )
    ? source.supportedGenerationMethods.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const kind =
    modelKind(source.type) ??
    modelKind(source.kind) ??
    (/(?:embedding|moderation|rerank|whisper|tts|dall-e|image-generation)/i.test(
      id,
    )
      ? modelKind(id)
      : undefined);
  const pricing = source.pricing as Record<string, unknown> | undefined;
  const inputPrice = finiteNumber(
    pricing?.prompt ??
      pricing?.input ??
      source.input_cost_per_token ??
      source.inputCostPerToken,
  );
  const outputPrice = finiteNumber(
    pricing?.completion ??
      pricing?.output ??
      source.output_cost_per_token ??
      source.outputCostPerToken,
  );
  const pricingMultiplier = provider === "openrouter" ? 1_000_000 : 1;
  const supportsTools =
    supportedParameters.some((item) =>
      ["tools", "tool_choice", "function_calling"].includes(item),
    ) || capabilities?.function_calling === true;
  const contextWindow =
    finiteNumber(
      source.context_length ??
        source.max_context_length ??
        source.contextWindow ??
        source.inputTokenLimit ??
        source.max_input_tokens,
    ) ?? publishedContextWindow(provider, id);
  return {
    id,
    ...(contextWindow ? { contextWindow } : {}),
    ...(inputPrice !== undefined
      ? { inputCostPerMillion: inputPrice * pricingMultiplier }
      : {}),
    ...(outputPrice !== undefined
      ? { outputCostPerMillion: outputPrice * pricingMultiplier }
      : {}),
    ...(kind ? { kind } : {}),
    ...(supportsTools || supportedGenerationMethods.includes("generateContent")
      ? { supportsTools: true }
      : {}),
  };
}

export function usableChatModels(
  models: readonly CloudModelInfo[],
): CloudModelInfo[] {
  return models.filter(
    (model) =>
      model.kind !== "embedding" &&
      model.kind !== "image" &&
      model.kind !== "audio" &&
      model.kind !== "moderation",
  );
}

async function safeFailureDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      readonly error?: { readonly message?: unknown };
      readonly message?: unknown;
    };
    const message = payload.error?.message ?? payload.message;
    if (typeof message !== "string") return "";
    return message
      .replace(/sk-ant-[a-zA-Z0-9_-]+/g, "[redacted]")
      .replace(/bearer\s+[^\s]+/gi, "Bearer [redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240);
  } catch {
    return "";
  }
}

/** Lists cloud models without depending on Electron or credential storage. */
export async function discoverCloudModels(
  definition: CloudProviderDefinition,
  baseUrl: string,
  credential: string,
  requestFetch: typeof fetch = globalThis.fetch,
): Promise<readonly CloudModelInfo[]> {
  const root = baseUrl.replace(/\/$/, "");
  const ollama = definition.compatibility === "ollama-api";
  const anthropic = definition.id === "anthropic";
  let headers: Record<string, string> = anthropic
    ? credential.startsWith("sk-ant-oat")
      ? {
          Authorization: `Bearer ${credential}`,
          "anthropic-version": "2023-06-01",
        }
      : { "x-api-key": credential, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${credential}` };
  const anthropicFallbackHeaders: Record<string, string> | undefined = anthropic
    ? headers.Authorization
      ? { "x-api-key": credential, "anthropic-version": "2023-06-01" }
      : {
          Authorization: `Bearer ${credential}`,
          "anthropic-version": "2023-06-01",
        }
    : undefined;
  const records: unknown[] = [];
  let nextUrl: string | undefined = `${root}/${ollama ? "api/tags" : "models"}`;
  for (let page = 0; nextUrl && page < 20; page += 1) {
    let response = await requestFetch(nextUrl, { headers });
    if (!response.ok && response.status === 400 && anthropicFallbackHeaders) {
      response = await requestFetch(nextUrl, {
        headers: anthropicFallbackHeaders,
      });
      if (response.ok) headers = anthropicFallbackHeaders;
    }
    if (!response.ok) {
      const detail = await safeFailureDetail(response);
      throw new Error(
        `${definition.label} model discovery failed (${response.status})${detail ? `: ${detail}` : "."}`,
      );
    }
    const payload = (await response.json()) as {
      readonly data?: readonly unknown[];
      readonly models?: readonly unknown[];
      readonly nextPageToken?: string;
      readonly has_more?: boolean;
      readonly last_id?: string | null;
    };
    records.push(...(ollama ? (payload.models ?? []) : (payload.data ?? [])));
    const pagedUrl: URL = new URL(nextUrl);
    if (anthropic && payload.has_more && payload.last_id) {
      if (pagedUrl.searchParams.get("after_id") === payload.last_id) break;
      pagedUrl.searchParams.set("after_id", payload.last_id);
      nextUrl = pagedUrl.toString();
    } else if (!anthropic && !ollama && payload.nextPageToken) {
      pagedUrl.searchParams.set("pageToken", payload.nextPageToken);
      nextUrl = pagedUrl.toString();
    } else nextUrl = undefined;
  }
  const models = usableChatModels(
    records.flatMap((record) => {
      const info = modelInfoFromRecord(record, definition.id);
      return info ? [info] : [];
    }),
  );
  return [...new Map(models.map((model) => [model.id, model])).values()];
}
