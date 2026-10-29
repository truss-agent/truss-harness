import type { Interface } from "node:readline/promises";
import { CliToolApproval } from "./cli-approval.js";
import {
  createClientRuntime,
  type ClientConfiguration,
  type ClientRuntime,
  type ClientRuntimeOptions,
} from "./runtime.js";
import type { PermissionMode } from "./protocol.js";

interface CliChatResources {
  readonly readline: Interface | undefined;
  createRuntime(configuration: ClientConfiguration): Promise<ClientRuntime>;
  disposeRuntime(client: ClientRuntime): Promise<void>;
}

/** Owns stdin and every returned runtime before any fallible initialization. */
export async function withCliChatResources<T>(
  options: {
    readonly permission: PermissionMode;
    readonly canPrompt: boolean;
    createReadline(): Interface | undefined;
    readonly runtimeFactory?: (
      options: ClientRuntimeOptions,
    ) => Promise<ClientRuntime>;
  },
  operation: (resources: CliChatResources) => Promise<T>,
): Promise<T> {
  let readline: Interface | undefined;
  let approval: CliToolApproval | undefined;
  const clients = new Set<ClientRuntime>();
  const disposeRuntime = async (client: ClientRuntime): Promise<void> => {
    if (!clients.delete(client)) return;
    await client.dispose();
  };
  try {
    readline = options.createReadline();
    const toolApproval = new CliToolApproval(
      options.permission,
      options.canPrompt ? readline : undefined,
    );
    approval = toolApproval;
    return await operation({
      readline,
      async createRuntime(configuration) {
        const client = await (options.runtimeFactory ?? createClientRuntime)({
          ...configuration,
          approval: toolApproval,
        });
        clients.add(client);
        return client;
      },
      disposeRuntime,
    });
  } finally {
    approval?.denyAll();
    readline?.close();
    // All acquired runtimes begin disposal even if another disposer fails.
    await Promise.all([...clients].map(disposeRuntime));
  }
}
