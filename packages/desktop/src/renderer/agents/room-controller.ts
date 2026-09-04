import type { DesktopBridge } from "../../shared.js";
import {
  handoffBrief,
  isActiveRun,
  type RoomSnapshot,
  roomAgents,
} from "./room-model.js";
import { type AgentRoomScene, createAgentRoomScene } from "./room-scene.js";

type RoomCommands = Pick<
  DesktopBridge,
  "startAgent" | "stopAgent" | "resolveAgentApproval"
>;

/** Owns room interaction; all execution remains behind the injected runtime bridge. */
export class AgentRoomController {
  readonly element = document.createElement("section");
  private readonly canvas = document.createElement("div");
  private readonly roster = document.createElement("div");
  private readonly detail = document.createElement("div");
  private readonly lead = document.createElement("select");
  private readonly task = document.createElement("textarea");
  private readonly notice = document.createElement("p");
  private readonly start: HTMLButtonElement;
  private readonly meeting: HTMLButtonElement;
  private scene?: AgentRoomScene;
  private snapshot: RoomSnapshot = { profiles: [], runs: [] };
  private selectedId?: string;
  private workspace = "";
  private leadId = "";
  private busy = false;
  private disposed = false;

  constructor(
    private readonly commands: RoomCommands,
    private readonly changed: (snapshot: RoomSnapshot) => void,
  ) {
    this.element.className = "agent-room";
    const header = document.createElement("div");
    header.className = "room-toolbar";
    const title = document.createElement("div");
    title.innerHTML =
      "<strong>Agent Room</strong><small>LIVE WORKSPACE · LOCAL PREVIEW</small>";
    const leadLabel = document.createElement("label");
    leadLabel.textContent = "Team lead ";
    this.lead.setAttribute("aria-label", "Team lead");
    this.lead.onchange = () => {
      this.leadId = this.lead.value;
      try {
        localStorage.setItem(this.storageKey(), this.leadId);
      } catch {
        /* Session-only when storage is unavailable. */
      }
      this.render();
    };
    leadLabel.append(this.lead);
    const reset = this.button("Reset camera", () => this.scene?.reset());
    const toggle = this.button("Show 3D room", () => {
      if (this.scene) {
        this.scene.dispose();
        this.scene = undefined;
        this.canvas.hidden = true;
        toggle.textContent = "Show 3D room";
        toggle.setAttribute("aria-expanded", "false");
      } else {
        this.canvas.hidden = false;
        try {
          this.scene = createAgentRoomScene(this.canvas, (id) => {
            this.selectedId = id;
            this.render();
          });
          this.scene.update(roomAgents(this.snapshot, this.leadId));
          toggle.textContent = "Hide 3D room";
          toggle.setAttribute("aria-expanded", "true");
        } catch {
          this.canvas.replaceChildren();
          this.canvas.hidden = true;
          this.notice.textContent =
            "3D is unavailable on this device. All agent controls remain available below.";
        }
      }
    });
    toggle.setAttribute("aria-expanded", "false");
    header.append(title, leadLabel, reset, toggle);
    this.canvas.className = "room-canvas";
    this.canvas.hidden = true;
    const legend = document.createElement("p");
    legend.className = "room-legend";
    legend.textContent =
      "DESKS · Working / idle     TABLE · Planning     FRONT · Work ready     GOLD · Approval needed. Drag to orbit; scroll to zoom; click a person to inspect.";
    this.roster.className = "room-roster";
    this.roster.setAttribute("aria-label", "Agents in the room");
    this.detail.className = "room-detail";
    this.task.rows = 4;
    this.task.placeholder =
      "Write a task, meeting agenda, or handoff instructions…";
    this.task.setAttribute("aria-label", "Room task or meeting agenda");
    this.task.oninput = () => this.updateActions();
    this.start = this.button("Assign task", () => {
      const id = this.selectedId;
      if (id)
        void this.execute(async () => {
          this.changed(await this.commands.startAgent(id, this.task.value));
        });
    });
    this.meeting = this.button("Start planning meeting", () => {
      const agenda = this.task.value.trim();
      const participants = this.snapshot.profiles.filter(
        (profile) =>
          profile.mode === "plan" &&
          !this.snapshot.runs.some(
            (run) => run.agentId === profile.id && isActiveRun(run),
          ),
      );
      void this.execute(async () => {
        const failures: string[] = [];
        // Starting a run returns immediately; runtimes execute independently.
        for (const profile of participants) {
          try {
            this.changed(await this.commands.startAgent(profile.id, agenda));
          } catch (error) {
            failures.push(`${profile.displayName}: ${String(error)}`);
          }
        }
        if (failures.length) throw new Error(failures.join("\n"));
      });
    });
    const help = document.createElement("p");
    help.className = "room-help";
    help.textContent =
      "Meetings send your agenda to every idle Plan agent for independent planning. Hand work to the lead for synthesis. The lead is your chosen reviewer; task delegation is user-directed. Create agents and choose their modes below.";
    const actions = document.createElement("div");
    actions.className = "room-toolbar";
    actions.append(this.start, this.meeting);
    this.notice.setAttribute("role", "status");
    this.element.append(
      header,
      this.canvas,
      legend,
      this.roster,
      this.detail,
      this.task,
      actions,
      help,
      this.notice,
    );
  }

  update(snapshot: RoomSnapshot, workspace: string): void {
    if (this.workspace !== workspace) {
      this.workspace = workspace;
      this.selectedId = undefined;
      this.task.value = "";
      this.leadId = "";
      try {
        this.leadId = localStorage.getItem(this.storageKey()) ?? "";
      } catch {
        /* Optional preference. */
      }
    }
    this.snapshot = snapshot;
    if (!snapshot.profiles.some((profile) => profile.id === this.leadId))
      this.leadId = "";
    if (!snapshot.profiles.some((profile) => profile.id === this.selectedId))
      this.selectedId = snapshot.profiles[0]?.id;
    this.render();
  }

  dispose(): void {
    this.disposed = true;
    this.scene?.dispose();
  }

  private storageKey(): string {
    return `truss:agent-room:lead:${this.workspace}`;
  }

  private button(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.onclick = action;
    return button;
  }

  private async execute(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.notice.textContent = "Sending to runtime…";
    this.render();
    try {
      await action();
      this.notice.textContent = "Request sent to runtime.";
    } catch (error) {
      this.notice.textContent =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
      if (!this.disposed) this.render();
    }
  }

  private updateActions(): void {
    const agent = roomAgents(this.snapshot, this.leadId).find(
      (value) => value.id === this.selectedId,
    );
    this.start.disabled =
      this.busy ||
      !this.task.value.trim() ||
      !agent ||
      Boolean(agent.run && isActiveRun(agent.run));
    this.meeting.disabled =
      this.busy ||
      !this.task.value.trim() ||
      !this.snapshot.profiles.some(
        (profile) =>
          profile.mode === "plan" &&
          !this.snapshot.runs.some(
            (run) => run.agentId === profile.id && isActiveRun(run),
          ),
      );
  }

  private render(): void {
    const agents = roomAgents(this.snapshot, this.leadId);
    this.scene?.update(agents);
    this.lead.replaceChildren(
      new Option("Choose a lead", ""),
      ...agents.map((agent) => new Option(agent.name, agent.id)),
    );
    this.lead.value = this.leadId;
    this.roster.replaceChildren(
      ...agents.map((agent) => {
        const button = this.button(
          `${agent.lead ? "★ " : ""}${agent.name} · ${agent.status}`,
          () => {
            this.selectedId = agent.id;
            this.render();
          },
        );
        button.setAttribute(
          "aria-pressed",
          String(agent.id === this.selectedId),
        );
        return button;
      }),
    );
    const selected = agents.find((agent) => agent.id === this.selectedId);
    this.detail.replaceChildren();
    const summary = document.createElement("p");
    summary.textContent = selected
      ? `${selected.name}${selected.lead ? " · Team lead" : this.leadId ? ` · Reports to ${agents.find((agent) => agent.lead)?.name}` : ""} — ${selected.status}`
      : "Your office is ready. Create agents below to fill their desks.";
    this.detail.append(summary);
    const run = selected?.run;
    if (run) {
      const progress = document.createElement("p");
      progress.textContent =
        run.error?.message ?? run.latestProgress ?? run.prompt;
      this.detail.append(progress);
      if (isActiveRun(run)) {
        const stop = this.button("Stop selected agent", () => {
          void this.execute(async () => {
            this.changed(await this.commands.stopAgent(run.id));
          });
        });
        stop.disabled = this.busy;
        this.detail.append(stop);
      }
      if (run.state === "waiting_for_approval" && run.activeTool) {
        const approval = document.createElement("p");
        approval.textContent = `Permission requested: ${run.activeTool.name}`;
        this.detail.append(approval);
        const callId = run.activeTool.callId;
        for (const approved of [true, false]) {
          const button = this.button(
            approved ? "Allow tool" : "Deny tool",
            () => {
              void this.execute(async () => {
                this.changed(
                  await this.commands.resolveAgentApproval(
                    run.id,
                    callId,
                    approved,
                  ),
                );
              });
            },
          );
          button.disabled = this.busy;
          this.detail.append(button);
        }
      }
      if (run.output) {
        const output = document.createElement("pre");
        output.className = "room-output";
        output.textContent = run.output;
        this.detail.append(output);
      }
      if (run.changedFiles.length) {
        const files = document.createElement("p");
        files.textContent = `Changed files: ${run.changedFiles.join(", ")}`;
        this.detail.append(files);
      }
      if (run.state === "completed") {
        if (selected?.lead) {
          for (const worker of agents.filter((agent) => !agent.lead)) {
            const delegate = this.button(
              `Prepare task for ${worker.name}`,
              () => {
                this.task.value = handoffBrief(run);
                this.selectedId = worker.id;
                this.notice.textContent =
                  "Add the worker's assignment to the lead's brief, then choose Assign task.";
                this.render();
                this.task.focus();
              },
            );
            delegate.disabled =
              this.busy || Boolean(worker.run && isActiveRun(worker.run));
            this.detail.append(delegate);
          }
        }
        const handoff = this.button("Prepare handoff to lead", () => {
          this.task.value = handoffBrief(run);
          this.selectedId = this.leadId;
          this.notice.textContent =
            "Add your review instructions to the handoff, then choose Assign task to send it to the lead.";
          this.render();
          this.task.focus();
        });
        handoff.disabled =
          this.busy || !this.leadId || this.leadId === selected?.id;
        this.detail.append(handoff);
      }
    }
    this.updateActions();
  }
}
