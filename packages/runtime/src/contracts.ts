import type { WorkspacePlan } from "./plans.js";

/** JSON-compatible values passed between the runtime, providers, and tools. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type JsonSchema = JsonObject & { readonly type: "object" };

/** A client-supplied chat attachment. Image payloads are forwarded by capable providers; file text is supplied as context. */
export interface ChatAttachment {
  readonly id: string;
  readonly kind: "image" | "file";
  readonly name: string;
  readonly mediaType: string;
  /** Data URL for image attachments. Kept client-neutral so persisted sessions can be replayed. */
  readonly data?: string;
  /** Bounded UTF-8 text extracted from a generic file attachment. */
  readonly text?: string;
  readonly size: number;
}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly attachments?: readonly ChatAttachment[];
  readonly name?: string;
  readonly toolCallId?: string;
  /** Present on assistant messages that requested one or more tools. */
  readonly toolCalls?: readonly ToolCall[];
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: JsonObject;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

export interface ModelRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolDefinition[];
  readonly signal?: AbortSignal;
}

export type ModelStreamEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | ({ readonly type: "tool_call" } & ToolCall)
  | { readonly type: "finish"; readonly reason: "stop" | "tool_calls" | "length" }
  | { readonly type: "error"; readonly error: Error };

/** Provider adapters translate their native streaming protocol into this contract. */
export interface ModelProvider {
  readonly id: string;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}

export interface ToolExecutionContext {
  readonly workspaceRoot: string;
  readonly signal?: AbortSignal;
}

export interface ToolResult {
  readonly content: string;
  readonly isError?: boolean;
}

export interface AgentTool extends ToolDefinition {
  execute(input: JsonObject, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface Session {
  readonly id: string;
  readonly createdAt: Date;
  updatedAt: Date;
  messages: ChatMessage[];
  checkpoint?: SessionCheckpoint;
}

export interface SessionCheckpoint {
  readonly messages: readonly ChatMessage[];
  readonly createdAt: Date;
}

export type RuntimeEvent =
  | { readonly type: "run_started"; readonly sessionId: string }
  /** Short user-visible execution note, never hidden chain-of-thought. */
  | { readonly type: "progress_delta"; readonly sessionId: string; readonly text: string }
  | { readonly type: "text_delta"; readonly sessionId: string; readonly text: string }
  | { readonly type: "tool_call_requested"; readonly sessionId: string; readonly callId: string; readonly tool: string; readonly input: JsonObject }
  | { readonly type: "tool_completed"; readonly sessionId: string; readonly callId: string; readonly tool: string; readonly result: ToolResult }
  | { readonly type: "plan_updated"; readonly sessionId: string; readonly plan: WorkspacePlan }
  | { readonly type: "run_completed"; readonly sessionId: string; readonly modifiedFiles: readonly string[] }
  | { readonly type: "run_failed"; readonly sessionId: string; readonly error: Error };
