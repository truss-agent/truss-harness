import type {
  CredentialProvider,
  JsonObject,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
  ResolvedCredential,
} from "@truss-harness/runtime";
import { ApiKeyCredential } from "@truss-harness/runtime";
import type { OpenAICompatibleProviderOptions } from "./contracts.js";
import { requestError } from "./errors.js";
import { tokenUsage, toOllamaMessage, toOpenAITool } from "./wire.js";

function applyCredential(
  headers: Headers,
  credential: Exclude<ResolvedCredential, { readonly kind: "request-signer" }>,
): void {
  if (credential.kind === "bearer")
    headers.set("authorization", `Bearer ${credential.token}`);
  else headers.set(credential.name, credential.value);
}

/** Native Ollama adapter preserving local tool-calling semantics. */
export class OllamaProvider implements ModelProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly requestFetch: typeof globalThis.fetch;
  private readonly options: Omit<OpenAICompatibleProviderOptions, "id">;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.id = options.id ?? "ollama";
    this.endpoint = `${options.baseUrl.replace(/\/$/, "")}/api/chat`;
    this.options = options;
    this.requestFetch = options.fetch ?? globalThis.fetch;
  }

  private credential(): CredentialProvider | undefined {
    return (
      this.options.credential ??
      (this.options.apiKey
        ? new ApiKeyCredential(`${this.id}-api-key`, this.options.apiKey)
        : undefined)
    );
  }

  private async send(request: ModelRequest): Promise<Response> {
    const body = JSON.stringify({
      model: this.options.model,
      stream: true,
      messages: request.messages.map(toOllamaMessage),
      tools: request.tools.map(toOpenAITool),
    });
    const credential = this.credential();
    const attempt = async (): Promise<Response> => {
      const headers = new Headers({
        "content-type": "application/json",
        ...this.options.headers,
      });
      const resolved = await credential?.resolve();
      if (resolved?.kind === "request-signer") {
        return this.requestFetch(
          await resolved.sign(
            new Request(this.endpoint, {
              method: "POST",
              signal: request.signal,
              headers,
              body,
            }),
          ),
        );
      }
      if (resolved) applyCredential(headers, resolved);
      return this.requestFetch(this.endpoint, {
        method: "POST",
        signal: request.signal,
        headers,
        body,
      });
    };

    let response = await attempt();
    if (
      (response.status === 401 || response.status === 403) &&
      credential?.refresh
    ) {
      await response.body?.cancel();
      await credential.refresh();
      response = await attempt();
    }
    return response;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const response = await this.send(request);
    if (!response.ok)
      throw await requestError(response, "Ollama", this.options.model);
    if (!response.body)
      throw new Error("Ollama response did not include a stream");

    const decoder = new TextDecoder();
    let buffered = "";
    let callIndex = 0;
    for await (const bytes of response.body) {
      buffered += decoder.decode(bytes, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line) as {
          readonly message?: {
            readonly content?: string;
            readonly tool_calls?: readonly {
              readonly function: {
                readonly name: string;
                readonly arguments: JsonObject;
              };
            }[];
          };
          readonly done?: boolean;
          readonly done_reason?: "stop" | "length";
          readonly prompt_eval_count?: number;
          readonly eval_count?: number;
        };
        if (chunk.message?.content)
          yield { type: "text_delta", text: chunk.message.content };
        for (const toolCall of chunk.message?.tool_calls ?? []) {
          yield {
            type: "tool_call",
            id: `ollama-${++callIndex}`,
            name: toolCall.function.name,
            input: toolCall.function.arguments,
          };
        }
        if (chunk.done) {
          const usage = tokenUsage(chunk);
          yield {
            type: "finish",
            reason: chunk.done_reason === "length" ? "length" : "stop",
            ...(usage ? { usage } : {}),
          };
          return;
        }
      }
    }
    throw new Error("Ollama stream ended before its final response.");
  }
}
