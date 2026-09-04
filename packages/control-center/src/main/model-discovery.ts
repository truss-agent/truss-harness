import {
  detectLocalEndpoints,
  type LocalModelEndpoint,
  listLocalModels,
  normalizeLocalBaseUrl,
} from "@truss-harness/provider-openai-compatible";
import type { ControlLocalEndpoint } from "../shared.js";

export function controlEndpoint(
  providerId: ControlLocalEndpoint["providerId"],
  endpointUrl: string,
): LocalModelEndpoint {
  const kind = providerId === "ollama" ? "ollama" : "openai-compatible";
  const label =
    providerId === "ollama"
      ? "Ollama"
      : providerId === "llama-cpp"
        ? "llama.cpp server"
        : "OpenAI-compatible server";
  return {
    id: providerId,
    label,
    kind,
    baseUrl: normalizeLocalBaseUrl(kind, endpointUrl),
  };
}

export async function discoverControlLocalEndpoints(): Promise<
  readonly ControlLocalEndpoint[]
> {
  return (await detectLocalEndpoints()).map((endpoint) => ({
    providerId:
      endpoint.id === "ollama"
        ? "ollama"
        : endpoint.id === "llama-cpp"
          ? "llama-cpp"
          : "openai-compatible",
    label: endpoint.label,
    baseUrl: endpoint.baseUrl,
  }));
}

export async function discoverControlModels(
  providerId: ControlLocalEndpoint["providerId"],
  endpointUrl: string,
): Promise<readonly string[]> {
  const endpoint = controlEndpoint(providerId, endpointUrl);
  return (await listLocalModels(endpoint)).map((model) => model.name);
}
