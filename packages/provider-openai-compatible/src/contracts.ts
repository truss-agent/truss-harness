import type { CredentialProvider, ModelProvider } from "@truss-harness/runtime";

export interface OpenAICompatibleProviderOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  /** Preferred over apiKey so credentials can be refreshed or backed by secure storage. */
  readonly credential?: CredentialProvider;
  readonly id?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
}

export type LocalEndpointKind = "ollama" | "openai-compatible";

export interface LocalModelEndpoint {
  readonly id: string;
  readonly label: string;
  readonly kind: LocalEndpointKind;
  readonly baseUrl: string;
}

export interface LocalModel {
  readonly id: string;
  readonly name: string;
}

export interface DetectedLocalModel {
  readonly endpoint: LocalModelEndpoint;
  readonly model: LocalModel;
  /** True only when the server explicitly reports this model as running. */
  readonly active: boolean;
}

export interface LocalModelConfiguration {
  readonly kind: LocalEndpointKind;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly credential?: CredentialProvider;
}

export interface LocalTextGenerationOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

export interface CloudTextGenerationOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
}

export type CloudProviderId =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "groq"
  | "together"
  | "gemini"
  | "xai"
  | "mistral"
  | "deepseek"
  | "perplexity"
  | "fireworks"
  | "nvidia-nim"
  | "xiaomi-mimo"
  | "sakana-fugu"
  | "ollama-cloud";

export type ModelProviderKind = LocalEndpointKind | CloudProviderId;

export interface CloudProviderDefinition {
  readonly id: CloudProviderId;
  readonly label: string;
  readonly baseUrl: string;
  readonly apiKeyEnvironmentVariable: string;
  /** Wire protocol used by the provider's hosted endpoint. */
  readonly compatibility: "openai-chat-completions" | "ollama-api";
  readonly productionNote?: string;
}

export interface CloudModelConfiguration {
  readonly provider: CloudProviderId;
  readonly model: string;
  readonly credential: CredentialProvider;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
}

export type ProviderFactory = (
  configuration: LocalModelConfiguration | CloudModelConfiguration,
) => ModelProvider;
