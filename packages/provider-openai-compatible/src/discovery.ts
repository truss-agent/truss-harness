import type {
  DetectedLocalModel,
  LocalEndpointKind,
  LocalModel,
  LocalModelEndpoint,
} from "./contracts.js";

/**
 * LM Studio exposes OpenAI-compatible routes below /v1. Older Truss settings
 * sometimes stored its root URL, so repair only that well-known local default.
 * Custom compatible endpoints are otherwise preserved exactly as configured.
 */
export function normalizeLocalBaseUrl(
  kind: LocalEndpointKind,
  baseUrl: string,
): string {
  const normalized = baseUrl.trim().replace(/\/$/, "");
  if (kind !== "openai-compatible") return normalized;
  try {
    const url = new URL(normalized);
    const isLocalLmStudio =
      ["127.0.0.1", "localhost", "::1"].includes(url.hostname) &&
      url.port === "1234" &&
      (url.pathname === "" || url.pathname === "/");
    return isLocalLmStudio ? `${url.origin}/v1` : normalized;
  } catch {
    return normalized;
  }
}

const defaultLocalEndpoints: readonly LocalModelEndpoint[] = [
  {
    id: "ollama",
    label: "Ollama",
    kind: "ollama",
    baseUrl: "http://127.0.0.1:11434",
  },
  {
    id: "lm-studio",
    label: "LM Studio",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
  },
  {
    id: "llama-cpp",
    label: "llama.cpp server",
    kind: "openai-compatible",
    baseUrl: "http://127.0.0.1:8080/v1",
  },
];

function modelsUrl(endpoint: LocalModelEndpoint): string {
  return endpoint.kind === "ollama"
    ? `${endpoint.baseUrl.replace(/\/$/, "")}/api/tags`
    : `${normalizeLocalBaseUrl(endpoint.kind, endpoint.baseUrl)}/models`;
}

/** Lists models advertised by a local endpoint. */
export async function listLocalModels(
  endpoint: LocalModelEndpoint,
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {},
): Promise<readonly LocalModel[]> {
  const response = await (options.fetch ?? globalThis.fetch)(
    modelsUrl(endpoint),
    { signal: options.signal },
  );
  if (!response.ok)
    throw new Error(
      `${endpoint.label} model discovery failed (${response.status}).`,
    );
  const payload = (await response.json()) as {
    readonly models?: readonly {
      readonly name?: string;
      readonly model?: string;
    }[];
    readonly data?: readonly { readonly id: string }[];
  };
  if (endpoint.kind === "ollama") {
    return (payload.models ?? []).flatMap((model) => {
      const name = model.name ?? model.model;
      return name ? [{ id: name, name }] : [];
    });
  }
  return (payload.data ?? []).map((model) => ({
    id: model.id,
    name: model.id,
  }));
}

async function listActiveOllamaModels(
  endpoint: LocalModelEndpoint,
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {},
): Promise<readonly LocalModel[]> {
  const response = await (options.fetch ?? globalThis.fetch)(
    `${endpoint.baseUrl.replace(/\/$/, "")}/api/ps`,
    { signal: options.signal },
  );
  if (!response.ok) return [];
  const payload = (await response.json()) as {
    readonly models?: readonly {
      readonly name?: string;
      readonly model?: string;
    }[];
  };
  return (payload.models ?? []).flatMap((model) => {
    const name = model.name ?? model.model;
    return name ? [{ id: name, name }] : [];
  });
}

/** Detects standard local model servers without assuming one is installed. */
export async function detectLocalEndpoints(
  options: {
    fetch?: typeof globalThis.fetch;
    endpoints?: readonly LocalModelEndpoint[];
  } = {},
): Promise<readonly LocalModelEndpoint[]> {
  const endpoints = options.endpoints ?? defaultLocalEndpoints;
  const requestFetch = options.fetch ?? globalThis.fetch;
  const available = await Promise.all(
    endpoints.map(async (endpoint) => {
      try {
        await listLocalModels(endpoint, {
          fetch: requestFetch,
          signal: AbortSignal.timeout(750),
        });
        return endpoint;
      } catch {
        return undefined;
      }
    }),
  );
  return available.filter(
    (endpoint): endpoint is LocalModelEndpoint => endpoint !== undefined,
  );
}

/** Finds a usable model, preferring one Ollama reports as currently running. */
export async function detectActiveLocalModel(
  options: {
    fetch?: typeof globalThis.fetch;
    endpoints?: readonly LocalModelEndpoint[];
  } = {},
): Promise<DetectedLocalModel | undefined> {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const endpoints =
    options.endpoints ?? (await detectLocalEndpoints({ fetch: requestFetch }));
  for (const endpoint of endpoints) {
    if (endpoint.kind === "ollama") {
      try {
        const active = await listActiveOllamaModels(endpoint, {
          fetch: requestFetch,
          signal: AbortSignal.timeout(750),
        });
        if (active[0]) return { endpoint, model: active[0], active: true };
      } catch {
        // Installed models remain a useful fallback.
      }
    }
    try {
      const models = await listLocalModels(endpoint, {
        fetch: requestFetch,
        signal: AbortSignal.timeout(750),
      });
      if (models[0]) return { endpoint, model: models[0], active: false };
    } catch {
      // Try the next detected endpoint.
    }
  }
  return undefined;
}

/** Reads LM Studio's configured context window when available. */
export async function detectLocalContextWindow(
  endpoint: LocalModelEndpoint,
  model: string,
  options: { fetch?: typeof globalThis.fetch; signal?: AbortSignal } = {},
): Promise<number | undefined> {
  if (endpoint.kind !== "openai-compatible" || !model.trim()) return undefined;
  let base: URL;
  try {
    base = new URL(endpoint.baseUrl);
  } catch {
    return undefined;
  }
  const response = await (options.fetch ?? globalThis.fetch)(
    new URL("/api/v1/models", base.origin),
    { signal: options.signal },
  );
  if (!response.ok) return undefined;
  type ContextConfig = {
    readonly context_length?: number;
    readonly contextLength?: number;
    readonly context_window?: number;
    readonly n_ctx?: number;
  };
  type ModelInstance = {
    readonly id?: string;
    readonly config?: ContextConfig;
  };
  type DiscoveredModel = ContextConfig & {
    readonly id?: string;
    readonly key?: string;
    readonly model?: string;
    readonly name?: string;
    readonly display_name?: string;
    readonly config?: ContextConfig;
    readonly loaded_instances?: readonly ModelInstance[];
  };
  const payload = (await response.json()) as {
    readonly data?: readonly DiscoveredModel[];
    readonly models?: readonly DiscoveredModel[];
  };
  const models = payload.models ?? payload.data ?? [];
  const item = models.find((candidate) =>
    [
      candidate.id,
      candidate.key,
      candidate.model,
      candidate.name,
      candidate.display_name,
      ...(candidate.loaded_instances?.map((instance) => instance.id) ?? []),
    ].includes(model),
  );
  if (!item) return undefined;

  const values = [
    item.loaded_instances?.find((instance) => instance.id === model)?.config,
    item.loaded_instances?.[0]?.config,
    item.config,
    item,
  ].flatMap((source) =>
    source
      ? [
          source.context_length,
          source.contextLength,
          source.context_window,
          source.n_ctx,
        ]
      : [],
  );
  const value = values.find(
    (candidate) =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= 512,
  );
  return typeof value === "number" ? Math.floor(value) : undefined;
}
