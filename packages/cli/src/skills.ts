import { resolve } from "node:path";
import {
  type DefaultSkills,
  singleAgentProfileId,
} from "@truss-harness/agent-host";
import type { GatewaySkillController } from "@truss-harness/gateway";
import type { RemoteSkillState } from "@truss-harness/runtime";
import type {
  RuntimeServiceSkills,
  RuntimeServiceSkillState,
} from "./protocol-contracts.js";

/** Exposes the shared skill service to protocol clients for one workspace. */
export function skillServiceHost(
  skills: DefaultSkills,
  workspaceRoot: string,
  options: { readonly agentId?: string; readonly manage?: boolean } = {},
): RuntimeServiceSkills {
  const agentId = options.agentId ?? singleAgentProfileId;
  const state = async (
    sessionId: string | undefined,
  ): Promise<RuntimeServiceSkillState> => {
    const listing = await skills.registry.list();
    return {
      skills: listing.skills,
      diagnostics: listing.diagnostics,
      selection: await skills.selection({
        agentId,
        ...(sessionId === undefined ? {} : { sessionId }),
      }),
    };
  };
  return {
    list: state,
    async setSettings(scope, sessionId, selection) {
      await skills.settings.setSettings(
        scope === "user"
          ? {}
          : scope === "workspace"
            ? { workspaceRoot }
            : { workspaceRoot, sessionId },
        selection,
      );
      return state(sessionId);
    },
    ...(options.manage === false
      ? {}
      : {
          import: (input) => skills.store.import(input),
          remove: async (id) => {
            await skills.store.remove(id);
            await skills.settings.forget(id);
          },
        }),
  };
}

const commandUsage = `Usage:
  skills [list] [--json]           Show skills and the effective selection
  skills add <directory>           Import a skill directory into your skills
  skills remove <id>               Remove one of your imported skills
  skills mode <automatic|manual|off>
  skills superpowers <on|off>      Enable or disable the bundled Superpowers pack
  skills select [<id>...]          Choose always-active skills (none to clear)
Add --workspace to save mode, superpowers and select for this workspace only.`;

function describeSelection(selection: {
  readonly mode: string;
  readonly superpowersEnabled: boolean;
  readonly skillIds: readonly string[];
}): string {
  return `Mode: ${selection.mode}  Superpowers: ${selection.superpowersEnabled ? "on" : "off"}  Selected: ${selection.skillIds.length ? selection.skillIds.join(", ") : "none"}`;
}

/** Scriptable `skills` command. Returns the process exit code. */
export async function runSkillsCommand(
  args: readonly string[],
  skills: DefaultSkills,
  workspaceRoot: string,
  write: (text: string) => void,
): Promise<number> {
  const service = skillServiceHost(skills, workspaceRoot);
  const workspace = args.includes("--workspace");
  const json = args.includes("--json");
  const [action = "list", ...values] = args.filter(
    (argument) => argument !== "--workspace" && argument !== "--json",
  );
  const scope = workspace ? "workspace" : "user";
  const report = async () => {
    const state = await service.list();
    if (json) {
      write(`${JSON.stringify(state, null, 2)}\n`);
      return;
    }
    write(`${describeSelection(state.selection)}\n`);
    for (const skill of state.skills)
      write(
        `  ${skill.id}${skill.trusted ? "" : " (untrusted: import to use)"}\t${skill.description}\n`,
      );
    for (const diagnostic of state.diagnostics)
      write(`  ! ${diagnostic.skillId ?? "skill"}: ${diagnostic.message}\n`);
  };
  if (action === "list") {
    await report();
    return 0;
  }
  if (action === "add" && values.length === 1) {
    const skill = await skills.store.import({
      kind: "directory",
      path: resolve(workspaceRoot, values[0] ?? ""),
    });
    write(`Imported ${skill.id}\n`);
    return 0;
  }
  if (action === "remove" && values.length === 1) {
    await service.remove?.(values[0] ?? "");
    write(`Removed ${values[0]}\n`);
    return 0;
  }
  if (action === "mode" && values.length === 1) {
    const state = await service.setSettings(scope, undefined, {
      mode: values[0] as "automatic",
    });
    write(`${describeSelection(state.selection)}\n`);
    return 0;
  }
  if (
    action === "superpowers" &&
    values.length === 1 &&
    (values[0] === "on" || values[0] === "off")
  ) {
    const state = await service.setSettings(scope, undefined, {
      superpowersEnabled: values[0] === "on",
    });
    write(`${describeSelection(state.selection)}\n`);
    return 0;
  }
  if (action === "select") {
    const state = await service.setSettings(scope, undefined, {
      skillIds: values,
    });
    write(`${describeSelection(state.selection)}\n`);
    return 0;
  }
  write(`${commandUsage}\n`);
  return action === "help" ? 0 : 2;
}

/** Paired-device view: list and workspace/session settings only, never import or remove. */
export function gatewaySkillController(
  skills: DefaultSkills,
  workspaceRoot: string,
): GatewaySkillController {
  const service = skillServiceHost(skills, workspaceRoot, { manage: false });
  const remote = (state: RuntimeServiceSkillState): RemoteSkillState => ({
    skills: state.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      ...(skill.bundle ? { bundle: skill.bundle } : {}),
      trusted: skill.trusted,
    })),
    selection: state.selection,
  });
  return {
    list: async (sessionId) => remote(await service.list(sessionId)),
    setSettings: async (scope, sessionId, selection) =>
      remote(await service.setSettings(scope, sessionId, selection)),
  };
}
