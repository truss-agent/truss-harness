import { randomUUID } from "node:crypto";
import type { ChatAttachment, ChatMessage, JsonObject, ModelProvider, RuntimeEvent, Session, ToolCall, ToolResult } from "./contracts.js";
import type { ContextBlock, ContextManager } from "./context.js";
import type { RuntimeEventBus } from "./events.js";
import type { SessionStore } from "./sessions.js";
import type { ToolRegistry } from "./tools.js";
import type { WorkspaceMemoryStore, WorkspaceTaskRecord, WorkspaceToolRecord } from "./memory.js";
import { parseAgentPlan, type WorkspacePlanStore } from "./plans.js";
import { checkpoint } from "./sessions.js";

export interface ToolApproval { approve(call: ToolCall, session: Session): Promise<boolean>; }
export const allowAllTools: ToolApproval = { approve: async () => true };
/** A generous safety ceiling for multi-step workspace tasks; callers may still override it. */
export const defaultAgentMaxTurns = 64;
export interface AgentRuntimeOptions { readonly provider: ModelProvider; readonly tools: ToolRegistry; readonly sessions: SessionStore; readonly context: ContextManager; readonly events: RuntimeEventBus; readonly workspaceRoot: string; readonly approval?: ToolApproval; readonly systemPrompt?: string; readonly maxTurns?: number; readonly memory?: WorkspaceMemoryStore; readonly plans?: WorkspacePlanStore; readonly savePlanOnCompletion?: boolean; readonly requireWriteForEditIntent?: boolean; readonly deferTextUntilToolDecision?: boolean; }

function workspacePath(call: ToolCall): string | undefined {
  return typeof call.input.path === "string" ? call.input.path : undefined;
}

function isFileWrite(call: ToolCall): boolean {
  return call.name === "write_file" || call.name === "replace_in_file";
}

function hasEditIntent(prompt: string): boolean {
  return /\b(?:add|change|create|delete|edit|fix|implement|modify|overhaul|refactor|remove|rename|replace|rewrite|rework|update|write|error|exception|stack trace|uncaught|referenceerror|typeerror|syntaxerror|not working|doesn['’]t work|broken|failed)\b/i.test(prompt);
}

class ProgressStreamParser {
  private buffer = "";
  private inProgress = false;

  push(chunk: string): { readonly content: string; readonly progress: string } {
    this.buffer += chunk;
    let content = "";
    let progress = "";
    while (this.buffer) {
      if (!this.inProgress) {
        const start = this.buffer.toLowerCase().indexOf("<progress>");
        if (start >= 0) {
          content += this.buffer.slice(0, start);
          this.buffer = this.buffer.slice(start + "<progress>".length);
          this.inProgress = true;
          continue;
        }
        const keep = trailingTagPrefixLength(this.buffer, "<progress>");
        const safeLength = this.buffer.length - keep;
        if (safeLength <= 0) break;
        content += this.buffer.slice(0, safeLength);
        this.buffer = this.buffer.slice(safeLength);
        continue;
      }
      const end = this.buffer.toLowerCase().indexOf("</progress>");
      if (end >= 0) {
        progress += this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + "</progress>".length);
        this.inProgress = false;
        continue;
      }
      const keep = trailingTagPrefixLength(this.buffer, "</progress>");
      const safeLength = this.buffer.length - keep;
      if (safeLength <= 0) break;
      progress += this.buffer.slice(0, safeLength);
      this.buffer = this.buffer.slice(safeLength);
    }
    return { content, progress };
  }

  finish(): { readonly content: string; readonly progress: string } {
    const tail = this.buffer;
    this.buffer = "";
    return this.inProgress ? { content: "", progress: tail } : { content: tail, progress: "" };
  }
}

function trailingTagPrefixLength(value: string, tag: string): number {
  const normalized = value.toLowerCase();
  for (let length = Math.min(tag.length - 1, normalized.length); length > 0; length--) {
    if (normalized.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}

/** Provider-neutral iterative agent loop. UI clients interact only via sessions, events, and approval. */
export class AgentRuntime {
  private readonly maxTurns: number;
  constructor(private readonly options: AgentRuntimeOptions) { this.maxTurns = options.maxTurns ?? defaultAgentMaxTurns; }
  async createSession(messages: readonly ChatMessage[] = []): Promise<Session> { return this.options.sessions.create(messages); }
  async getSession(sessionId: string): Promise<Session | undefined> { return this.options.sessions.get(sessionId); }
  async listSessions(): Promise<readonly Session[]> { return this.options.sessions.list(); }
  async deleteSession(sessionId: string): Promise<boolean> { return this.options.sessions.delete(sessionId); }
  async restoreSessionCheckpoint(sessionId: string): Promise<Session | undefined> { return this.options.sessions.restoreCheckpoint(sessionId); }
  async run(sessionId: string, prompt: string, signal?: AbortSignal, requestContext: readonly ContextBlock[] = [], attachments: readonly ChatAttachment[] = []): Promise<void> {
    const session = await this.options.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    const taskId = randomUUID();
    const startedAt = new Date().toISOString();
    const executedTools: WorkspaceToolRecord[] = [];
    const modifiedFiles = new Set<string>();
    const completedTerminalCommands = new Set<string>();
    const filesNeedingVerification = new Set<string>();
    let assistantText = "";
    let recoveryReason: "no_tools" | "write_failed" | undefined;
    let recoveryAttempts = 0;
    await this.recordMemory({ id: taskId, sessionId, objective: prompt, status: "running", startedAt, tools: [], modifiedFiles: [] });
    session.messages.push({ role: "user", content: prompt, ...(attachments.length ? { attachments } : {}) }); session.checkpoint = checkpoint(session); await this.options.sessions.save(session);
    await this.emit({ type: "run_started", sessionId });
    try {
      for (let turn = 0; turn < this.maxTurns; turn++) {
        const calls: ToolCall[] = [];
        let text = "";
        const progressParser = new ProgressStreamParser();
        const recoveryInstruction = recoveryReason === "write_failed"
          ? "WRITE RECOVERY: A previous file write failed. The current file contents are in the tool history. Do not stop after reading. Call read_file if needed, then retry one focused write using an exact contiguous excerpt. Verify the write with read_file before responding."
          : recoveryReason === "no_tools"
            ? "EXECUTION RECOVERY: Your previous response described work but did not call any tools. This is Edit mode. Do not explain or propose a plan. Immediately call one relevant workspace inspection tool, then make the requested file change with write_file or replace_in_file and read the changed file to verify it."
            : undefined;
        const turnsRemaining = this.maxTurns - turn;
        const turnBudgetInstruction = turnsRemaining <= 6
          ? `TURN BUDGET: ${turnsRemaining} turns remain. Stop repeated exploration. Complete and verify the requested edits now, then return a concise final result. Do not claim work is complete unless the relevant write tools succeeded.`
          : undefined;
        const systemPrompt = [this.options.systemPrompt, recoveryInstruction, turnBudgetInstruction].filter(Boolean).join("\n\n") || undefined;
        for await (const event of this.options.provider.stream({ messages: await this.options.context.build(session, systemPrompt, requestContext), tools: this.options.tools.definitions(), signal })) {
          if (event.type === "text_delta") {
            const parsed = progressParser.push(event.text);
            if (parsed.progress) await this.emit({ type: "progress_delta", sessionId, text: parsed.progress });
            text += parsed.content;
            if (parsed.content && !this.options.deferTextUntilToolDecision) {
              assistantText += parsed.content;
              await this.emit({ type: "text_delta", sessionId, text: parsed.content });
            }
          }
          else if (event.type === "tool_call") calls.push(event);
          else if (event.type === "error") throw event.error;
        }
        const finalProgress = progressParser.finish();
        if (finalProgress.progress) await this.emit({ type: "progress_delta", sessionId, text: finalProgress.progress });
        text += finalProgress.content;
        if (finalProgress.content && !this.options.deferTextUntilToolDecision) {
          assistantText += finalProgress.content;
          await this.emit({ type: "text_delta", sessionId, text: finalProgress.content });
        }
        // Preserve the provider-independent tool-call record so the next turn can
        // reconstruct the native provider conversation accurately.
        if (text || calls.length) session.messages.push({ role: "assistant", content: text, toolCalls: calls });
        if (!calls.length) {
          if (this.options.requireWriteForEditIntent && hasEditIntent(prompt) && !modifiedFiles.size) {
            if (recoveryAttempts < 2) {
              recoveryReason ??= "no_tools";
              recoveryAttempts += 1;
              continue;
            }
            throw new Error("Agent did not complete a verified file write after recovery attempts. No workspace changes were made.");
          }
          if (text && this.options.deferTextUntilToolDecision) {
            assistantText += text;
            await this.emit({ type: "text_delta", sessionId, text });
          }
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
          if (!execution.succeeded && isFileWrite(call)) recoveryReason = "write_failed";
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
