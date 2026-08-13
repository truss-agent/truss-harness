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

export interface AgentToolExecutorOptions {
  readonly tools: ToolRegistry;
  readonly workspaceRoot: string;
  readonly approval?: ToolApproval;
  emit(event: RuntimeEvent): Promise<void>;
}

export type AgentToolExecution = WorkspaceToolRecord & {
  readonly recoveryRequired?: boolean;
};

export class AgentToolExecutor {
  constructor(private readonly options: AgentToolExecutorOptions) {}

  async execute(
    session: Session,
    call: ToolCall,
    signal?: AbortSignal,
    preflightError?: string,
  ): Promise<AgentToolExecution> {
    const { id: callId, name: tool, input } = call;
    await this.options.emit({
      type: "tool_call_requested",
      sessionId: session.id,
      callId,
      tool,
      input,
    });
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
    } else if (
      !(await (this.options.approval ?? allowAllTools).approve(call, session))
    ) {
      result = { content: `Tool call denied: ${tool}`, isError: true };
    } else {
      try {
        result = await implementation.execute(input, {
          workspaceRoot: this.options.workspaceRoot,
          signal,
        });
      } catch (error) {
        result = {
          content: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}\n\nRECOVERY: ${toolFailureRecovery(tool)}`,
          isError: true,
        };
      }
    }
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
    const recoveryRequired =
      tool === "replace_in_file" &&
      result.isError &&
      !result.content.startsWith("Tool call denied:") &&
      !result.content.startsWith("Unknown tool:");
    return { name: tool, succeeded: !result.isError, recoveryRequired };
  }
}
