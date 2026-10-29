import type { RuntimeServiceSkillState } from "@truss-harness/cli/protocol";
import type { SkillMode } from "@truss-harness/runtime";
import * as vscode from "vscode";
import type { RuntimeService } from "./runtime-service.js";
import {
  type SkillMenuItem,
  type SkillScope,
  selectableSkills,
  skillMenuItems,
  skillStatusText,
  superpowersToggle,
} from "./skill-menu.js";

/** Skill settings over the local service, shared with every Truss client. */
export class SkillCommands {
  private scope: SkillScope = "user";

  constructor(private readonly service: () => Promise<RuntimeService>) {}

  registerCommands(): readonly vscode.Disposable[] {
    return [
      vscode.commands.registerCommand("trussHarness.manageSkills", () =>
        this.manage().catch((error: unknown) =>
          vscode.window.showErrorMessage(
            error instanceof Error ? error.message : String(error),
          ),
        ),
      ),
    ];
  }

  private async manage(): Promise<void> {
    const service = await this.service();
    const support = await service.skillCapabilities();
    if (!support.skills) {
      void vscode.window.showWarningMessage(
        "This Truss service does not support skills. Update truss-cli or clear trussHarness.command to use the bundled service.",
      );
      return;
    }
    let state = await service.listSkills();
    for (;;) {
      const choice = await vscode.window.showQuickPick<
        vscode.QuickPickItem & SkillMenuItem
      >(skillMenuItems(state, this.scope, support.skillManagement), {
        title: "Truss Skills",
        placeHolder: skillStatusText(state),
      });
      if (!choice) return;
      if (choice.action === "scope") {
        this.scope = this.scope === "user" ? "workspace" : "user";
        continue;
      }
      const next = await this.apply(service, state, choice.action);
      if (next) state = next;
    }
  }

  private async apply(
    service: RuntimeService,
    state: RuntimeServiceSkillState,
    action: SkillMenuItem["action"],
  ): Promise<RuntimeServiceSkillState | undefined> {
    if (action === "mode") {
      const mode = await vscode.window.showQuickPick(
        [
          { label: "Automatic", value: "automatic" as SkillMode },
          { label: "Manual", value: "manual" as SkillMode },
          { label: "Off", value: "off" as SkillMode },
        ],
        { title: "Skill mode" },
      );
      return mode
        ? service.updateSkillSettings(this.scope, { mode: mode.value })
        : undefined;
    }
    if (action === "superpowers")
      return service.updateSkillSettings(
        this.scope,
        superpowersToggle(state.selection),
      );
    if (action === "select") {
      const selected = new Set(state.selection.skillIds);
      const picks = await vscode.window.showQuickPick(
        selectableSkills(state).map((skill) => ({
          label: skill.id,
          detail: skill.description,
          picked: selected.has(skill.id),
        })),
        {
          title: "Always-active skills",
          placeHolder: "Selected skills run in every conversation.",
          canPickMany: true,
          matchOnDetail: true,
        },
      );
      return picks
        ? service.updateSkillSettings(this.scope, {
            skillIds: picks.map((pick) => pick.label),
          })
        : undefined;
    }
    if (action === "import") {
      const folder = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Import skill",
        title: "Choose a folder that contains SKILL.md",
      });
      const path = folder?.[0]?.fsPath;
      return path ? service.importSkill(path) : undefined;
    }
    if (action === "remove") {
      const pick = await vscode.window.showQuickPick(
        state.skills
          .filter((skill) => skill.source === "user")
          .map((skill) => ({ label: skill.id, detail: skill.description })),
        { title: "Remove a skill" },
      );
      if (!pick) return undefined;
      const confirmed = await vscode.window.showWarningMessage(
        `Remove ${pick.label}? Every Truss client stops using it.`,
        { modal: true },
        "Remove",
      );
      return confirmed === "Remove"
        ? service.removeSkill(pick.label)
        : undefined;
    }
    return service.updateSkillSettings("workspace", null);
  }
}
