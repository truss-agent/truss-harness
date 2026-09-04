import type {
  AgentProfile,
  AgentRunSummary,
  CreateAgentProfileInput,
} from "@truss-harness/runtime";

export interface ControlWorkspace {
  readonly id: string;
  readonly name: string;
  readonly root: string;
}
export interface ControlAgent extends AgentProfile {
  readonly workspaceId: string;
}
export interface ControlRun extends AgentRunSummary {
  readonly workspaceId: string;
}
export interface ControlSnapshot {
  readonly workspaces: readonly ControlWorkspace[];
  readonly agents: readonly ControlAgent[];
  readonly runs: readonly ControlRun[];
}
export interface CreateControlAgentInput extends CreateAgentProfileInput {
  readonly workspaceId: string;
}
export interface ControlBridge {
  snapshot(): Promise<ControlSnapshot>;
  chooseWorkspace(): Promise<ControlSnapshot | undefined>;
  removeWorkspace(id: string): Promise<ControlSnapshot>;
  createAgent(input: CreateControlAgentInput): Promise<ControlSnapshot>;
  deleteAgent(id: string): Promise<ControlSnapshot>;
  startAgent(id: string, prompt: string): Promise<ControlSnapshot>;
  stopAgent(runId: string): Promise<ControlSnapshot>;
  resolveApproval(
    runId: string,
    callId: string,
    approved: boolean,
  ): Promise<ControlSnapshot>;
  onSnapshot(listener: (snapshot: ControlSnapshot) => void): () => void;
}
