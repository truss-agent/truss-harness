import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { brand } from "@truss-harness/branding";

export type PlanStepStatus = "pending" | "in_progress" | "completed";

export interface WorkspacePlanStep {
  readonly id: string;
  readonly content: string;
  readonly status: PlanStepStatus;
}

export interface WorkspacePlan {
  readonly version: 1;
  readonly id: string;
  readonly title: string;
  readonly objective: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly status: "active" | "completed";
  readonly steps: readonly WorkspacePlanStep[];
}

export interface WorkspacePlanStore {
  load(): Promise<WorkspacePlan | undefined>;
  create(input: { readonly title: string; readonly objective: string; readonly steps: readonly string[] }): Promise<WorkspacePlan>;
  updateStep(stepId: string, status: PlanStepStatus): Promise<WorkspacePlan>;
}

function isPlan(value: unknown): value is WorkspacePlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as Partial<WorkspacePlan>;
  return plan.version === 1 && typeof plan.id === "string" && typeof plan.title === "string" && typeof plan.objective === "string"
    && typeof plan.createdAt === "string" && typeof plan.updatedAt === "string" && (plan.status === "active" || plan.status === "completed")
    && Array.isArray(plan.steps) && plan.steps.every((step) => step && typeof step.id === "string" && typeof step.content === "string"
      && (step.status === "pending" || step.status === "in_progress" || step.status === "completed"));
}

/** Extracts the checklist the planning prompt asks local models to return. */
export function parseAgentPlan(text: string, objective: string): { readonly title: string; readonly steps: readonly string[] } | undefined {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const heading = lines.find((line) => /^#{1,3}\s+(?:plan\s*:?\s*)?/i.test(line));
  const title = heading?.replace(/^#{1,3}\s+/, "").replace(/^plan\s*:?\s*/i, "").trim() || objective.replace(/\s+/g, " ").slice(0, 80);
  const steps = lines.flatMap((line) => {
    const match = line.match(/^\s*(?:[-*+]\s+\[[ xX]\]|\d+[.)])\s+(.+?)\s*$/);
    return match?.[1] ? [match[1]] : [];
  }).filter((step, index, all) => step.length > 2 && all.indexOf(step) === index).slice(0, 12);
  return steps.length ? { title, steps } : undefined;
}

/** Durable active plan stored separately from source files and intended to be Git-ignored. */
export class FileWorkspacePlanStore implements WorkspacePlanStore {
  private pendingWrite: Promise<void> = Promise.resolve();
  readonly path: string;

  constructor(workspaceRoot: string, path = join(workspaceRoot, brand.workspaceDirectory, "plans", "active.json")) {
    this.path = path;
  }

  async load(): Promise<WorkspacePlan | undefined> {
    try {
      const plan = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      return isPlan(plan) ? plan : undefined;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async create(input: { readonly title: string; readonly objective: string; readonly steps: readonly string[] }): Promise<WorkspacePlan> {
    const now = new Date().toISOString();
    const plan: WorkspacePlan = {
      version: 1,
      id: randomUUID(),
      title: input.title,
      objective: input.objective,
      createdAt: now,
      updatedAt: now,
      status: "active",
      steps: input.steps.map((content, index) => ({ id: `step-${index + 1}`, content, status: "pending" }))
    };
    await this.queueWrite(plan);
    return plan;
  }

  async updateStep(stepId: string, status: PlanStepStatus): Promise<WorkspacePlan> {
    const current = await this.load();
    if (!current) throw new Error("No active plan exists. Create a plan in Plan mode first.");
    if (!current.steps.some((step) => step.id === stepId)) throw new Error(`Unknown plan step '${stepId}'.`);
    const steps = current.steps.map((step) => step.id === stepId ? { ...step, status } : step);
    const plan: WorkspacePlan = { ...current, steps, status: steps.every((step) => step.status === "completed") ? "completed" : "active", updatedAt: new Date().toISOString() };
    await this.queueWrite(plan);
    return plan;
  }

  private async queueWrite(plan: WorkspacePlan): Promise<void> {
    this.pendingWrite = this.pendingWrite.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
      await rename(temporary, this.path);
    });
    return this.pendingWrite;
  }
}
