import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline";
import { RuntimeService } from "../protocol.js";
import type {
  RuntimeServiceCapabilities,
  RuntimeServiceEventSource,
  RuntimeServiceHost,
  RuntimeServiceRuntime,
} from "../protocol-contracts.js";
import type { ProtocolToolApproval } from "./approval.js";

/** Starts the versioned newline-delimited JSON service over process stdio. */
export async function runService(
  runtime: RuntimeServiceRuntime,
  events: RuntimeServiceEventSource,
  approval?: ProtocolToolApproval,
  options: {
    readonly serverVersion?: string;
    readonly capabilities?: Partial<RuntimeServiceCapabilities>;
    readonly host?: RuntimeServiceHost;
  } = {},
): Promise<void> {
  const service = new RuntimeService({
    runtime,
    events,
    approval,
    write: (message) => stdout.write(`${JSON.stringify(message)}\n`),
    serverVersion: options.serverVersion,
    capabilities: options.capabilities,
    host: options.host,
  });
  const lines = createInterface({ input: stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if ((await service.handleLine(line)) === "shutdown") break;
    }
  } finally {
    lines.close();
    await service.close();
  }
}
