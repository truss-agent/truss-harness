import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as SecureStore from "expo-secure-store";

type ChatItem = { readonly id: string; readonly role: "user" | "assistant" | "system"; readonly content: string };
type AgentMode = "chat" | "plan" | "edit";
type ApprovalMode = "ask" | "auto-read" | "auto-all";
type Screen = "home" | "settings" | "session" | "scanner";
type SavedGateway = { readonly id: string; readonly name: string; readonly url: string; readonly token: string };
type Workspace = { readonly id: string; readonly displayName: string; readonly capabilities: { readonly modes: readonly AgentMode[]; readonly toolApprovalModes?: readonly ApprovalMode[] } };
type RemoteEvent = { readonly type: string; readonly sessionId?: string; readonly text?: string; readonly message?: string; readonly callId?: string; readonly tool?: string; readonly input?: Record<string, unknown>; readonly result?: { readonly content: string; readonly isError?: boolean }; readonly modifiedFiles?: readonly string[] };
type ToolApproval = { readonly callId: string; readonly tool: string; readonly input: Record<string, unknown> };

const approvalCopy: Record<ApprovalMode, { readonly title: string; readonly detail: string }> = {
  ask: { title: "Ask every time", detail: "Confirm each workspace tool before it runs." },
  "auto-read": { title: "Auto-approve reads", detail: "Read-only file tools run automatically; changes and commands still ask." },
  "auto-all": { title: "Auto-approve all", detail: "Allow all registered tools for this trusted gateway." }
};
const readOnlyTools = new Set(["read_file", "list_directory", "search_files", "grep"]);
const savedGatewaysKey = "truss.remote.saved-gateways.v1";

function nextId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function gatewayPath(url: string, path: string): string { return `${url.replace(/\/$/, "")}${path}`; }
function eventUrl(url: string): string { return gatewayPath(url.replace(/^http/i, "ws"), "/v1/events"); }
function parsePairing(value: string): SavedGateway {
  const uri = new URL(value);
  if (uri.protocol !== "truss:" || uri.hostname !== "pair") throw new Error("This is not a Truss pairing QR code.");
  const url = uri.searchParams.get("gateway"); const token = uri.searchParams.get("token");
  if (!url || !token || token.length < 24 || !/^https?:\/\//.test(url)) throw new Error("The pairing QR code is incomplete.");
  return { id: url, name: uri.searchParams.get("name") ?? new URL(url).host, url, token };
}

export default function App() {
  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:4787");
  const [token, setToken] = useState("");
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("chat");
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("ask");
  const [screen, setScreen] = useState<Screen>("home");
  const [sessionId, setSessionId] = useState<string>();
  const [approval, setApproval] = useState<ToolApproval>();
  const [messages, setMessages] = useState<readonly ChatItem[]>([]);
  const [status, setStatus] = useState("Enter a trusted gateway URL and token.");
  const [running, setRunning] = useState(false);
  const [savedGateways, setSavedGateways] = useState<readonly SavedGateway[]>([]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const eventSocket = useRef<WebSocket | undefined>(undefined);
  const approvalModeRef = useRef<ApprovalMode>(approvalMode);
  const modeRef = useRef<AgentMode>(mode);

  useEffect(() => { void SecureStore.getItemAsync(savedGatewaysKey).then((value) => { if (value) setSavedGateways(JSON.parse(value) as SavedGateway[]); }).catch(() => undefined); }, []);
  const saveGateway = useCallback(async (gateway: SavedGateway) => {
    const next = [gateway, ...savedGateways.filter((item) => item.id !== gateway.id)];
    setSavedGateways(next); await SecureStore.setItemAsync(savedGatewaysKey, JSON.stringify(next));
  }, [savedGateways]);
  const pair = useCallback(async (value: string) => { const gateway = parsePairing(value); await saveGateway(gateway); setGatewayUrl(gateway.url); setToken(gateway.token); setScreen("home"); setStatus(`Paired with ${gateway.name}. Connect to continue.`); }, [saveGateway]);

  const command = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch(gatewayPath(gatewayUrl, "/v1/commands"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ version: 1, requestId: nextId(), ...body })
    });
    const result = await response.json() as { type: string; sessionId?: string; message?: string };
    if (!response.ok || result.type === "rejected") throw new Error(result.message ?? "Gateway rejected the request.");
    return result;
  }, [gatewayUrl, token]);

  const appendAssistant = useCallback((text: string) => {
    setMessages((current) => {
      const last = current.at(-1);
      return last?.role === "assistant"
        ? [...current.slice(0, -1), { ...last, content: last.content + text }]
        : [...current, { id: nextId(), role: "assistant", content: text }];
    });
  }, []);

  const appendSystem = useCallback((content: string) => {
    setMessages((current) => [...current, { id: nextId(), role: "system", content }]);
  }, []);

  useEffect(() => { approvalModeRef.current = approvalMode; }, [approvalMode]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const handleEvent = useCallback((event: RemoteEvent) => {
    if (event.type === "text_delta" && event.text) appendAssistant(event.text);
    if (event.type === "run_started") { setRunning(true); setStatus("Agent is working."); }
    if (event.type === "run_completed") {
      setRunning(false);
      setStatus("Run completed.");
      if (modeRef.current === "edit") appendSystem(event.modifiedFiles?.length ? `Verified workspace changes: ${event.modifiedFiles.join(", ")}` : "Run completed. No workspace files were changed.");
    }
    if (event.type === "run_failed") { setRunning(false); setStatus(event.message ?? "Run failed."); }
    const activeApprovalMode = approvalModeRef.current;
    if (event.type === "tool_call_requested" && event.tool && (activeApprovalMode === "auto-all" || (activeApprovalMode === "auto-read" && readOnlyTools.has(event.tool)))) {
      setStatus(`Running ${event.tool.replaceAll("_", " ")}...`);
    } else if (event.type === "tool_call_requested" && event.callId && event.tool && event.input) {
      setApproval({ callId: event.callId, tool: event.tool, input: event.input });
      setStatus("Tool approval required.");
    }
    if (event.type === "tool_completed" && event.tool && event.result?.isError) {
      const detail = event.result.content.length > 360 ? `${event.result.content.slice(0, 357)}...` : event.result.content;
      setStatus(`${event.tool.replaceAll("_", " ")} failed.`);
      appendSystem(`${event.tool} failed: ${detail}`);
    }
  }, [appendAssistant, appendSystem]);

  const connectEvents = useCallback(() => new Promise<void>((resolve, reject) => {
    eventSocket.current?.close();
    const socket = new WebSocket(eventUrl(gatewayUrl));
    eventSocket.current = socket;
    let connected = false;
    socket.onopen = () => socket.send(JSON.stringify({ type: "authenticate", token }));
    socket.onmessage = ({ data }) => {
      let event: RemoteEvent;
      try { event = JSON.parse(String(data)) as RemoteEvent; } catch { return; }
      if (event.type === "connected") { connected = true; resolve(); return; }
      handleEvent(event);
    };
    socket.onerror = () => {
      if (!connected) reject(new Error("Unable to connect to the gateway event stream."));
      else setStatus("Gateway event stream disconnected.");
    };
    socket.onclose = () => { if (!connected) reject(new Error("Gateway rejected the event stream connection.")); };
  }), [gatewayUrl, handleEvent, token]);

  const connectGateway = useCallback(async () => {
    if (!token.trim()) throw new Error("A gateway token is required.");
    setStatus("Connecting to gateway...");
    await connectEvents();
    const response = await fetch(gatewayPath(gatewayUrl, "/v1/workspaces"), { headers: { authorization: `Bearer ${token}` } });
    const result = await response.json() as { workspaces?: Workspace[]; error?: string };
    if (!response.ok || !result.workspaces?.length) throw new Error(result.error ?? "The gateway has no available workspaces.");
    const first = result.workspaces[0];
    setWorkspaces(result.workspaces);
    setWorkspaceId(first.id);
    setApprovalMode(first.capabilities.toolApprovalModes?.[0] ?? "ask");
    setStatus("Choose a workspace and mode.");
  }, [connectEvents, gatewayUrl, token]);

  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  const availableApprovalModes = selectedWorkspace?.capabilities.toolApprovalModes ?? ["ask"] as const;

  const beginSession = useCallback(async () => {
    if (!workspaceId) throw new Error("Choose a workspace first.");
    if (!selectedWorkspace?.capabilities.modes.includes(mode)) throw new Error(`${selectedWorkspace?.displayName ?? "Workspace"} does not support ${mode} mode.`);
    const result = await command({ type: "create_session", workspaceId, mode, toolApprovalMode: approvalMode });
    setSessionId(result.sessionId);
    setMessages([]);
    setScreen("session");
    setStatus("Connected. Start a conversation.");
  }, [approvalMode, command, mode, selectedWorkspace, workspaceId]);

  const changeMode = useCallback(async (nextMode: AgentMode, nextApprovalMode = approvalMode) => {
    if (!sessionId) return;
    if (running) throw new Error("Wait for the current run to finish before changing modes.");
    const result = await command({ type: "change_session_mode", sessionId, mode: nextMode, toolApprovalMode: nextApprovalMode });
    setSessionId(result.sessionId);
    setMode(nextMode);
    setApprovalMode(nextApprovalMode);
    setApproval(undefined);
    setStatus(`Switched to ${nextMode} mode. Conversation history is retained.`);
  }, [approvalMode, command, running, sessionId]);

  const applySettings = useCallback(async () => {
    if (sessionId) await changeMode(mode, approvalMode);
    setScreen(sessionId ? "session" : "home");
    if (!sessionId) setStatus("Settings saved for the next session.");
  }, [approvalMode, changeMode, mode, sessionId]);

  const decideTool = useCallback(async (approved: boolean) => {
    if (!sessionId || !approval) return;
    await command({ type: "approve_tool", sessionId, callId: approval.callId, approved });
    setApproval(undefined);
    setStatus(approved ? "Tool approved." : "Tool denied.");
  }, [approval, command, sessionId]);

  const send = useCallback(async () => {
    if (!sessionId || !prompt.trim()) return;
    const content = prompt.trim();
    setPrompt("");
    setMessages((current) => [...current, { id: nextId(), role: "user", content }]);
    try { await command({ type: "send_message", sessionId, prompt: content }); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Message was not sent."); }
  }, [command, prompt, sessionId]);

  const interrupt = useCallback(async () => {
    if (!sessionId) return;
    await command({ type: "interrupt", sessionId });
    setStatus("Interrupt requested.");
  }, [command, sessionId]);

  const goHome = useCallback(() => {
    if (running) return;
    setApproval(undefined);
    setSessionId(undefined);
    setScreen("home");
    setStatus("Choose a workspace or start another session.");
  }, [running]);

  useEffect(() => () => eventSocket.current?.close(), []);

  const modeSelector = (onSelect: (candidate: AgentMode) => void) => <View style={styles.choices}>
    {(["chat", "plan", "edit"] as const).map((candidate) => <Pressable key={candidate} disabled={running || !selectedWorkspace?.capabilities.modes.includes(candidate)} style={[styles.choice, mode === candidate && styles.choiceSelected, (running || !selectedWorkspace?.capabilities.modes.includes(candidate)) && styles.disabled]} onPress={() => onSelect(candidate)}><Text style={styles.buttonText}>{candidate}</Text></Pressable>)}
  </View>;

  return <SafeAreaView style={styles.page}>
    <StatusBar barStyle="light-content" />
    <View style={styles.header}><Text style={styles.title}>Truss Remote</Text>{screen !== "home" && <Pressable style={styles.headerButton} disabled={running} onPress={goHome}><Text style={styles.headerButtonText}>Home</Text></Pressable>}{screen !== "settings" && <Pressable style={styles.headerButton} onPress={() => setScreen("settings")}><Text style={styles.headerButtonText}>Settings</Text></Pressable>}</View>

    {screen === "home" && <View style={styles.connection}>
      {!workspaces.length && <><Pressable style={styles.button} onPress={() => void requestCameraPermission().then((granted) => { if (granted.granted) setScreen("scanner"); else setStatus("Camera permission is required to scan a pairing QR code."); })}><Text style={styles.buttonText}>Scan pairing QR</Text></Pressable>{savedGateways.map((gateway) => <Pressable key={gateway.id} style={styles.setting} onPress={() => { setGatewayUrl(gateway.url); setToken(gateway.token); setStatus(`Selected ${gateway.name}.`); }}><Text style={styles.settingTitle}>{gateway.name}</Text><Text style={styles.settingDetail}>{gateway.url}</Text></Pressable>)}<TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} value={gatewayUrl} onChangeText={setGatewayUrl} placeholder="Gateway URL" placeholderTextColor="#8a93a8" /><TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} secureTextEntry value={token} onChangeText={setToken} placeholder="Gateway token" placeholderTextColor="#8a93a8" /><Pressable style={styles.button} onPress={() => void connectGateway().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Connection failed."))}><Text style={styles.buttonText}>Connect</Text></Pressable></>}
      {workspaces.length > 0 && <><Text style={styles.sectionLabel}>Workspace</Text><View style={styles.choices}>{workspaces.map((workspace) => <Pressable key={workspace.id} style={[styles.choice, workspaceId === workspace.id && styles.choiceSelected]} onPress={() => setWorkspaceId(workspace.id)}><Text style={styles.buttonText}>{workspace.displayName}</Text></Pressable>)}</View><Text style={styles.sectionLabel}>Mode</Text>{modeSelector(setMode)}<Pressable style={styles.button} onPress={() => void beginSession().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to open session."))}><Text style={styles.buttonText}>Open workspace</Text></Pressable></>}
    </View>}

    {screen === "scanner" && <View style={{ flex: 1, gap: 12 }}>{cameraPermission?.granted ? <CameraView style={{ flex: 1, borderRadius: 12, overflow: "hidden" }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => void pair(data).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to pair."))} /> : <Text style={styles.status}>Camera permission is required.</Text>}<Pressable style={styles.secondaryButton} onPress={() => setScreen("home")}><Text style={styles.buttonText}>Cancel</Text></Pressable></View>}

    {screen === "settings" && <View style={styles.settings}><Text style={styles.sectionLabel}>Tool approvals</Text><Text style={styles.settingsHelp}>This changes how the currently connected trusted gateway handles tools. You can still stop an active run.</Text>{availableApprovalModes.map((candidate) => <Pressable key={candidate} style={[styles.setting, approvalMode === candidate && styles.settingSelected]} onPress={() => setApprovalMode(candidate)}><Text style={styles.settingTitle}>{approvalCopy[candidate].title}</Text><Text style={styles.settingDetail}>{approvalCopy[candidate].detail}</Text></Pressable>)}<Pressable style={styles.button} onPress={() => void applySettings().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to apply settings."))}><Text style={styles.buttonText}>{sessionId ? "Apply to this session" : "Save settings"}</Text></Pressable></View>}

    {screen === "session" && <><Text style={styles.sectionLabel}>Mode</Text>{modeSelector((candidate) => void changeMode(candidate).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to switch modes.")))}<Text style={styles.status}>{running && <ActivityIndicator color="#85b4ff" />} {status}</Text>{approval && <View style={styles.approval}><Text style={styles.approvalTitle}>Allow {approval.tool}?</Text><Text style={styles.approvalInput}>{JSON.stringify(approval.input, null, 2)}</Text><View style={styles.approvalActions}><Pressable style={styles.secondaryButton} onPress={() => void decideTool(false).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to deny tool."))}><Text style={styles.buttonText}>Deny</Text></Pressable><Pressable style={styles.button} onPress={() => void decideTool(true).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to approve tool."))}><Text style={styles.buttonText}>Allow</Text></Pressable></View></View>}<FlatList style={styles.messages} contentContainerStyle={styles.messageContent} data={messages} keyExtractor={(item) => item.id} renderItem={({ item }) => <View style={[styles.message, item.role === "user" ? styles.userMessage : styles.agentMessage]}><Text style={styles.role}>{item.role === "user" ? "You" : item.role === "assistant" ? "Truss" : "System"}</Text><Text style={styles.messageText}>{item.content}</Text></View>} /><View style={styles.composer}><TextInput style={[styles.input, styles.prompt]} multiline value={prompt} onChangeText={setPrompt} placeholder="Ask Truss to help..." placeholderTextColor="#8a93a8" /><Pressable style={[styles.button, (!prompt.trim() || running) && styles.disabled]} disabled={!prompt.trim() || running} onPress={() => void send()}><Text style={styles.buttonText}>Send</Text></Pressable>{running && <Pressable style={styles.secondaryButton} onPress={() => void interrupt().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to interrupt."))}><Text style={styles.buttonText}>Stop</Text></Pressable>}</View></>}
    {screen !== "session" && <Text style={styles.status}>{status}</Text>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#101522", padding: 20 }, header: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 12 }, title: { color: "#f4f7ff", flex: 1, fontSize: 28, fontWeight: "700" }, headerButton: { backgroundColor: "#273149", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 }, headerButtonText: { color: "#d8e3ff", fontWeight: "700" }, connection: { gap: 10 }, input: { borderWidth: 1, borderColor: "#303a52", borderRadius: 10, color: "#f4f7ff", padding: 12, fontSize: 16 }, button: { alignItems: "center", backgroundColor: "#4779d8", borderRadius: 10, padding: 12 }, secondaryButton: { alignItems: "center", backgroundColor: "#7c3845", borderRadius: 10, padding: 12 }, disabled: { opacity: 0.45 }, buttonText: { color: "#fff", fontWeight: "700" }, status: { color: "#b9c4dc", marginVertical: 12 }, sectionLabel: { color: "#b9c4dc", fontWeight: "700", marginBottom: 8 }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }, choice: { alignItems: "center", backgroundColor: "#273149", borderRadius: 8, padding: 9 }, choiceSelected: { backgroundColor: "#4779d8" }, settings: { gap: 10 }, settingsHelp: { color: "#b9c4dc", lineHeight: 20 }, setting: { backgroundColor: "#1b2334", borderColor: "#303a52", borderRadius: 10, borderWidth: 1, padding: 12 }, settingSelected: { borderColor: "#85b4ff", backgroundColor: "#243c6d" }, settingTitle: { color: "#f4f7ff", fontSize: 16, fontWeight: "700" }, settingDetail: { color: "#b9c4dc", lineHeight: 20, marginTop: 4 }, messages: { flex: 1 }, messageContent: { gap: 10, paddingBottom: 12 }, message: { borderRadius: 12, padding: 12 }, userMessage: { backgroundColor: "#243c6d" }, agentMessage: { backgroundColor: "#1b2334" }, role: { color: "#85b4ff", fontSize: 12, fontWeight: "700", marginBottom: 4 }, messageText: { color: "#f4f7ff", fontSize: 16, lineHeight: 23 }, composer: { gap: 8 }, prompt: { minHeight: 52, maxHeight: 130 }, approval: { gap: 8, backgroundColor: "#282c3d", borderColor: "#6575a0", borderRadius: 12, borderWidth: 1, marginBottom: 12, padding: 12 }, approvalTitle: { color: "#f4f7ff", fontSize: 16, fontWeight: "700" }, approvalInput: { color: "#d5dbea", fontFamily: "monospace", fontSize: 12, maxHeight: 110 }, approvalActions: { flexDirection: "row", gap: 8 }
});
