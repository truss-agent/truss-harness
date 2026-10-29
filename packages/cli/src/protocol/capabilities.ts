import type { RuntimeEvent } from "@truss-harness/runtime";
import type {
  RuntimeServiceCapabilities,
  SerializableRuntimeEvent,
} from "../protocol-contracts.js";

export function serviceCapabilities(options: {
  readonly approval?: unknown;
  readonly textRuntime?: unknown;
  readonly host?: {
    readonly testProviderConnection?: unknown;
    readonly listProfiles?: unknown;
    readonly listMcpServers?: unknown;
    readonly skills?: {
      readonly import?: unknown;
      readonly remove?: unknown;
    };
  };
  readonly capabilities?: Partial<RuntimeServiceCapabilities>;
}): RuntimeServiceCapabilities {
  return {
    streaming: true,
    textOnlyGeneration: Boolean(options.textRuntime),
    sessions: true,
    cancellation: true,
    approvals: Boolean(options.approval),
    context: true,
    attachments: ["file", "image"],
    changedFiles: true,
    providerDiscovery: false,
    providerPreflight: Boolean(options.host?.testProviderConnection),
    configurationProfiles: Boolean(options.host?.listProfiles),
    agentProfiles: false,
    mcpStatus: Boolean(options.host?.listMcpServers),
    skills: Boolean(options.host?.skills),
    skillManagement: Boolean(
      options.host?.skills?.import && options.host.skills.remove,
    ),
    ...options.capabilities,
  };
}

export function serializeEvent(event: RuntimeEvent): SerializableRuntimeEvent {
  return event.type === "run_failed"
    ? {
        type: "run_failed",
        sessionId: event.sessionId,
        error: event.error.message,
      }
    : event;
}
