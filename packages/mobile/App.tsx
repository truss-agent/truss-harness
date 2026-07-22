import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
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

const approvalCopy: Record<ApprovalMode, { readonly title: string; readonly detail: string; readonly badge: string }> = {
  ask: { title: "Ask every time", detail: "Review every workspace tool before it runs.", badge: "Recommended" },
  "auto-read": { title: "Auto-approve reads", detail: "Allow inspection. Commands and edits still require approval.", badge: "Balanced" },
  "auto-all": { title: "Auto-approve all", detail: "Allow every registered tool for this trusted gateway.", badge: "Trusted only" }
};
const modeCopy: Record<AgentMode, { readonly title: string; readonly detail: string }> = {
  chat: { title: "Chat", detail: "Discuss and explore" },
  plan: { title: "Plan", detail: "Inspect before changes" },
  edit: { title: "Agent", detail: "Work in the workspace" }
};
const readOnlyTools = new Set(["read_file", "list_directory", "search_files", "grep"]);
const savedGatewaysKey = "truss.remote.saved-gateways.v1";

function nextId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function gatewayPath(url: string, path: string): string { return `${url.replace(/\/$/, "")}${path}`; }
function eventUrl(url: string): string { return gatewayPath(url.replace(/^http/i, "ws"), "/v1/events"); }
function parsePairing(value: string): SavedGateway {
  const uri = new URL(value);
  if (uri.protocol !== "truss:" || uri.hostname !== "pair") throw new Error("This is not a Truss pairing QR code.");
  const url = uri.searchParams.get("gateway");
  const token = uri.searchParams.get("token");
  if (!url || !token || token.length < 24 || !/^https?:\/\//.test(url)) throw new Error("The pairing QR code is incomplete.");
  return { id: url, name: uri.searchParams.get("name") ?? new URL(url).host, url, token };
}

function BrandMark({ compact = false }: { readonly compact?: boolean }) {
  return <View style={[styles.brandMark, compact && styles.brandMarkCompact]}>
    <View style={styles.brandMarkInner}><View style={styles.brandMarkStem} /><View style={styles.brandMarkCross} /></View>
  </View>;
}

function Pill({ children, tone = "neutral" }: { readonly children: string; readonly tone?: "neutral" | "success" | "warning" }) {
  return <View style={[styles.pill, tone === "success" && styles.pillSuccess, tone === "warning" && styles.pillWarning]}><Text style={[styles.pillText, tone === "success" && styles.pillTextSuccess, tone === "warning" && styles.pillTextWarning]}>{children}</Text></View>;
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
  const [status, setStatus] = useState("Connect a trusted gateway to begin.");
  const [running, setRunning] = useState(false);
  const [savedGateways, setSavedGateways] = useState<readonly SavedGateway[]>([]);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const eventSocket = useRef<WebSocket | undefined>(undefined);
  const approvalModeRef = useRef<ApprovalMode>(approvalMode);
  const modeRef = useRef<AgentMode>(mode);

  useEffect(() => {
    void SecureStore.getItemAsync(savedGatewaysKey)
      .then((value) => { if (value) setSavedGateways(JSON.parse(value) as SavedGateway[]); })
      .catch(() => undefined);
  }, []);

  const saveGateway = useCallback(async (gateway: SavedGateway) => {
    const next = [gateway, ...savedGateways.filter((item) => item.id !== gateway.id)];
    setSavedGateways(next);
    await SecureStore.setItemAsync(savedGatewaysKey, JSON.stringify(next));
  }, [savedGateways]);

  const pair = useCallback(async (value: string) => {
    const gateway = parsePairing(value);
    await saveGateway(gateway);
    setGatewayUrl(gateway.url);
    setToken(gateway.token);
    setScreen("home");
    setStatus(`Paired with ${gateway.name}. Connect when you are ready.`);
  }, [saveGateway]);

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
  const appendSystem = useCallback((content: string) => setMessages((current) => [...current, { id: nextId(), role: "system", content }]), []);

  useEffect(() => { approvalModeRef.current = approvalMode; }, [approvalMode]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const handleEvent = useCallback((event: RemoteEvent) => {
    if (event.type === "text_delta" && event.text) appendAssistant(event.text);
    if (event.type === "run_started") { setRunning(true); setStatus("Truss is working in your workspace."); }
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
      setStatus("A tool needs your approval.");
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
    setStatus("Connecting securely to your gateway...");
    await connectEvents();
    const response = await fetch(gatewayPath(gatewayUrl, "/v1/workspaces"), { headers: { authorization: `Bearer ${token}` } });
    const result = await response.json() as { workspaces?: Workspace[]; error?: string };
    if (!response.ok || !result.workspaces?.length) throw new Error(result.error ?? "The gateway has no available workspaces.");
    const first = result.workspaces[0];
    setWorkspaces(result.workspaces);
    setWorkspaceId(first.id);
    setApprovalMode(first.capabilities.toolApprovalModes?.[0] ?? "ask");
    setStatus("Gateway connected. Pick a workspace to continue.");
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
    setStatus("Connected. What would you like to work on?");
  }, [approvalMode, command, mode, selectedWorkspace, workspaceId]);

  const changeMode = useCallback(async (nextMode: AgentMode, nextApprovalMode = approvalMode) => {
    if (!sessionId) return;
    if (running) throw new Error("Wait for the current run to finish before changing modes.");
    const result = await command({ type: "change_session_mode", sessionId, mode: nextMode, toolApprovalMode: nextApprovalMode });
    setSessionId(result.sessionId);
    setMode(nextMode);
    setApprovalMode(nextApprovalMode);
    setApproval(undefined);
    setStatus(`Switched to ${modeCopy[nextMode].title} mode. Conversation history is retained.`);
  }, [approvalMode, command, running, sessionId]);

  const applySettings = useCallback(async () => {
    if (sessionId) await changeMode(mode, approvalMode);
    setScreen(sessionId ? "session" : "home");
    if (!sessionId) setStatus("Settings saved for your next session.");
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
    setRunning(true);
    setStatus("Sending your request...");
    try { await command({ type: "send_message", sessionId, prompt: content }); }
    catch (error) { setRunning(false); setStatus(error instanceof Error ? error.message : "Message was not sent."); }
  }, [command, prompt, sessionId]);

  const interrupt = useCallback(async () => {
    if (!sessionId) return;
    await command({ type: "interrupt", sessionId });
    setStatus("Stopping the active run...");
  }, [command, sessionId]);

  const goHome = useCallback(() => {
    if (running) return;
    setApproval(undefined);
    setSessionId(undefined);
    setScreen("home");
    setStatus("Choose a workspace or start another session.");
  }, [running]);

  useEffect(() => () => eventSocket.current?.close(), []);

  const renderModeSelector = (onSelect: (candidate: AgentMode) => void) => <View style={styles.modeSelector}>
    {(["chat", "plan", "edit"] as const).map((candidate) => {
      const disabled = running || !selectedWorkspace?.capabilities.modes.includes(candidate);
      return <Pressable key={candidate} disabled={disabled} style={[styles.modeChoice, mode === candidate && styles.modeChoiceSelected, disabled && styles.disabled]} onPress={() => onSelect(candidate)}>
        <Text style={[styles.modeTitle, mode === candidate && styles.modeTitleSelected]}>{modeCopy[candidate].title}</Text>
        <Text style={[styles.modeDetail, mode === candidate && styles.modeDetailSelected]}>{modeCopy[candidate].detail}</Text>
      </Pressable>;
    })}
  </View>;

  const header = <View style={styles.header}>
    <Pressable disabled={screen === "home" || running} style={styles.brandLockup} onPress={goHome}>
      <BrandMark compact />
      <View><Text style={styles.appName}>Truss Go</Text><Text style={styles.appSubhead}>{screen === "session" ? selectedWorkspace?.displayName ?? "Remote workspace" : "Remote workspace"}</Text></View>
    </Pressable>
    <View style={styles.headerActions}>
      {workspaces.length > 0 && <Pill tone="success">Connected</Pill>}
      {screen !== "settings" && <Pressable accessibilityLabel="Open settings" style={styles.iconButton} onPress={() => setScreen("settings")}><Text style={styles.iconButtonText}>•••</Text></Pressable>}
    </View>
  </View>;

  return <SafeAreaView style={styles.page}>
    <StatusBar barStyle="light-content" />
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.select({ ios: "padding", default: undefined })}>
      {header}

      {screen === "home" && <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {!workspaces.length ? <>
          <View style={styles.hero}>
            <View style={styles.heroMark}><BrandMark /></View>
            <Pill tone="success">Local-first</Pill>
            <Text style={styles.heroTitle}>Your workspace,{"\n"}wherever you are.</Text>
            <Text style={styles.heroText}>Pair with Truss Desktop or VS Code on your trusted network, then work with the same local agent from your phone.</Text>
          </View>

          <Pressable style={styles.primaryButton} onPress={() => void requestCameraPermission().then((granted) => {
            if (granted.granted) setScreen("scanner");
            else setStatus("Camera permission is required to scan a pairing QR code.");
          })}><Text style={styles.primaryButtonText}>Scan pairing QR</Text><Text style={styles.primaryButtonArrow}>›</Text></Pressable>

          {savedGateways.length > 0 && <View style={styles.section}>
            <Text style={styles.sectionEyebrow}>RECENT GATEWAYS</Text>
            <View style={styles.cardList}>{savedGateways.map((gateway) => <Pressable key={gateway.id} style={[styles.gatewayCard, gatewayUrl === gateway.url && styles.gatewayCardSelected]} onPress={() => { setGatewayUrl(gateway.url); setToken(gateway.token); setStatus(`Selected ${gateway.name}.`); }}>
              <View style={styles.gatewaySignal}><View style={styles.gatewaySignalDot} /></View>
              <View style={styles.gatewayCopy}><Text style={styles.gatewayName}>{gateway.name}</Text><Text style={styles.gatewayUrl} numberOfLines={1}>{gateway.url}</Text></View>
              {gatewayUrl === gateway.url && <Text style={styles.selectedMark}>✓</Text>}
            </Pressable>)}</View>
          </View>}

          <View style={styles.section}>
            <View style={styles.sectionHeading}><Text style={styles.sectionEyebrow}>MANUAL CONNECTION</Text><Text style={styles.sectionHint}>For development</Text></View>
            <View style={styles.formCard}>
              <Text style={styles.fieldLabel}>GATEWAY URL</Text>
              <TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} value={gatewayUrl} onChangeText={setGatewayUrl} placeholder="http://192.168.1.5:4787" placeholderTextColor="#71827c" />
              <Text style={styles.fieldLabel}>ACCESS TOKEN</Text>
              <TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} secureTextEntry value={token} onChangeText={setToken} placeholder="Paste your temporary token" placeholderTextColor="#71827c" />
              <Pressable style={[styles.outlineButton, !token.trim() && styles.disabled]} disabled={!token.trim()} onPress={() => void connectGateway().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Connection failed."))}><Text style={styles.outlineButtonText}>Connect gateway</Text></Pressable>
            </View>
          </View>
        </> : <>
          <View style={styles.pageIntro}><Pill tone="success">Gateway connected</Pill><Text style={styles.screenTitle}>Choose where to work.</Text><Text style={styles.screenIntro}>Your files and model remain on the paired computer.</Text></View>
          <View style={styles.section}><Text style={styles.sectionEyebrow}>WORKSPACE</Text><View style={styles.cardList}>{workspaces.map((workspace) => <Pressable key={workspace.id} style={[styles.workspaceCard, workspaceId === workspace.id && styles.workspaceCardSelected]} onPress={() => setWorkspaceId(workspace.id)}><View style={styles.workspaceIcon}><Text style={styles.workspaceIconText}>⌘</Text></View><View style={styles.gatewayCopy}><Text style={styles.gatewayName}>{workspace.displayName}</Text><Text style={styles.gatewayUrl}>{workspace.capabilities.modes.map((item) => modeCopy[item].title).join(" · ")}</Text></View>{workspaceId === workspace.id && <Text style={styles.selectedMark}>✓</Text>}</Pressable>)}</View></View>
          <View style={styles.section}><Text style={styles.sectionEyebrow}>WORKING MODE</Text>{renderModeSelector(setMode)}</View>
          <Pressable style={styles.primaryButton} onPress={() => void beginSession().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to open session."))}><Text style={styles.primaryButtonText}>Open workspace</Text><Text style={styles.primaryButtonArrow}>›</Text></Pressable>
        </>}
        <View style={styles.notice}><View style={styles.noticeDot} /><Text style={styles.noticeText}>{status}</Text></View>
      </ScrollView>}

      {screen === "scanner" && <View style={styles.scannerPage}>
        <View style={styles.scannerIntro}><Pill>PAIR A GATEWAY</Pill><Text style={styles.screenTitle}>Scan the code on your computer.</Text><Text style={styles.screenIntro}>The gateway remains in control of your workspace and tools.</Text></View>
        <View style={styles.cameraFrame}>{cameraPermission?.granted ? <CameraView style={styles.camera} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => void pair(data).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to pair."))} /> : <View style={styles.cameraFallback}><Text style={styles.cameraFallbackText}>Camera permission is required.</Text></View>}<View pointerEvents="none" style={styles.scanGuide}><View style={[styles.corner, styles.cornerTopLeft]} /><View style={[styles.corner, styles.cornerTopRight]} /><View style={[styles.corner, styles.cornerBottomLeft]} /><View style={[styles.corner, styles.cornerBottomRight]} /></View></View>
        <Pressable style={styles.ghostButton} onPress={() => setScreen("home")}><Text style={styles.ghostButtonText}>Cancel</Text></Pressable>
      </View>}

      {screen === "settings" && <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.pageIntro}><Pill>SETTINGS</Pill><Text style={styles.screenTitle}>Control the agent.</Text><Text style={styles.screenIntro}>These controls apply only to your current trusted gateway.</Text></View>
        <View style={styles.section}><Text style={styles.sectionEyebrow}>TOOL APPROVALS</Text><View style={styles.cardList}>{availableApprovalModes.map((candidate) => <Pressable key={candidate} style={[styles.approvalOption, approvalMode === candidate && styles.approvalOptionSelected]} onPress={() => setApprovalMode(candidate)}><View style={styles.approvalHeading}><Text style={styles.settingTitle}>{approvalCopy[candidate].title}</Text><Pill tone={candidate === "auto-all" ? "warning" : "neutral"}>{approvalCopy[candidate].badge}</Pill></View><Text style={styles.settingDetail}>{approvalCopy[candidate].detail}</Text>{approvalMode === candidate && <Text style={styles.activeSetting}>Selected</Text>}</Pressable>)}</View></View>
        <View style={styles.section}><Text style={styles.sectionEyebrow}>CONNECTION</Text><View style={styles.formCard}><Text style={styles.fieldLabel}>GATEWAY</Text><Text style={styles.connectionValue} numberOfLines={1}>{gatewayUrl}</Text><Text style={styles.fieldLabel}>SESSION MODE</Text><Text style={styles.connectionValue}>{modeCopy[mode].title}</Text></View></View>
        <Pressable style={styles.primaryButton} onPress={() => void applySettings().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to apply settings."))}><Text style={styles.primaryButtonText}>{sessionId ? "Apply to session" : "Save settings"}</Text><Text style={styles.primaryButtonArrow}>›</Text></Pressable>
      </ScrollView>}

      {screen === "session" && <View style={styles.sessionPage}>
        <View style={styles.sessionTop}><View><Text style={styles.sessionWorkspace}>{selectedWorkspace?.displayName ?? "Workspace"}</Text><Text style={styles.sessionState}>{running ? "Agent run in progress" : modeCopy[mode].detail}</Text></View><View style={styles.sessionTopRight}>{running ? <ActivityIndicator color="#74e3ba" /> : <Pill tone="success">Ready</Pill>}</View></View>
        {renderModeSelector((candidate) => void changeMode(candidate).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to switch modes.")))}
        <View style={styles.liveStatus}><View style={[styles.statusDot, running && styles.statusDotWorking]} /><Text style={styles.liveStatusText}>{status}</Text></View>
        {approval && <View style={styles.approvalSheet}><View style={styles.approvalHeading}><View><Text style={styles.approvalKicker}>TOOL APPROVAL</Text><Text style={styles.approvalTitle}>Allow {approval.tool.replaceAll("_", " ")}?</Text></View><Pill tone="warning">Action needed</Pill></View><Text style={styles.approvalText}>Truss wants to run this workspace tool with the following input.</Text><Text style={styles.approvalInput}>{JSON.stringify(approval.input, null, 2)}</Text><View style={styles.approvalActions}><Pressable style={styles.denyButton} onPress={() => void decideTool(false).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to deny tool."))}><Text style={styles.denyButtonText}>Deny</Text></Pressable><Pressable style={styles.allowButton} onPress={() => void decideTool(true).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to approve tool."))}><Text style={styles.allowButtonText}>Allow tool</Text></Pressable></View></View>}
        <FlatList style={styles.messages} contentContainerStyle={[styles.messageContent, messages.length === 0 && styles.emptyMessageContent]} data={messages} keyExtractor={(item) => item.id} ListEmptyComponent={<View style={styles.emptyChat}><BrandMark compact /><Text style={styles.emptyChatTitle}>Start with a clear task.</Text><Text style={styles.emptyChatText}>Ask a question, request a plan, or have Truss work in the selected workspace.</Text></View>} renderItem={({ item }) => item.role === "system" ? <View style={styles.systemMessage}><Text style={styles.systemMessageText}>{item.content}</Text></View> : <View style={[styles.message, item.role === "user" ? styles.userMessage : styles.agentMessage]}><Text style={[styles.role, item.role === "user" && styles.userRole]}>{item.role === "user" ? "YOU" : "TRUSS"}</Text><Text style={styles.messageText}>{item.content}</Text></View>} />
        <View style={styles.composer}><View style={styles.composerInputWrap}><TextInput style={styles.prompt} multiline value={prompt} onChangeText={setPrompt} editable={!running} placeholder={running ? "Truss is working..." : "Ask Truss to help"} placeholderTextColor="#71827c" /></View><View style={styles.composerActions}>{running ? <Pressable style={styles.stopButton} onPress={() => void interrupt().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to interrupt."))}><Text style={styles.stopButtonText}>Stop</Text></Pressable> : <Pressable style={[styles.sendButton, !prompt.trim() && styles.disabled]} disabled={!prompt.trim()} onPress={() => void send()}><Text style={styles.sendButtonText}>Send</Text><Text style={styles.sendArrow}>↑</Text></Pressable>}</View></View>
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0c1311" },
  keyboard: { flex: 1 },
  header: { alignItems: "center", borderBottomColor: "#20312c", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 68, paddingHorizontal: 20 },
  brandLockup: { alignItems: "center", flexDirection: "row", gap: 10 },
  brandMark: { alignItems: "center", backgroundColor: "#163d31", borderColor: "#2e886a", borderRadius: 18, borderWidth: 1, height: 76, justifyContent: "center", width: 76 },
  brandMarkCompact: { borderRadius: 11, height: 38, width: 38 },
  brandMarkInner: { height: "54%", position: "relative", width: "48%" },
  brandMarkStem: { backgroundColor: "#70e1b6", borderRadius: 8, bottom: 0, left: "39%", position: "absolute", top: 0, width: "22%" },
  brandMarkCross: { backgroundColor: "#70e1b6", borderRadius: 8, left: 0, position: "absolute", top: "32%", height: "20%", width: "100%" },
  appName: { color: "#f1f8f5", fontSize: 18, fontWeight: "800", letterSpacing: 0 },
  appSubhead: { color: "#8fa59d", fontSize: 12, marginTop: 1 },
  headerActions: { alignItems: "center", flexDirection: "row", gap: 8 },
  iconButton: { alignItems: "center", borderColor: "#2a4038", borderRadius: 10, borderWidth: 1, height: 38, justifyContent: "center", width: 38 },
  iconButtonText: { color: "#c6d9d1", fontSize: 16, fontWeight: "800", letterSpacing: 1, marginTop: -7 },
  scrollContent: { gap: 22, padding: 20, paddingBottom: 34 },
  hero: { gap: 13, paddingTop: 18 },
  heroMark: { marginBottom: 2 },
  heroTitle: { color: "#f2f8f5", fontSize: 34, fontWeight: "800", letterSpacing: 0, lineHeight: 39 },
  heroText: { color: "#a7b8b1", fontSize: 16, lineHeight: 24, maxWidth: 440 },
  pill: { alignSelf: "flex-start", backgroundColor: "#1d2c27", borderColor: "#31483f", borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  pillSuccess: { backgroundColor: "#113b2e", borderColor: "#276d55" },
  pillWarning: { backgroundColor: "#3d2b17", borderColor: "#795825" },
  pillText: { color: "#b5c5be", fontSize: 11, fontWeight: "800", letterSpacing: 0 },
  pillTextSuccess: { color: "#84ebc5" },
  pillTextWarning: { color: "#f0c36e" },
  primaryButton: { alignItems: "center", backgroundColor: "#5dd5aa", borderRadius: 12, flexDirection: "row", justifyContent: "space-between", minHeight: 56, paddingHorizontal: 18 },
  primaryButtonText: { color: "#082018", fontSize: 16, fontWeight: "800" },
  primaryButtonArrow: { color: "#082018", fontSize: 30, fontWeight: "400", lineHeight: 28 },
  section: { gap: 10 },
  sectionHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionEyebrow: { color: "#7f978e", fontSize: 11, fontWeight: "800", letterSpacing: 0 },
  sectionHint: { color: "#73877f", fontSize: 12 },
  cardList: { gap: 8 },
  gatewayCard: { alignItems: "center", backgroundColor: "#121d19", borderColor: "#253a32", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 66, paddingHorizontal: 14, paddingVertical: 10 },
  gatewayCardSelected: { backgroundColor: "#153126", borderColor: "#48b98e" },
  gatewaySignal: { alignItems: "center", backgroundColor: "#19352a", borderRadius: 12, height: 26, justifyContent: "center", width: 26 },
  gatewaySignalDot: { backgroundColor: "#75e1b8", borderRadius: 4, height: 8, width: 8 },
  gatewayCopy: { flex: 1, gap: 3 },
  gatewayName: { color: "#ebf4f0", fontSize: 16, fontWeight: "700" },
  gatewayUrl: { color: "#8fa49b", fontSize: 13 },
  selectedMark: { color: "#77e2ba", fontSize: 20, fontWeight: "800" },
  formCard: { backgroundColor: "#121d19", borderColor: "#253a32", borderRadius: 12, borderWidth: 1, gap: 10, padding: 14 },
  fieldLabel: { color: "#82988f", fontSize: 11, fontWeight: "800", letterSpacing: 0, marginTop: 2 },
  input: { backgroundColor: "#0c1311", borderColor: "#2c443a", borderRadius: 9, borderWidth: 1, color: "#eef6f2", fontSize: 15, minHeight: 47, paddingHorizontal: 12, paddingVertical: 10 },
  outlineButton: { alignItems: "center", borderColor: "#3b6556", borderRadius: 9, borderWidth: 1, marginTop: 4, minHeight: 46, justifyContent: "center" },
  outlineButtonText: { color: "#9ce6c8", fontSize: 15, fontWeight: "700" },
  notice: { alignItems: "flex-start", backgroundColor: "#101b17", borderRadius: 10, flexDirection: "row", gap: 9, padding: 12 },
  noticeDot: { backgroundColor: "#6fd7af", borderRadius: 4, height: 7, marginTop: 6, width: 7 },
  noticeText: { color: "#a9bbb4", flex: 1, fontSize: 13, lineHeight: 19 },
  pageIntro: { gap: 9, paddingTop: 8 },
  screenTitle: { color: "#f1f8f5", fontSize: 28, fontWeight: "800", lineHeight: 34 },
  screenIntro: { color: "#a3b6ae", fontSize: 15, lineHeight: 22 },
  workspaceCard: { alignItems: "center", backgroundColor: "#121d19", borderColor: "#253a32", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 12, minHeight: 72, paddingHorizontal: 14, paddingVertical: 12 },
  workspaceCardSelected: { backgroundColor: "#153126", borderColor: "#48b98e" },
  workspaceIcon: { alignItems: "center", backgroundColor: "#1e4034", borderRadius: 11, height: 34, justifyContent: "center", width: 34 },
  workspaceIconText: { color: "#91e8c8", fontSize: 21, fontWeight: "700" },
  modeSelector: { flexDirection: "row", gap: 7 },
  modeChoice: { backgroundColor: "#121d19", borderColor: "#263b33", borderRadius: 10, borderWidth: 1, flex: 1, gap: 2, minHeight: 65, paddingHorizontal: 10, paddingVertical: 10 },
  modeChoiceSelected: { backgroundColor: "#174232", borderColor: "#5bd4a9" },
  modeTitle: { color: "#d4e1dc", fontSize: 14, fontWeight: "800" },
  modeTitleSelected: { color: "#d2ffe9" },
  modeDetail: { color: "#7f968d", fontSize: 11, lineHeight: 14 },
  modeDetailSelected: { color: "#9edfc4" },
  settings: { gap: 10 },
  approvalOption: { backgroundColor: "#121d19", borderColor: "#263b33", borderRadius: 12, borderWidth: 1, gap: 6, padding: 14 },
  approvalOptionSelected: { backgroundColor: "#153126", borderColor: "#53c99e" },
  approvalHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  settingTitle: { color: "#eef7f2", fontSize: 16, fontWeight: "800" },
  settingDetail: { color: "#a0b3aa", fontSize: 14, lineHeight: 20 },
  activeSetting: { color: "#7ae0b7", fontSize: 12, fontWeight: "800", marginTop: 2 },
  connectionValue: { color: "#e5f0eb", fontSize: 15, marginBottom: 5 },
  scannerPage: { flex: 1, gap: 22, padding: 20, paddingBottom: 30 },
  scannerIntro: { gap: 9 },
  cameraFrame: { borderColor: "#315e4d", borderRadius: 20, borderWidth: 1, flex: 1, minHeight: 300, overflow: "hidden", position: "relative" },
  camera: { flex: 1 },
  cameraFallback: { alignItems: "center", backgroundColor: "#121d19", flex: 1, justifyContent: "center" },
  cameraFallbackText: { color: "#b5c8bf", fontSize: 15 },
  scanGuide: { bottom: 22, left: 22, position: "absolute", right: 22, top: 22 },
  corner: { borderColor: "#81ebc5", height: 34, position: "absolute", width: 34 },
  cornerTopLeft: { borderLeftWidth: 3, borderTopWidth: 3, left: 0, top: 0 },
  cornerTopRight: { borderRightWidth: 3, borderTopWidth: 3, right: 0, top: 0 },
  cornerBottomLeft: { borderBottomWidth: 3, borderLeftWidth: 3, bottom: 0, left: 0 },
  cornerBottomRight: { borderBottomWidth: 3, borderRightWidth: 3, bottom: 0, right: 0 },
  ghostButton: { alignItems: "center", justifyContent: "center", minHeight: 50 },
  ghostButtonText: { color: "#b9d0c5", fontSize: 16, fontWeight: "700" },
  sessionPage: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  sessionTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12, paddingHorizontal: 5 },
  sessionWorkspace: { color: "#eef7f2", fontSize: 17, fontWeight: "800" },
  sessionState: { color: "#8fa69d", fontSize: 12, marginTop: 3 },
  sessionTopRight: { minWidth: 60, alignItems: "flex-end" },
  liveStatus: { alignItems: "center", flexDirection: "row", gap: 7, minHeight: 37, paddingHorizontal: 5 },
  statusDot: { backgroundColor: "#76d6b4", borderRadius: 4, height: 7, width: 7 },
  statusDotWorking: { backgroundColor: "#f0bd67" },
  liveStatusText: { color: "#9bb0a7", flex: 1, fontSize: 12, lineHeight: 17 },
  approvalSheet: { backgroundColor: "#1e2119", borderColor: "#87682f", borderRadius: 14, borderWidth: 1, gap: 10, marginBottom: 8, padding: 14 },
  approvalKicker: { color: "#e5bd70", fontSize: 11, fontWeight: "800", letterSpacing: 0 },
  approvalTitle: { color: "#f8f1e5", fontSize: 18, fontWeight: "800", marginTop: 2 },
  approvalText: { color: "#c6bfae", fontSize: 13, lineHeight: 19 },
  approvalInput: { backgroundColor: "#10140f", borderColor: "#4f4b37", borderRadius: 8, borderWidth: 1, color: "#d5e1d7", fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 12, lineHeight: 18, maxHeight: 118, overflow: "hidden", padding: 10 },
  approvalActions: { flexDirection: "row", gap: 9 },
  denyButton: { alignItems: "center", borderColor: "#795959", borderRadius: 9, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 44 },
  denyButtonText: { color: "#f0b3b3", fontSize: 14, fontWeight: "800" },
  allowButton: { alignItems: "center", backgroundColor: "#67d8ae", borderRadius: 9, flex: 1.35, justifyContent: "center", minHeight: 44 },
  allowButtonText: { color: "#082018", fontSize: 14, fontWeight: "800" },
  messages: { flex: 1 },
  messageContent: { gap: 10, paddingBottom: 14, paddingTop: 7 },
  emptyMessageContent: { flexGrow: 1, justifyContent: "center" },
  emptyChat: { alignItems: "center", gap: 10, marginHorizontal: 28, marginTop: -32 },
  emptyChatTitle: { color: "#ecf5f0", fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyChatText: { color: "#91a69e", fontSize: 14, lineHeight: 20, textAlign: "center" },
  message: { borderRadius: 13, maxWidth: "88%", padding: 12 },
  userMessage: { alignSelf: "flex-end", backgroundColor: "#1e624d", borderBottomRightRadius: 3 },
  agentMessage: { alignSelf: "flex-start", backgroundColor: "#16241f", borderBottomLeftRadius: 3 },
  role: { color: "#84dfb9", fontSize: 10, fontWeight: "800", letterSpacing: 0, marginBottom: 5 },
  userRole: { color: "#b2f5d7" },
  messageText: { color: "#f0f8f4", fontSize: 15, lineHeight: 22 },
  systemMessage: { alignSelf: "center", backgroundColor: "#16201c", borderRadius: 999, marginHorizontal: 14, paddingHorizontal: 12, paddingVertical: 7 },
  systemMessageText: { color: "#9db2a9", fontSize: 11, lineHeight: 16, textAlign: "center" },
  composer: { backgroundColor: "#0c1311", borderTopColor: "#24392f", borderTopWidth: 1, gap: 9, marginHorizontal: -14, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 12 },
  composerInputWrap: { backgroundColor: "#121e19", borderColor: "#2c473c", borderRadius: 11, borderWidth: 1 },
  prompt: { color: "#eff8f3", fontSize: 16, maxHeight: 116, minHeight: 48, paddingHorizontal: 12, paddingVertical: 12 },
  composerActions: { alignItems: "flex-end" },
  sendButton: { alignItems: "center", backgroundColor: "#5bd3a8", borderRadius: 9, flexDirection: "row", gap: 9, justifyContent: "center", minHeight: 41, minWidth: 95, paddingHorizontal: 14 },
  sendButtonText: { color: "#082018", fontSize: 14, fontWeight: "800" },
  sendArrow: { color: "#082018", fontSize: 20, fontWeight: "800", lineHeight: 20 },
  stopButton: { alignItems: "center", backgroundColor: "#3c2a2a", borderColor: "#7b5757", borderRadius: 9, borderWidth: 1, justifyContent: "center", minHeight: 41, minWidth: 95 },
  stopButtonText: { color: "#f3c2c2", fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.42 }
});
