import type {
  AgentMode,
  ApprovalMode,
  RemoteEvent,
  AgentRun,
  ToolApproval,
  AgentToolApproval,
} from "./contracts";
import {
  approvalForRemoteEvent,
  describeToolFailure,
} from "./remote-session-controller";
export interface MobileEventTarget {
  readonly workspaceId?: string;
  readonly sessionId?: string;
  readonly mode: AgentMode;
  readonly approvalMode: ApprovalMode;
  readonly agentApproval?: AgentToolApproval;
  readonly readOnlyTools: ReadonlySet<string>;
  appendAssistant(text: string): void;
  appendSystem(text: string): void;
  updateAgentRun(run: AgentRun): void;
  setStatus(text: string): void;
  setRunning(running: boolean): void;
  setApproval(approval: ToolApproval | undefined): void;
  setAgentApproval(approval: AgentToolApproval | undefined): void;
}
export function routeMobileEvent(
  event: RemoteEvent,
  target: MobileEventTarget,
): void {
  const {
    workspaceId,
    sessionId,
    mode,
    approvalMode,
    readOnlyTools,
    appendAssistant,
    appendSystem,
    updateAgentRun,
    setStatus,
    setRunning,
    setApproval,
    setAgentApproval,
  } = target;

  if (
    workspaceId &&
    event.type === "agent_run_updated" &&
    event.workspaceId === workspaceId &&
    event.run
  ) {
    updateAgentRun(event.run);
    if (
      target.agentApproval?.runId === event.run.id &&
      ["completed", "failed", "cancelled"].includes(event.run.state)
    )
      setAgentApproval(undefined);
    if (event.run.state === "completed") setStatus("Agent run completed.");
    if (event.run.state === "failed")
      setStatus(
        `Agent run failed${event.run.errorCode ? ` (${event.run.errorCode})` : ""}.`,
      );
    return;
  }
  if (
    workspaceId &&
    event.type === "agent_runtime" &&
    event.workspaceId === workspaceId &&
    event.event
  ) {
    const nested = event.event;
    if (
      nested.type === "tool_call_requested" &&
      nested.callId &&
      nested.tool &&
      nested.input &&
      event.runId
    ) {
      setAgentApproval({
        workspaceId,
        runId: event.runId,
        callId: nested.callId,
        tool: nested.tool,
        input: nested.input,
      });
      setStatus("An agent tool needs your approval.");
    }
    return;
  }
  if (
    !sessionId ||
    event.sessionId !== sessionId ||
    (event.workspaceId !== undefined && event.workspaceId !== workspaceId)
  )
    return;
  if (
    event.type === "run_completed" ||
    event.type === "run_failed" ||
    event.type === "run_cancelled"
  )
    setApproval(undefined);
  if (event.type === "text_delta" && event.text) appendAssistant(event.text);
  if (event.type === "run_started") {
    setRunning(true);
    setStatus("Truss is working in your workspace.");
  }
  if (event.type === "run_completed") {
    setRunning(false);
    setStatus("Run completed.");
    if (mode === "edit")
      appendSystem(
        event.modifiedFiles?.length
          ? `Verified workspace changes: ${event.modifiedFiles.join(", ")}`
          : "Run completed. No workspace files were changed.",
      );
  }
  if (event.type === "run_cancelled") {
    setRunning(false);
    setStatus("Run stopped.");
  }
  if (event.type === "run_failed") {
    setRunning(false);
    setStatus(event.message ?? "Run failed.");
  }
  const activeApprovalMode = approvalMode;
  const requestedApproval = approvalForRemoteEvent(
    event,
    activeApprovalMode,
    readOnlyTools,
  );
  if (
    event.type === "tool_call_requested" &&
    event.tool &&
    !requestedApproval
  ) {
    setStatus(`Running ${event.tool.replaceAll("_", " ")}...`);
  } else if (requestedApproval) {
    setApproval({ ...requestedApproval, sessionId, workspaceId });
    setStatus("A tool needs your approval.");
  }
  const toolFailure = describeToolFailure(event);
  if (toolFailure && event.tool) {
    setStatus(`${event.tool.replaceAll("_", " ")} failed.`);
    appendSystem(toolFailure);
  }
}
