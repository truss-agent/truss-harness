import type {
  CloudProviderDefinition,
  CloudProviderId,
  LocalEndpointKind,
} from "./contracts.js";

export const cloudProviderDefinitions: readonly CloudProviderDefinition[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnvironmentVariable: "OPENAI_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    apiKeyEnvironmentVariable: "ANTHROPIC_API_KEY",
    compatibility: "openai-chat-completions",
    productionNote:
      "Uses Anthropic's evaluation-oriented OpenAI compatibility layer; a native adapter remains the preferred long-term integration.",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnvironmentVariable: "OPENROUTER_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnvironmentVariable: "GROQ_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.ai/v1",
    apiKeyEnvironmentVariable: "TOGETHER_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnvironmentVariable: "GEMINI_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "xai",
    label: "xAI",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnvironmentVariable: "XAI_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "mistral",
    label: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnvironmentVariable: "MISTRAL_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnvironmentVariable: "DEEPSEEK_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    apiKeyEnvironmentVariable: "PERPLEXITY_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    apiKeyEnvironmentVariable: "FIREWORKS_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "nvidia-nim",
    label: "NVIDIA NIM",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKeyEnvironmentVariable: "NVIDIA_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "xiaomi-mimo",
    label: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiKeyEnvironmentVariable: "MIMO_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "sakana-fugu",
    label: "Sakana Fugu",
    baseUrl: "https://api.sakana.ai/v1",
    apiKeyEnvironmentVariable: "SAKANA_API_KEY",
    compatibility: "openai-chat-completions",
  },
  {
    id: "ollama-cloud",
    label: "Ollama Cloud",
    baseUrl: "https://ollama.com",
    apiKeyEnvironmentVariable: "OLLAMA_API_KEY",
    compatibility: "ollama-api",
  },
];

export function isCloudProviderId(value: unknown): value is CloudProviderId {
  return cloudProviderDefinitions.some((definition) => definition.id === value);
}

export function isLocalEndpointKind(
  value: unknown,
): value is LocalEndpointKind {
  return value === "ollama" || value === "openai-compatible";
}

export function cloudProviderDefinition(
  id: CloudProviderId,
): CloudProviderDefinition {
  const definition = cloudProviderDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (!definition) throw new Error(`Unknown cloud model provider: ${id}`);
  return definition;
}
