import { createRoom } from "./room.js";
import type { ControlBridge, ControlSnapshot } from "./shared.js";

const bridge = (window as typeof window & { trussControlCenter: ControlBridge })
  .trussControlCenter;
let snapshot: ControlSnapshot = { workspaces: [], agents: [], runs: [] };
let selected = "";
let room: ReturnType<typeof createRoom> | undefined;
const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const workspaceList = $("workspaces"),
  agentList = $("agents"),
  details = $("details"),
  status = $("status"),
  roomHost = $("room");
function active(run: ControlSnapshot["runs"][number] | undefined): boolean {
  return Boolean(
    run && ["queued", "running", "waiting_for_approval"].includes(run.state),
  );
}
function render(): void {
  room ??= createRoom(roomHost, (id) => {
    selected = id;
    render();
  });
  room.update(snapshot);
  workspaceList.replaceChildren(
    ...snapshot.workspaces.map((workspace) => {
      const row = document.createElement("div");
      row.className = "workspace";
      const copy = document.createElement("div");
      copy.innerHTML = `<strong>${workspace.name}</strong><small>${workspace.root}</small>`;
      const remove = document.createElement("button");
      remove.textContent = "Remove";
      remove.onclick = () =>
        perform(() => bridge.removeWorkspace(workspace.id));
      row.append(copy, remove);
      return row;
    }),
  );
  const select = $("workspace") as HTMLSelectElement;
  select.replaceChildren(
    ...snapshot.workspaces.map(
      (workspace) => new Option(workspace.name, workspace.id),
    ),
  );
  agentList.replaceChildren(
    ...snapshot.agents.map((agent) => {
      const run =
        snapshot.runs.find(
          (item) => item.agentId === agent.id && active(item),
        ) ?? snapshot.runs.find((item) => item.agentId === agent.id);
      const button = document.createElement("button");
      button.className = "agent";
      button.setAttribute("aria-pressed", String(agent.id === selected));
      button.textContent = `${agent.displayName} · ${snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ?? "missing workspace"} · ${run?.state.replaceAll("_", " ") ?? "idle"}`;
      button.onclick = () => {
        selected = agent.id;
        render();
      };
      agentList.append(button);
      return button;
    }),
  );
  details.replaceChildren();
  const agent = snapshot.agents.find((item) => item.id === selected);
  const run = agent
    ? (snapshot.runs.find(
        (item) => item.agentId === agent.id && active(item),
      ) ?? snapshot.runs.find((item) => item.agentId === agent.id))
    : undefined;
  if (agent) {
    const heading = document.createElement("h2");
    heading.textContent = agent.displayName;
    const meta = document.createElement("p");
    meta.textContent = `${agent.mode} agent · ${agent.provider.providerId} · ${agent.provider.modelId}`;
    details.append(heading, meta);
    if (run) {
      const progress = document.createElement("p");
      progress.textContent =
        run.latestProgress ?? run.error?.message ?? run.prompt;
      details.append(progress);
      if (run.output) {
        const output = document.createElement("pre");
        output.textContent = run.output;
        details.append(output);
      }
      if (active(run)) {
        const stop = document.createElement("button");
        stop.textContent = "Stop run";
        stop.onclick = () => perform(() => bridge.stopAgent(run.id));
        details.append(stop);
      }
      if (run.state === "waiting_for_approval" && run.activeTool) {
        const callId = run.activeTool.callId;
        const approval = document.createElement("p");
        approval.textContent = `Permission: ${run.activeTool.name}`;
        details.append(approval);
        for (const allowed of [true, false]) {
          const button = document.createElement("button");
          button.textContent = allowed ? "Allow" : "Deny";
          button.onclick = () =>
            perform(() => bridge.resolveApproval(run.id, callId, allowed));
          details.append(button);
        }
      }
    }
  } else
    details.textContent =
      "Select an agent to assign work or inspect its live run.";
  $("start").toggleAttribute("disabled", !agent || active(run));
  $("delete").toggleAttribute("disabled", !agent || active(run));
}
async function perform(
  action: () => Promise<ControlSnapshot | undefined>,
): Promise<void> {
  status.textContent = "Working…";
  try {
    const next = await action();
    if (next) {
      snapshot = next;
      render();
    }
    status.textContent = "Ready.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
$("add-workspace").onclick = () => perform(() => bridge.chooseWorkspace());
async function refreshModels(): Promise<void> {
  const provider = $("provider") as HTMLSelectElement;
  const endpoint = $("endpoint") as HTMLInputElement;
  const refresh = $("refresh-models") as HTMLButtonElement;
  refresh.disabled = true;
  status.textContent = "Looking for models…";
  try {
    const models = await bridge.discoverLocalModels(
      provider.value as "ollama" | "openai-compatible" | "llama-cpp",
      endpoint.value,
    );
    const choices = $("models") as HTMLDataListElement;
    choices.replaceChildren(...models.map((model) => new Option(model)));
    const model = $("model") as HTMLInputElement;
    if (models[0]) model.value = models[0];
    status.textContent = models.length
      ? `Found ${models.length} model${models.length === 1 ? "" : "s"}.`
      : "No models were advertised. You can still enter a model ID manually.";
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? `${error.message} You can still enter a model ID manually.`
        : "Model discovery failed. You can still enter a model ID manually.";
  } finally {
    refresh.disabled = false;
  }
}
$("refresh-models").onclick = () => void refreshModels();
$("detect-models").onclick = () =>
  void (async () => {
    const button = $("detect-models") as HTMLButtonElement;
    button.disabled = true;
    status.textContent = "Checking Ollama, LM Studio, and llama.cpp…";
    try {
      const endpoints = await bridge.detectLocalEndpoints();
      if (!endpoints.length) {
        status.textContent =
          "No local model server responded. Start its server, then try again.";
        return;
      }
      const endpoint = endpoints[0];
      if (!endpoint) return;
      ($("provider") as HTMLSelectElement).value = endpoint.providerId;
      ($("endpoint") as HTMLInputElement).value = endpoint.baseUrl;
      status.textContent = `Found ${endpoint.label}. Refreshing its models…`;
      await refreshModels();
    } catch (error) {
      status.textContent =
        error instanceof Error
          ? error.message
          : "Local server discovery failed.";
    } finally {
      button.disabled = false;
    }
  })();
$("provider").onchange = () => {
  const provider = ($("provider") as HTMLSelectElement).value;
  const endpoint = $("endpoint") as HTMLInputElement;
  endpoint.value =
    provider === "ollama"
      ? "http://127.0.0.1:11434"
      : provider === "llama-cpp"
        ? "http://127.0.0.1:8080/v1"
        : "http://127.0.0.1:1234/v1";
};
$("create").onclick = () =>
  perform(() =>
    bridge.createAgent({
      workspaceId: ($("workspace") as HTMLSelectElement).value,
      displayName: ($("name") as HTMLInputElement).value,
      mode: ($("mode") as HTMLSelectElement).value as "plan" | "edit",
      approvalPolicy: ($("approval") as HTMLSelectElement).value as
        | "ask"
        | "auto-read"
        | "auto-all",
      internetAccess: false,
      provider: {
        providerId: ($("provider") as HTMLSelectElement).value,
        endpointUrl: ($("endpoint") as HTMLInputElement).value,
        modelId: ($("model") as HTMLInputElement).value,
      },
    }),
  );
$("start").onclick = () => {
  const task = ($("task") as HTMLTextAreaElement).value;
  if (selected && task.trim())
    void perform(() => bridge.startAgent(selected, task));
};
$("delete").onclick = () =>
  selected && perform(() => bridge.deleteAgent(selected));
bridge.onSnapshot((next) => {
  snapshot = next;
  render();
});
void bridge.snapshot().then((next) => {
  snapshot = next;
  selected = next.agents[0]?.id ?? "";
  render();
});
