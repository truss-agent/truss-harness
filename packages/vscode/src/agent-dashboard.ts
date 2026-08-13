import type {
  AgentProfile,
  AgentRunSummary,
  ToolApproval,
  ToolCall,
} from "@truss-harness/runtime";
import type { AgentDashboardProfile, AgentDashboardRun } from "./contracts.js";

export function dashboardProfile(profile: AgentProfile): AgentDashboardProfile {
  return {
    id: profile.id,
    displayName: profile.displayName,
    provider: profile.provider.providerId,
    model: profile.provider.modelId,
    mode: profile.mode,
    approvalPolicy: profile.approvalPolicy,
  };
}

export function dashboardRun(run: AgentRunSummary): AgentDashboardRun {
  return {
    id: run.id,
    agentId: run.agentId,
    state: run.state,
    ...(run.latestProgress ? { latestProgress: run.latestProgress } : {}),
    ...(run.output ? { output: run.output } : {}),
    ...(run.activeTool ? { activeTool: run.activeTool } : {}),
    changedFiles: run.changedFiles,
    ...(run.error ? { error: run.error.message } : {}),
  };
}

export function dashboardApproval(profile: AgentProfile): ToolApproval & {
  resolve(callId: string, approved: boolean): boolean;
  denyAll(): void;
} {
  const pending = new Map<string, (approved: boolean) => void>();
  return {
    async approve(call: ToolCall): Promise<boolean> {
      const readOnly = [
        "read_file",
        "list_directory",
        "search_files",
        "grep",
      ].includes(call.name);
      if (
        profile.approvalPolicy === "auto-all" ||
        (profile.approvalPolicy === "auto-read" && readOnly)
      )
        return true;
      return new Promise<boolean>((resolveApproval) =>
        pending.set(call.id, resolveApproval),
      );
    },
    resolve(callId: string, approved: boolean): boolean {
      const resolveApproval = pending.get(callId);
      if (!resolveApproval) return false;
      pending.delete(callId);
      resolveApproval(approved);
      return true;
    },
    denyAll(): void {
      for (const resolveApproval of pending.values()) resolveApproval(false);
      pending.clear();
    },
  };
}
