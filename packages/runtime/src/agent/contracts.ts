import type { ContextManager } from "../context.js";
import type {
  AgentTool,
  ChatMessage,
  ModelProvider,
  Session,
  ToolCall,
} from "../contracts.js";
import type { RuntimeEventBus } from "../events.js";
import type { WorkspaceMemoryStore } from "../memory.js";
import type { WorkspacePlanStore } from "../plans.js";
import type { ModelRetryPolicy } from "../retry.js";
import type { SessionStore } from "../sessions.js";
import type { ToolRegistry } from "../tools.js";

export interface ToolApproval {
  approve(
    call: ToolCall,
    session: Session,
    context?: { readonly signal?: AbortSignal },
  ): Promise<boolean>;
}

export const allowAllTools: ToolApproval = { approve: async () => true };

/** A generous safety ceiling for multi-step workspace tasks; callers may still override it. */
export const defaultAgentMaxTurns = 64;

export interface AgentRunContext {
  readonly runId: string;
  readonly sessionId: string;
  readonly prompt: string;
  readonly workspaceRoot: string;
  readonly signal?: AbortSignal;
  /** Emits a short user-visible progress note for this run. */
  readonly progress: (text: string) => Promise<void>;
}

/** Per-run additions, fixed when the run starts so concurrent runs stay isolated. */
export interface AgentRunContribution {
  /** Appended to the system instructions on every turn of this run. */
  readonly instructions?: string;
  /**
   * Run-scoped tools governed by the contributor's own policy instead of
   * ToolApproval. They must not touch the workspace and cannot replace
   * registered tools. A result with `endTurn` completes the run awaiting the user.
   */
  readonly tools?: readonly AgentTool[];
  /** Rewrites the history view sent to the model; must keep every tool call/result pair. */
  readonly history?: (messages: readonly ChatMessage[]) => ChatMessage[];
  /** Called once when the run settles, whether it succeeded or not. */
  end?(): void | Promise<void>;
}

export interface AgentRunContextProvider {
  begin(context: AgentRunContext): Promise<AgentRunContribution>;
}

export interface AgentRuntimeOptions {
  readonly provider: ModelProvider;
  readonly tools: ToolRegistry;
  readonly sessions: SessionStore;
  readonly context: ContextManager;
  readonly events: RuntimeEventBus;
  readonly workspaceRoot: string;
  readonly approval?: ToolApproval;
  readonly systemPrompt?: string;
  /** Computes user-configured instructions once per session without weakening mode safety. */
  readonly systemPromptFactory?: (session: Session) => string | undefined;
  readonly maxTurns?: number;
  readonly memory?: WorkspaceMemoryStore;
  readonly plans?: WorkspacePlanStore;
  readonly savePlanOnCompletion?: boolean;
  readonly requireWriteForEditIntent?: boolean;
  readonly deferTextUntilToolDecision?: boolean;
  readonly modelRetryPolicy?: ModelRetryPolicy;
  readonly runContext?: AgentRunContextProvider;
}
