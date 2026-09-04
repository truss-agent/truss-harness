import { contextBridge, ipcRenderer } from "electron";
import type {
  ControlBridge,
  ControlSnapshot,
  CreateControlAgentInput,
} from "./shared.js";

const bridge: ControlBridge = {
  snapshot: () => ipcRenderer.invoke("control-center:snapshot"),
  chooseWorkspace: () => ipcRenderer.invoke("control-center:choose-workspace"),
  removeWorkspace: (id) =>
    ipcRenderer.invoke("control-center:remove-workspace", id),
  createAgent: (input: CreateControlAgentInput) =>
    ipcRenderer.invoke("control-center:create-agent", input),
  deleteAgent: (id) => ipcRenderer.invoke("control-center:delete-agent", id),
  startAgent: (id, prompt) =>
    ipcRenderer.invoke("control-center:start-agent", id, prompt),
  stopAgent: (runId) => ipcRenderer.invoke("control-center:stop-agent", runId),
  resolveApproval: (runId, callId, approved) =>
    ipcRenderer.invoke(
      "control-center:resolve-approval",
      runId,
      callId,
      approved,
    ),
  onSnapshot: (listener: (snapshot: ControlSnapshot) => void) => {
    const handler = (_: Electron.IpcRendererEvent, snapshot: ControlSnapshot) =>
      listener(snapshot);
    ipcRenderer.on("control-center:snapshot", handler);
    return () => ipcRenderer.removeListener("control-center:snapshot", handler);
  },
};
contextBridge.exposeInMainWorld("trussControlCenter", bridge);
