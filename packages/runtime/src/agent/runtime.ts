import { randomUUID } from "node:crypto";
import type { ContextBlock } from "../context.js";
import type {
  ChatAttachment,
  ChatMessage,
  ModelTokenUsage,
  RuntimeEvent,
  Session,
  ToolCall,
} from "../contracts.js";
import type { WorkspaceTaskRecord, WorkspaceToolRecord } from "../memory.js";
import { parseAgentPlan } from "../plans.js";
import { withModelRetries } from "../retry.js";
import { checkpoint } from "../sessions.js";
import { type AgentRuntimeOptions, defaultAgentMaxTurns } from "./contracts.js";
import {
  type AgentRecoveryReason,
  hasEditIntent,
  isFileWrite,
  recoveryInstruction,
  turnBudgetInstruction,
  workspacePath,
} from "./edit-policy.js";
import { ProgressStreamParser, retryProgress } from "./progress-stream.js";
import { normalizeToolCall } from "./tool-call-normalization.js";
import { AgentToolExecutor } from "./tool-executor.js";

/** Provider-neutral iterative agent loop. UI clients interact only via sessions, events, and approval. */
export class AgentRuntime {
  private readonly maxTurns: number;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.maxTurns = options.maxTurns ?? defaultAgentMaxTurns;
  }

  async createSession(messages: readonly ChatMessage[] = []): Promise<Session> {
    return this.options.sessions.create(messages);
  }

  async getSession(sessionId: string): Promise<Session | undefined> {
    return this.options.sessions.get(sessionId);
  }

  async listSessions(): Promise<readonly Session[]> {
    return this.options.sessions.list();
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.options.sessions.delete(sessionId);
  }

  async restoreSessionCheckpoint(
    sessionId: string,
  ): Promise<Session | undefined> {
    return this.options.sessions.restoreCheckpoint(sessionId);
  }

  async run(
    sessionId: string,
    prompt: string,
    signal?: AbortSignal,
    requestContext: readonly ContextBlock[] = [],
    attachments: readonly ChatAttachment[] = [],
  ): Promise<void> {
    signal?.throwIfAborted();
    const session = await this.options.sessions.get(sessionId);
    if (!session) throw new Error(`Unknown session: ${sessionId}`);
    const taskId = randomUUID();
    const startedAt = new Date().toISOString();
    const executedTools: WorkspaceToolRecord[] = [];
    const modifiedFiles = new Set<string>();
    const completedTerminalCommands = new Set<string>();
    const filesNeedingVerification = new Set<string>();
    const pendingWriteRecoveryPaths = new Set<string>();
    const missingFileRecoveryPaths = new Set<string>();
    let lastReadWorkspacePath: string | undefined;
    let assistantText = "";
    let recoveryReason: AgentRecoveryReason | undefined;
    let recoveryAttempts = 0;
    const emit = async (event: RuntimeEvent): Promise<void> => {
      signal?.throwIfAborted();
      await this.emit(event);
      signal?.throwIfAborted();
    };
    const toolExecutor = new AgentToolExecutor({
      tools: this.options.tools,
      workspaceRoot: this.options.workspaceRoot,
      approval: this.options.approval,
      emit: (event) => emit(event),
    });

    await this.recordMemory({
      id: taskId,
      sessionId,
      objective: prompt,
      status: "running",
      startedAt,
      tools: [],
      modifiedFiles: [],
    });
    session.messages.push({
      role: "user",
      content: prompt,
      ...(attachments.length ? { attachments } : {}),
    });
    session.checkpoint = checkpoint(session);
    await this.options.sessions.save(session);
    await emit({ type: "run_started", sessionId });
    const provider = withModelRetries(
      this.options.provider,
      this.options.modelRetryPolicy,
      (retry) =>
        emit({
          type: "progress_delta",
          sessionId,
          text: retryProgress(retry),
        }),
    );

    try {
      for (let turn = 0; turn < this.maxTurns; turn++) {
        signal?.throwIfAborted();
        const calls: ToolCall[] = [];
        let text = "";
        let usage: ModelTokenUsage | undefined;
        let finishReason: "stop" | "tool_calls" | "length" | undefined;
        const progressParser = new ProgressStreamParser();
        const systemPrompt = [
          this.options.systemPromptFactory?.(session) ??
            this.options.systemPrompt,
          recoveryInstruction(
            recoveryReason,
            pendingWriteRecoveryPaths,
            missingFileRecoveryPaths,
          ),
          turnBudgetInstruction(this.maxTurns - turn),
        ]
          .filter(Boolean)
          .join("\n\n");

        const messages = await this.options.context.build(
          session,
          systemPrompt || undefined,
          requestContext,
        );
        signal?.throwIfAborted();
        for await (const event of provider.stream({
          messages,
          tools: this.options.tools.definitions(),
          signal,
        })) {
          signal?.throwIfAborted();
          if (event.type === "text_delta") {
            const parsed = progressParser.push(event.text);
            if (parsed.progress) {
              await emit({
                type: "progress_delta",
                sessionId,
                text: parsed.progress,
              });
            }
            text += parsed.content;
            if (parsed.content && !this.options.deferTextUntilToolDecision) {
              assistantText += parsed.content;
              await emit({
                type: "text_delta",
                sessionId,
                text: parsed.content,
              });
            }
          } else if (event.type === "tool_call") {
            calls.push(normalizeToolCall(event));
          } else if (event.type === "finish") {
            usage = event.usage;
            finishReason = event.reason;
          } else if (event.type === "error") {
            throw event.error;
          }
        }
        signal?.throwIfAborted();
        if (!finishReason) throw new Error("Model stream ended before its semantic finish; output is incomplete.");
        if (finishReason === "length") throw new Error("Model output is incomplete: token length limit reached. Resume with a new request.");
        if (usage) await emit({ type: "usage", sessionId, usage });
        const finalProgress = progressParser.finish();
        if (finalProgress.progress) {
          await emit({
            type: "progress_delta",
            sessionId,
            text: finalProgress.progress,
          });
        }
        text += finalProgress.content;
        if (finalProgress.content && !this.options.deferTextUntilToolDecision) {
          assistantText += finalProgress.content;
          await emit({
            type: "text_delta",
            sessionId,
            text: finalProgress.content,
          });
        }

        // Preserve the provider-independent tool-call record so the next turn
        // can reconstruct the native provider conversation accurately.
        if (text || calls.length) {
          session.messages.push({
            role: "assistant",
            content: text,
            toolCalls: calls,
          });
        }
        if (!calls.length) {
          if (pendingWriteRecoveryPaths.size) {
            recoveryAttempts += 1;
            if (recoveryAttempts >= 2) {
              throw new Error(
                `Agent could not recover the failed file write for ${[...pendingWriteRecoveryPaths].join(", ")} after recovery attempts.`,
              );
            }
            continue;
          }
          if (
            this.options.requireWriteForEditIntent &&
            hasEditIntent(prompt) &&
            !modifiedFiles.size
          ) {
            if (recoveryAttempts < 2) {
              recoveryReason ??= "no_tools";
              recoveryAttempts += 1;
              continue;
            }
            throw new Error(
              "Agent did not complete a verified file write after recovery attempts. No workspace changes were made.",
            );
          }
          if (text && this.options.deferTextUntilToolDecision) {
            assistantText += text;
            await emit({ type: "text_delta", sessionId, text });
          }
          if (this.options.savePlanOnCompletion && this.options.plans) {
            const parsed = parseAgentPlan(assistantText, prompt);
            if (parsed) {
              await emit({
                type: "plan_updated",
                sessionId,
                plan: await this.options.plans.create({
                  ...parsed,
                  objective: prompt,
                }),
              });
            }
          }
          await this.options.sessions.save(session);
          await this.recordMemory({
            id: taskId,
            sessionId,
            objective: prompt,
            status: "completed",
            startedAt,
            completedAt: new Date().toISOString(),
            assistantSummary: this.summary(assistantText),
            tools: executedTools,
            modifiedFiles: [...modifiedFiles],
          });
          await emit({
            type: "run_completed",
            sessionId,
            modifiedFiles: [...modifiedFiles],
          });
          return;
        }

        let failedWriteThisTurn = false;
        for (const call of calls) {
          const command =
            call.name === "run_terminal" &&
            typeof call.input.command === "string"
              ? call.input.command.trim()
              : undefined;
          const path = workspacePath(call);
          const execution = await toolExecutor.execute(
            session,
            call,
            signal,
            command && completedTerminalCommands.has(command)
              ? "This exact terminal command already completed successfully in this run. Do not repeat it; inspect the result or continue to the next step."
              : isFileWrite(call) && path && filesNeedingVerification.has(path)
                ? `Repeated write blocked for ${path}. This file was already changed in this run. Read it again to verify the result before making another focused edit.`
                : undefined,
          );
          signal?.throwIfAborted();
          executedTools.push(execution);
          // Unknown/plugin tools may change workspace state too; only known reads retain cached results.
          if (execution.succeeded && !["read_file", "list_directory", "search_files", "grep", "update_plan"].includes(call.name)) {
            completedTerminalCommands.clear();
          }
          if (command && execution.succeeded) {
            completedTerminalCommands.add(command);
          }
          if (call.name === "update_plan" && this.options.plans) {
            const plan = await this.options.plans.load();
            if (plan) {
              await emit({ type: "plan_updated", sessionId, plan });
            }
          }
          if (execution.succeeded && call.name === "read_file" && path) {
            filesNeedingVerification.delete(path);
            lastReadWorkspacePath = path;
          }
          if (execution.succeeded && isFileWrite(call) && path) {
            modifiedFiles.add(path);
            filesNeedingVerification.add(path);
            pendingWriteRecoveryPaths.delete(path);
            missingFileRecoveryPaths.delete(path);
            if (!pendingWriteRecoveryPaths.size) {
              recoveryReason = undefined;
              recoveryAttempts = 0;
            }
          }
          if (
            !execution.succeeded &&
            this.options.requireWriteForEditIntent &&
            hasEditIntent(prompt) &&
            call.name === "read_file" &&
            path &&
            execution.failure?.includes("ENOENT")
          ) {
            missingFileRecoveryPaths.add(path);
            recoveryReason = "missing_file";
            recoveryAttempts = 0;
          }
          if (!execution.succeeded && execution.recoveryRequired) {
            failedWriteThisTurn = true;
            recoveryReason = "write_failed";
            const recoveryPath = path ?? lastReadWorkspacePath;
            if (recoveryPath) {
              pendingWriteRecoveryPaths.add(recoveryPath);
              await emit({
                type: "progress_delta",
                sessionId,
                text: `Recovery: retry the file change for ${recoveryPath} with a non-empty path and the current file contents.`,
              });
            }
          }
        }
        if (pendingWriteRecoveryPaths.size && !failedWriteThisTurn) {
          recoveryAttempts += 1;
          if (recoveryAttempts >= 2) {
            throw new Error(
              `Agent could not recover the failed file write for ${[...pendingWriteRecoveryPaths].join(", ")} after recovery attempts.`,
            );
          }
        }
        if (missingFileRecoveryPaths.size && !modifiedFiles.size) {
          recoveryAttempts += 1;
          if (recoveryAttempts >= 2) {
            throw new Error(
              `Agent could not create the missing requested file(s): ${[...missingFileRecoveryPaths].join(", ")}.`,
            );
          }
        }
        await this.options.sessions.save(session);
      }
      throw new Error(`Agent exceeded its ${this.maxTurns}-turn limit`);
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      await this.recordMemory({
        id: taskId,
        sessionId,
        objective: prompt,
        status: "failed",
        startedAt,
        completedAt: new Date().toISOString(),
        assistantSummary: this.summary(assistantText),
        error: normalized.message,
        tools: executedTools,
        modifiedFiles: [...modifiedFiles],
      });
      await this.emit({ type: "run_failed", sessionId, error: normalized });
      throw normalized;
    }
  }

  private summary(text: string): string | undefined {
    return text ? text.slice(-1_500) : undefined;
  }

  private async recordMemory(task: WorkspaceTaskRecord): Promise<void> {
    try {
      await this.options.memory?.upsertTask(task);
    } catch {
      // Memory must never prevent an agent run.
    }
  }

  private emit(event: RuntimeEvent): Promise<void> {
    return this.options.events.emit(event);
  }
}
