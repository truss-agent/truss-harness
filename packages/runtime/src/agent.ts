import { randomUUID } from "node:crypto";
import type { ChatMessage, JsonObject, ModelProvider, RuntimeEvent, Session, ToolCall, ToolResult } from "./contracts.js";
import type { ContextManager } from "./context.js";
import type { RuntimeEventBus } from "./events.js";
import type { SessionStore } from "./sessions.js";
import type { ToolRegistry } from "./tools.js";
import type { WorkspaceMemoryStore, WorkspaceTaskRecord, WorkspaceToolRecord } from "./memory.js";
import { parseAgentPlan, type WorkspacePlanStore } from "./plans.js";
import { checkpoint } from "./sessions.js";

export interface ToolApproval { approve(call: ToolCall, session: Session): Promise<boolean>; }
export const allowAllTools: ToolApproval = { approve: async () => true };
export interface AgentRuntimeOptions { readonly provider: ModelProvider; readonly tools: ToolRegistry; readonly sessions: SessionStore; readonly context: ContextManager; readonly events: RuntimeEventBus; readonly workspaceRoot: string; readonly approval?: ToolApproval; readonly systemPrompt?: string; readonly maxTurns?: number; readonly memory?: WorkspaceMemoryStore; readonly plans?: WorkspacePlanStore; readonly savePlanOnCompletion?: boolean; }

function workspacePath(call: ToolCall): string | undefined {
  return typeof call.input.path === "string" ? call.input.path : undefined;
}

function isFileWrite(call: ToolCall): boolean {
  return call.name === "write_file" || call.name === "replace_in_file";
}

/** Provider-neutral iterative agent loop. UI clients interact only via sessions, events, and approval. */
export class AgentRuntime {
  private readonly maxTurns: number;
  constructor(private readonly options: AgentRuntimeOptions) { this.maxTurns = options.maxTurns ?? 24; }
  async createSession(messages: readonly ChatMessage[] = []): Promise<Session> { return this.options.sessions.create(messages); }
  async getSession(sessionId: string): Promise<Session | undefined> { return this.options.sessions.get(sessionId); }
  async listSessions(): Promise<readonly Session[]> { return this.options.sessions.list(); }
  async deleteSession(sessionId: string): Promise<boolean> { return this.options.sessions.delete(sessionId); }
  async restoreSessionCheckpoint(sessionId: string): Promise<Session | undefined> { return this.options.sessions.restoreCheckpoint(sessionId); }
  async run(sessionId: string, prompt: string, signal?: AbortSignal): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    const taskId = randomUUID();
    const startedAt = new Date().toISOString();
    const executedTools: WorkspaceToolRecord[] = [];
    const modifiedFiles = new Set<string>();
    const completedTerminalCommands = new Set<string>();
    const filesNeedingVerification = new Set<string>();
    let assistantText = "";
    await this.recordMemory({ id: taskId, sessionId, objective: prompt, status: "running", startedAt, tools: [], modifiedFiles: [] });
    session.messages.push({ role: "user", content: prompt }); session.checkpoint = checkpoint(session); await this.options.sessions.save(session);
    await this.emit({ type: "run_started", sessionId });
    try {
      for (let turn = 0; turn < this.maxTurns; turn++) {
        const calls: ToolCall[] = [];
        let text = "";
        for await (const event of this.options.provider.stream({ messages: await this.options.context.build(session, this.options.systemPrompt), tools: this.options.tools.definitions(), signal })) {
          if (event.type === "text_delta") { text += event.text; assistantText += event.text; await this.emit({ type: "text_delta", sessionId, text: event.text }); }
          else if (event.type === "tool_call") calls.push(event);
          else if (event.type === "error") throw event.error;
        }
        // Preserve the provider-independent tool-call record so the next turn can
        // reconstruct the native provider conversation accurately.
        if (text || calls.length) session.messages.push({ role: "assistant", content: text, toolCalls: calls });
        if (!calls.length) {
          if (this.options.savePlanOnCompletion && this.options.plans) {
            const parsed = parseAgentPlan(assistantText, prompt);
            if (parsed) await this.emit({ type: "plan_updated", sessionId, plan: await this.options.plans.create({ ...parsed, objective: prompt }) });
          }
          await this.options.sessions.save(session);
          await this.recordMemory({ id: taskId, sessionId, objective: prompt, status: "completed", startedAt, completedAt: new Date().toISOString(), assistantSummary: this.summary(assistantText), tools: executedTools, modifiedFiles: [...modifiedFiles] });
          await this.emit({ type: "run_completed", sessionId, modifiedFiles: [...modifiedFiles] });
          return;
        }
        for (const call of calls) {
          const command = call.name === "run_terminal" && typeof call.input.command === "string" ? call.input.command.trim() : undefined;
          const path = workspacePath(call);
          const execution = await this.executeCall(
            session,
            call,
            signal,
            command && completedTerminalCommands.has(command)
              ? "This exact terminal command already completed successfully in this run. Do not repeat it; inspect the result or continue to the next step."
              : isFileWrite(call) && path && filesNeedingVerification.has(path)
                ? `Repeated write blocked for ${path}. This file was already changed in this run. Read it again to verify the result before making another focused edit.`
                : undefined
          );
          executedTools.push(execution);
          if (command && execution.succeeded) completedTerminalCommands.add(command);
          if (call.name === "update_plan" && this.options.plans) {
            const plan = await this.options.plans.load();
            if (plan) await this.emit({ type: "plan_updated", sessionId, plan });
          }
          if (execution.succeeded && call.name === "read_file" && path) {
            filesNeedingVerification.delete(path);
          }
          if (execution.succeeded && isFileWrite(call) && path) {
            modifiedFiles.add(path);
            filesNeedingVerification.add(path);
          }
        }
        await this.options.sessions.save(session);
      }
      throw new Error(`Agent exceeded its ${this.maxTurns}-turn limit`);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      await this.recordMemory({ id: taskId, sessionId, objective: prompt, status: "failed", startedAt, completedAt: new Date().toISOString(), assistantSummary: this.summary(assistantText), error: normalized.message, tools: executedTools, modifiedFiles: [...modifiedFiles] });
      await this.emit({ type: "run_failed", sessionId, error: normalized });
      throw normalized;
    }
  }
  private async executeCall(session: Session, call: ToolCall, signal?: AbortSignal, preflightError?: string): Promise<WorkspaceToolRecord> {
    const { id: callId, name: tool, input } = call; await this.emit({ type: "tool_call_requested", sessionId: session.id, callId, tool, input });
    const implementation = this.options.tools.get(tool);
    let result: ToolResult;
    if (preflightError) result = { content: preflightError, isError: true };
    else if (!implementation) result = { content: `Unknown tool: ${tool}`, isError: true };
    else if (!await (this.options.approval ?? allowAllTools).approve(call, session)) result = { content: `Tool call denied: ${tool}`, isError: true };
    else {
      try {
        result = await implementation.execute(input, { workspaceRoot: this.options.workspaceRoot, signal });
      } catch (error) {
        result = { content: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
      }
    }
    session.messages.push({ role: "tool", name: tool, toolCallId: callId, content: result.content });
    await this.emit({ type: "tool_completed", sessionId: session.id, callId, tool, result });
    return { name: tool, succeeded: !result.isError };
  }
  private summary(text: string): string | undefined { return text ? text.slice(-1_500) : undefined; }
  private async recordMemory(task: WorkspaceTaskRecord): Promise<void> {
    try { await this.options.memory?.upsertTask(task); } catch { /* Memory must never prevent an agent run. */ }
  }
  private emit(event: RuntimeEvent): Promise<void> { return this.options.events.emit(event); }
}
