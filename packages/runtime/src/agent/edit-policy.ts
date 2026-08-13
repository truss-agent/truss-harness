import type { ToolCall } from "../contracts.js";

export type AgentRecoveryReason = "no_tools" | "write_failed";

export function workspacePath(call: ToolCall): string | undefined {
  return typeof call.input.path === "string" ? call.input.path : undefined;
}

export function isFileWrite(call: ToolCall): boolean {
  return call.name === "write_file" || call.name === "replace_in_file";
}

export function toolFailureRecovery(tool: string): string {
  if (tool === "web_fetch") {
    return "Do not infer page or file contents from this failure. web_fetch reads only public HTTP/HTTPS URLs; to inspect a workspace file, retry with read_file using its workspace-relative path.";
  }
  if (tool === "web_search") {
    return "Do not infer search results from this failure. Correct the tool arguments and retry, or use a workspace tool when the request concerns local files.";
  }
  if (tool === "write_file") {
    return "Read the current file first. For an existing file, use replace_in_file with one focused contiguous edit instead of sending the entire file in one large write_file call.";
  }
  if (tool === "replace_in_file") {
    return "Do not infer a file state from this failure. Call read_file for the current workspace file, then retry replace_in_file with one exact contiguous oldText excerpt from that read. Do not answer until the write succeeds or the failure is clearly unrecoverable.";
  }
  return "Do not infer a result from this failure. Correct the arguments and retry the appropriate tool before answering.";
}

export function hasEditIntent(prompt: string): boolean {
  return /\b(?:add|change|create|delete|edit|fix|implement|modify|overhaul|refactor|remove|rename|replace|rewrite|rework|update|write|error|exception|stack trace|uncaught|referenceerror|typeerror|syntaxerror|not working|doesn['’]t work|broken|failed)\b/i.test(
    prompt,
  );
}

export function recoveryInstruction(
  reason: AgentRecoveryReason | undefined,
  pendingWritePaths: ReadonlySet<string>,
): string | undefined {
  if (reason === "write_failed") {
    const paths = pendingWritePaths.size
      ? ` for ${[...pendingWritePaths].join(", ")}`
      : "";
    return `WRITE RECOVERY: A previous file write failed${paths}. Do not answer or stop after reading. Call read_file for each failed path, then retry each focused write using an exact contiguous oldText excerpt copied from the newest read. Verify every repaired write with read_file before responding.`;
  }
  if (reason === "no_tools") {
    return "EXECUTION RECOVERY: Your previous response described work but did not call any tools. This is Edit mode. Do not explain or propose a plan. Immediately call one relevant workspace inspection tool, then make the requested file change with write_file or replace_in_file and read the changed file to verify it.";
  }
  return undefined;
}

export function turnBudgetInstruction(
  turnsRemaining: number,
): string | undefined {
  if (turnsRemaining > 6) return undefined;
  return `TURN BUDGET: ${turnsRemaining} turns remain. Stop repeated exploration. Complete and verify the requested edits now, then return a concise final result. Do not claim work is complete unless the relevant write tools succeeded.`;
}
