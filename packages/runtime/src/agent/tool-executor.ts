import { defaultToolOutputBytes, truncateUtf8 } from "../resource-limits.js";
import type {
  RuntimeEvent,
  Session,
  ToolCall,
  ToolResult,
} from "../contracts.js";
import type { WorkspaceToolRecord } from "../memory.js";
import type { ToolRegistry } from "../tools.js";
import { allowAllTools, type ToolApproval } from "./contracts.js";
import { toolFailureRecovery } from "./edit-policy.js";
import { normalizeToolResult } from "./tool-call-normalization.js";

export interface AgentToolExecutorOptions {
  readonly tools: ToolRegistry;
  readonly workspaceRoot: string;
  readonly approval?: ToolApproval;
  readonly maxOutputBytes?: number;
  emit(event: RuntimeEvent): Promise<void>;
}

export type AgentToolExecution = WorkspaceToolRecord & {
  readonly recoveryRequired?: boolean;
  readonly failure?: string;
};

export class AgentToolExecutor {
  constructor(private readonly options: AgentToolExecutorOptions) {}

  private async approve(
    call: ToolCall,
    session: Session,
    signal?: AbortSignal,
  ): Promise<boolean> {
    signal?.throwIfAborted();
    const approved = await (this.options.approval ?? allowAllTools).approve(
      call,
      session,
      { signal },
    );
    signal?.throwIfAborted();
    return approved;
  }

  async execute(
    session: Session,
    call: ToolCall,
    signal?: AbortSignal,
    preflightError?: string,
  ): Promise<AgentToolExecution> {
    signal?.throwIfAborted();
    const { id: callId, name: tool, input } = call;
    await this.options.emit({
      type: "tool_call_requested",
      sessionId: session.id,
      callId,
      tool,
      input,
    });
    signal?.throwIfAborted();
    const implementation = this.options.tools.get(tool);
    let result: ToolResult;
    if (preflightError) {
      result = { content: preflightError, isError: true };
    } else if (!implementation) {
      result = { content: `Unknown tool: ${tool}`, isError: true };
    } else if (call.parseError) {
      result = {
        content: `Tool call was not executed because its arguments could not be parsed: ${call.parseError}\n\nRECOVERY: ${toolFailureRecovery(tool)}`,
        isError: true,
      };
    } else if (!(await this.approve(call, session, signal))) {
      result = { content: `Tool call denied: ${tool}`, isError: true };
    } else {
      try {
        signal?.throwIfAborted();
        result = normalizeToolResult(
          await implementation.execute(input, {
            workspaceRoot: this.options.workspaceRoot,
            signal,
          }),
        );
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof Error && error.name === "AbortError") throw error;
        result = {
          content: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}\n\nRECOVERY: ${toolFailureRecovery(tool)}`,
          isError: true,
        };
      }
    }
    signal?.throwIfAborted();
    result = {
      ...result,
      content: truncateUtf8(
        result.content,
        this.options.maxOutputBytes ?? defaultToolOutputBytes,
      ),
    };
    session.messages.push({
      role: "tool",
      name: tool,
      toolCallId: callId,
      content: result.content,
    });
    await this.options.emit({
      type: "tool_completed",
      sessionId: session.id,
      callId,
      tool,
      result,
    });
    signal?.throwIfAborted();
    const recoveryRequired =
      tool === "replace_in_file" &&
      result.isError &&
      !result.content.startsWith("Tool call denied:") &&
      !result.content.startsWith("Unknown tool:");
    return {
      name: tool,
      succeeded: !result.isError,
      recoveryRequired,
      failure: result.isError ? result.content : undefined,
    };
  }
}
