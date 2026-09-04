import { join } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { ControlCenterService } from "./main/control-center-service.js";

let window: BrowserWindow | undefined;
let service: ControlCenterService;
function send(snapshot: Awaited<ReturnType<typeof service.snapshot>>): void {
  window?.webContents.send("control-center:snapshot", snapshot);
}

void app.whenReady().then(async () => {
  service = new ControlCenterService(
    join(app.getPath("userData"), "control-center.json"),
  );
  await service.load();
  service.subscribe(send);
  ipcMain.handle("control-center:snapshot", () => service.snapshot());
  ipcMain.handle("control-center:detect-local-endpoints", () =>
    service.discoverLocalEndpoints(),
  );
  ipcMain.handle(
    "control-center:discover-local-models",
    (_event, providerId, endpointUrl) =>
      service.discoverLocalModels(providerId, endpointUrl),
  );
  ipcMain.handle("control-center:choose-workspace", async () => {
    const choice = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    return choice.canceled || !choice.filePaths[0]
      ? undefined
      : service.addWorkspace(choice.filePaths[0]);
  });
  ipcMain.handle("control-center:remove-workspace", (_event, id) =>
    service.removeWorkspace(id),
  );
  ipcMain.handle("control-center:create-agent", (_event, input) =>
    service.createAgent(input),
  );
  ipcMain.handle("control-center:delete-agent", (_event, id) =>
    service.deleteAgent(id),
  );
  ipcMain.handle("control-center:start-agent", (_event, id, prompt) =>
    service.startAgent(id, prompt),
  );
  ipcMain.handle("control-center:stop-agent", (_event, runId) =>
    service.stopAgent(runId),
  );
  ipcMain.handle(
    "control-center:resolve-approval",
    (_event, runId, callId, approved) =>
      service.resolveApproval(runId, callId, approved),
  );
  window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 940,
    minHeight: 650,
    title: "Truss Control Center",
    autoHideMenuBar: true,
    backgroundColor: "#101914",
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(join(app.getAppPath(), "dist", "index.html"));
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  void service.dispose();
});
