import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import {
  EventBus,
  type AgentCoordinator,
  type AgentCoordinatorEvent,
} from "@truss-harness/runtime";
import { createGatewayAgentController, startRemoteGateway } from "./index.js";

describe("gateway boundaries", () => {
  it.each([
    [["visible"], ["visible"]],
    [[], []],
    [undefined, ["hidden", "visible"]],
  ] as const)(
    "filters every coordinator event form for allowlist %j",
    async (allowedProfileIds, expected) => {
      const events = new EventBus<AgentCoordinatorEvent>();
      const coordinator = { events } as unknown as AgentCoordinator;
      const received: AgentCoordinatorEvent[] = [];
      const unsubscribe = createGatewayAgentController(coordinator, {
        allowedProfileIds,
      }).events.subscribe((event) => received.push(event));
      for (const agentId of ["hidden", "visible"]) {
        await events.emit({
          type: "run_updated",
          run: {
            id: `run-${agentId}`,
            agentId,
            state: "running",
            prompt: "private",
            changedFiles: [],
          },
        });
        await events.emit({
          type: "runtime",
          event: {
            agentId,
            sequence: 1,
            occurredAt: "now",
            runId: `run-${agentId}`,
            event: { type: "run_started", sessionId: agentId },
          },
        });
        await events.emit({
          type: "lifecycle",
          record: {
            agentId,
            runId: `run-${agentId}`,
            phase: "started",
            state: "running",
            occurredAt: "now",
          },
        });
      }
      expect(received).toHaveLength(expected.length * 3);
      expect(
        received.map((event) =>
          event.type === "run_updated"
            ? event.run.agentId
            : event.type === "runtime"
              ? event.event.agentId
              : event.record.agentId,
        ),
      ).toEqual(expected.flatMap((id) => [id, id, id]));
      unsubscribe();
      await events.emit({
        type: "run_updated",
        run: {
          id: "extra",
          agentId: "visible",
          state: "running",
          prompt: "",
          changedFiles: [],
        },
      });
      expect(received).toHaveLength(expected.length * 3);
    },
  );

  it.each(["", "Upgrade: websocket\r\n"])(
    "rejects malformed HTTP/upgrade target without losing the listener %j",
    async (upgrade) => {
      const gateway = await startRemoteGateway({
        token: "a-secure-test-token-with-enough-characters",
        port: 0,
        workspaces: [
          {
            id: "test",
            displayName: "test",
            createRuntime: async () => {
              throw new Error("unused");
            },
          },
        ],
      });
      try {
        const address = new URL(gateway.url);
        const response = await new Promise<string>((resolve, reject) => {
          const socket = connect(Number(address.port), address.hostname);
          let data = "";
          socket.on("connect", () =>
            socket.write(
              `GET http://[ HTTP/1.1\r\nHost: [\r\n${upgrade}Connection: ${upgrade ? "Upgrade" : "close"}\r\n\r\n`,
            ),
          );
          socket.on("data", (chunk) => {
            data += chunk;
          });
          socket.on("end", () => resolve(data));
          socket.on("error", reject);
          socket.setTimeout(300, () => {
            socket.destroy();
            resolve(data);
          });
        });
        expect(response).toContain("400");
        expect((await fetch(`${gateway.url}/health`)).status).toBe(200);
      } finally {
        await gateway.close();
      }
    },
  );
});
