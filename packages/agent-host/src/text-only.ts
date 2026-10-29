import type { ModelProvider } from "@truss-harness/runtime";

/** A provider response cannot turn a helper into an agent operation. */
export function textOnlyProvider(provider: ModelProvider): ModelProvider {
  return {
    id: provider.id,
    async *stream(request) {
      for await (const event of provider.stream({ ...request, tools: [] })) {
        if (event.type === "tool_call")
          throw new Error("Text-only generation does not allow tool calls.");
        yield event;
      }
    },
  };
}
