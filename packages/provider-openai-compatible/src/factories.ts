import type { ModelProvider } from "@truss-harness/runtime";
import type {
  CloudModelConfiguration,
  CloudTextGenerationOptions,
  LocalModelConfiguration,
  LocalTextGenerationOptions,
} from "./contracts.js";
import { normalizeLocalBaseUrl } from "./discovery.js";
import { cloudProviderDefinition } from "./provider-catalog.js";
import { OllamaProvider, OpenAICompatibleProvider } from "./providers.js";

export function createLocalModelProvider(
  configuration: LocalModelConfiguration,
): ModelProvider {
  if (configuration.kind === "ollama") {
    return new OllamaProvider({
      baseUrl: configuration.baseUrl,
      model: configuration.model,
      apiKey: configuration.apiKey,
      credential: configuration.credential,
    });
  }
  return new OpenAICompatibleProvider({
    baseUrl: configuration.baseUrl,
    model: configuration.model,
    apiKey: configuration.apiKey,
    credential: configuration.credential,
  });
}

/** Creates a BYOK cloud adapter while keeping credentials outside configuration. */
export function createCloudModelProvider(
  configuration: CloudModelConfiguration,
): ModelProvider {
  const definition = cloudProviderDefinition(configuration.provider);
  if (definition.compatibility === "ollama-api") {
    return new OllamaProvider({
      id: definition.id,
      baseUrl: definition.baseUrl,
      model: configuration.model,
      credential: configuration.credential,
      headers: configuration.headers,
      fetch: configuration.fetch,
    });
  }
  return new OpenAICompatibleProvider({
    id: definition.id,
    baseUrl: definition.baseUrl,
    model: configuration.model,
    credential: configuration.credential,
    headers: configuration.headers,
    fetch: configuration.fetch,
  });
}

/** Generates one non-streaming response for small local actions. */
export async function generateLocalText(
  configuration: LocalModelConfiguration,
  prompt: string,
  options: LocalTextGenerationOptions = {},
): Promise<string> {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const endpoint =
    configuration.kind === "ollama"
      ? `${configuration.baseUrl.replace(/\/$/, "")}/api/chat`
      : `${normalizeLocalBaseUrl(configuration.kind, configuration.baseUrl)}/chat/completions`;
  const response = await requestFetch(endpoint, {
    method: "POST",
    signal: options.signal,
    headers: {
      "content-type": "application/json",
      ...(configuration.apiKey
        ? { authorization: `Bearer ${configuration.apiKey}` }
        : {}),
    },
    body: JSON.stringify({
      model: configuration.model,
      stream: false,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok)
    throw new Error(
      `Model request failed (${response.status}): ${await response.text()}`,
    );

  const payload = (await response.json()) as {
    readonly message?: { readonly content?: unknown };
    readonly response?: unknown;
    readonly choices?: readonly {
      readonly message?: { readonly content?: unknown };
      readonly text?: unknown;
    }[];
  };
  const content =
    configuration.kind === "ollama"
      ? (payload.message?.content ?? payload.response)
      : (payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.text);
  if (typeof content !== "string" || !content.trim())
    throw new Error("The model returned an empty response.");
  return content;
}

/** Generates a short completion through a configured cloud provider adapter. */
export async function generateCloudText(
  configuration: CloudModelConfiguration,
  prompt: string,
  options: CloudTextGenerationOptions = {},
): Promise<string> {
  const provider = createCloudModelProvider({
    ...configuration,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  let content = "";
  for await (const event of provider.stream({
    messages: [{ role: "user", content: prompt }],
    tools: [],
    signal: options.signal,
  })) {
    if (event.type === "text_delta") content += event.text;
    else if (event.type === "error") throw event.error;
  }
  if (!content.trim()) throw new Error("The model returned an empty response.");
  return content;
}
