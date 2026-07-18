import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileWorkspacePlanStore, parseAgentPlan } from "./plans.js";

const workspaces: string[] = [];

async function workspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "truss-plans-"));
  workspaces.push(directory);
  return directory;
}

afterEach(async () => { await Promise.all(workspaces.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("workspace plans", () => {
  it("parses a model checklist into a durable plan", async () => {
    const parsed = parseAgentPlan("# Plan: Improve the CLI\n- [ ] Add the runtime contract\n- [ ] Render progress in clients", "Improve the CLI");
    expect(parsed).toEqual({ title: "Improve the CLI", steps: ["Add the runtime contract", "Render progress in clients"] });

    const store = new FileWorkspacePlanStore(await workspace());
    const plan = await store.create({ title: parsed!.title, objective: "Improve the CLI", steps: parsed!.steps });
    const updated = await store.updateStep("step-1", "completed");

    expect(plan.steps[0]?.status).toBe("pending");
    expect(updated.steps[0]?.status).toBe("completed");
    await expect(store.load()).resolves.toEqual(updated);
  });
});
