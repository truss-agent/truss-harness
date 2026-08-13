import type { ContextManager } from "../context.js";
import type { ModelProvider, Session, ToolCall } from "../contracts.js";
import type { RuntimeEventBus } from "../events.js";
import type { WorkspaceMemoryStore } from "../memory.js";
import type { WorkspacePlanStore } from "../plans.js";
import type { ModelRetryPolicy } from "../retry.js";
import type { SessionStore } from "../sessions.js";
import type { ToolRegistry } from "../tools.js";

export interface ToolApproval {
  approve(call: ToolCall, session: Session): Promise<boolean>;
}

export const allowAllTools: ToolApproval = { approve: async () => true };

/** A generous safety ceiling for multi-step workspace tasks; callers may still override it. */
export const defaultAgentMaxTurns = 64;

export interface AgentRuntimeOptions {
  readonly provider: ModelProvider;
  readonly tools: ToolRegistry;
  readonly sessions: SessionStore;
  readonly context: ContextManager;
  readonly events: RuntimeEventBus;
  readonly workspaceRoot: string;
  readonly approval?: ToolApproval;
  readonly systemPrompt?: string;
  readonly maxTurns?: number;
  readonly memory?: WorkspaceMemoryStore;
  readonly plans?: WorkspacePlanStore;
  readonly savePlanOnCompletion?: boolean;
  readonly requireWriteForEditIntent?: boolean;
  readonly deferTextUntilToolDecision?: boolean;
  readonly modelRetryPolicy?: ModelRetryPolicy;
}
