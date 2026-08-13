import type {
  CredentialProvider,
  ModelProvider,
  ModelRequest,
  ModelStreamEvent,
  ModelTokenUsage,
  ResolvedCredential,
  ToolCall,
} from "@truss-harness/runtime";
import { ApiKeyCredential } from "@truss-harness/runtime";
import type { OpenAICompatibleProviderOptions } from "./contracts.js";
import { normalizeLocalBaseUrl } from "./discovery.js";
import { requestError } from "./errors.js";
import {
  appendChunk,
  contentText,
  finishReason,
  type OpenAIChunk,
  type PartialToolCall,
  parseToolCalls,
  tokenUsage,
  toOpenAIMessage,
  toOpenAITool,
} from "./wire.js";

function applyCredential(
  headers: Headers,
  credential: Exclude<ResolvedCredential, { readonly kind: "request-signer" }>,
): void {
  if (credential.kind === "bearer")
    headers.set("authorization", `Bearer ${credential.token}`);
  else headers.set(credential.name, credential.value);
}

/** A provider adapter for OpenAI-compatible chat-completions endpoints. */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly requestFetch: typeof globalThis.fetch;

  constructor(private readonly options: OpenAICompatibleProviderOptions) {
    this.id = options.id ?? "openai-compatible";
    this.endpoint = `${normalizeLocalBaseUrl("openai-compatible", options.baseUrl)}/chat/completions`;
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
    const payload = {
      model: this.options.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: request.messages.map(toOpenAIMessage),
      ...(request.tools.length
        ? {
            tools: request.tools.map(toOpenAITool),
            ...(this.id === "openrouter"
              ? {
                  tool_choice: "auto",
                  provider: { require_parameters: true },
                }
              : {}),
          }
        : {}),
    };
    const body = JSON.stringify(payload);
    const credential = this.credential();
    const attempt = async (): Promise<Response> => {
      const headers = new Headers({
        "content-type": "application/json",
        accept: "text/event-stream",
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
      throw await requestError(response, "Model", this.options.model);
    if (!response.body)
      throw new Error("Model response did not include a stream");

    const partialCalls = new Map<number, PartialToolCall>();
    let finalReason: "stop" | "tool_calls" | "length" = "stop";
    let receivedChunk = false;
    let receivedText = false;

    const processData = (
      data: string,
    ): {
      readonly done: boolean;
      readonly text?: string;
      readonly usage?: ModelTokenUsage;
    } => {
      if (data === "[DONE]") return { done: true };

      let chunk: OpenAIChunk;
      try {
        chunk = JSON.parse(data) as OpenAIChunk;
      } catch {
        throw new Error("Model response contained invalid JSON.");
      }
      if (chunk.error !== undefined)
        throw new Error("Model provider returned an error response.");

      const choice = chunk.choices?.[0];
      const usage = tokenUsage(chunk.usage);
      if (!choice) return { done: false, ...(usage ? { usage } : {}) };
      receivedChunk = true;
      const text = contentText(
        choice.delta?.content ?? choice.message?.content,
      );
      if (text) receivedText = true;
      appendChunk(partialCalls, choice);
      if (choice.finish_reason)
        finalReason = finishReason(choice.finish_reason);
      return {
        done: false,
        ...(text ? { text } : {}),
        ...(usage ? { usage } : {}),
      };
    };

    let usage: ModelTokenUsage | undefined;
    const finish = (): {
      readonly calls: ToolCall[];
      readonly reason: "stop" | "tool_calls" | "length";
    } => {
      const calls = parseToolCalls(partialCalls);
      if (!receivedText && calls.length === 0) {
        throw new Error("Model response did not include text or tool calls.");
      }
      return { calls, reason: finalReason };
    };

    const contentType =
      response.headers.get("content-type")?.toLowerCase() ?? "";
    if (
      contentType.includes("application/json") ||
      contentType.includes("+json")
    ) {
      const result = processData(await response.text());
      usage = result.usage ?? usage;
      if (result.text) yield { type: "text_delta", text: result.text };
      const completed = finish();
      for (const call of completed.calls) yield { type: "tool_call", ...call };
      yield {
        type: "finish",
        reason: completed.reason,
        ...(usage ? { usage } : {}),
      };
      return;
    }

    const decoder = new TextDecoder();
    let buffered = "";

    for await (const bytes of response.body) {
      buffered += decoder.decode(bytes, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        const data = line.startsWith("data:") ? line.slice(5).trim() : "";
        if (!data) continue;
        const result = processData(data);
        usage = result.usage ?? usage;
        if (result.text) yield { type: "text_delta", text: result.text };
        if (result.done) {
          const completed = finish();
          for (const call of completed.calls)
            yield { type: "tool_call", ...call };
          yield {
            type: "finish",
            reason: completed.reason,
            ...(usage ? { usage } : {}),
          };
          return;
        }
      }
    }

    // Some local OpenAI-compatible servers close after the final JSON event rather
    // than sending the optional OpenAI [DONE] marker. Process that buffered event
    // and accept a clean close after at least one valid chunk.
    buffered += decoder.decode();
    const trailingLines = buffered
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of trailingLines) {
      const data = line.startsWith("data:") ? line.slice(5).trim() : line;
      const result = processData(data);
      usage = result.usage ?? usage;
      if (result.text) yield { type: "text_delta", text: result.text };
      if (result.done) {
        const completed = finish();
        for (const call of completed.calls)
          yield { type: "tool_call", ...call };
        yield {
          type: "finish",
          reason: completed.reason,
          ...(usage ? { usage } : {}),
        };
        return;
      }
    }
    if (receivedChunk) {
      const completed = finish();
      for (const call of completed.calls) yield { type: "tool_call", ...call };
      yield {
        type: "finish",
        reason: completed.reason,
        ...(usage ? { usage } : {}),
      };
      return;
    }

    throw new Error("Model stream ended before its [DONE] marker");
  }
}
