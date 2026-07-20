import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";

type ChatItem = { readonly id: string; readonly role: "user" | "assistant" | "system"; readonly content: string };
type AgentMode = "chat" | "plan" | "edit";
type Workspace = { readonly id: string; readonly displayName: string; readonly capabilities: { readonly modes: readonly AgentMode[] } };
type RemoteEvent = { readonly type: string; readonly sessionId?: string; readonly text?: string; readonly message?: string; readonly callId?: string; readonly tool?: string; readonly input?: Record<string, unknown> };
type ToolApproval = { readonly callId: string; readonly tool: string; readonly input: Record<string, unknown> };

function nextId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function gatewayPath(url: string, path: string): string { return `${url.replace(/\/$/, "")}${path}`; }
function eventUrl(url: string): string { return gatewayPath(url.replace(/^http/i, "ws"), "/v1/events"); }

export default function App() {
  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:4787");
  const [token, setToken] = useState("");
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("chat");
  const [sessionId, setSessionId] = useState<string>();
  const [approval, setApproval] = useState<ToolApproval>();
  const [messages, setMessages] = useState<readonly ChatItem[]>([]);
  const [status, setStatus] = useState("Enter a trusted gateway URL and token.");
  const [running, setRunning] = useState(false);
  const eventSocket = useRef<WebSocket | undefined>(undefined);

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

  const handleEvent = useCallback((event: RemoteEvent) => {
    if (event.type === "text_delta" && event.text) appendAssistant(event.text);
    if (event.type === "run_started") { setRunning(true); setStatus("Agent is working."); }
    if (event.type === "run_completed") { setRunning(false); setStatus("Run completed."); }
    if (event.type === "run_failed") { setRunning(false); setStatus(event.message ?? "Run failed."); }
    if (event.type === "tool_call_requested" && event.callId && event.tool && event.input) {
      setApproval({ callId: event.callId, tool: event.tool, input: event.input });
      setStatus("Tool approval required.");
    }
  }, [appendAssistant]);

  const connectEvents = useCallback(() => new Promise<void>((resolve, reject) => {
    eventSocket.current?.close();
    const socket = new WebSocket(eventUrl(gatewayUrl));
    eventSocket.current = socket;
    let connected = false;
    socket.onopen = () => socket.send(JSON.stringify({ type: "authenticate", token }));
    socket.onmessage = ({ data }) => {
      let event: RemoteEvent;
      try { event = JSON.parse(String(data)) as RemoteEvent; } catch { return; }
      if (event.type === "connected") {
        connected = true;
        resolve();
        return;
      }
      handleEvent(event);
    };
    socket.onerror = () => {
      if (!connected) reject(new Error("Unable to connect to the gateway event stream."));
      else setStatus("Gateway event stream disconnected.");
    };
    socket.onclose = () => {
      if (!connected) reject(new Error("Gateway rejected the event stream connection."));
    };
  }), [gatewayUrl, handleEvent, token]);

  const connectGateway = useCallback(async () => {
    if (!token.trim()) throw new Error("A gateway token is required.");
    setStatus("Connecting to gateway...");
    await connectEvents();
    const response = await fetch(gatewayPath(gatewayUrl, "/v1/workspaces"), { headers: { authorization: `Bearer ${token}` } });
    const result = await response.json() as { workspaces?: Workspace[]; error?: string };
    if (!response.ok || !result.workspaces?.length) throw new Error(result.error ?? "The gateway has no available workspaces.");
    setWorkspaces(result.workspaces);
    setWorkspaceId(result.workspaces[0].id);
    setStatus("Choose a workspace and mode.");
  }, [connectEvents, gatewayUrl, token]);

  const beginSession = useCallback(async () => {
    if (!workspaceId) throw new Error("Choose a workspace first.");
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace?.capabilities.modes.includes(mode)) throw new Error(`${workspace?.displayName ?? "Workspace"} does not support ${mode} mode.`);
    const result = await command({ type: "create_session", workspaceId, mode });
    setSessionId(result.sessionId);
    setMessages([]);
    setStatus("Connected. Start a conversation.");
  }, [command, mode, workspaceId, workspaces]);

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
    try {
      await command({ type: "send_message", sessionId, prompt: content });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Message was not sent.");
    }
  }, [command, prompt, sessionId]);

  const interrupt = useCallback(async () => {
    if (!sessionId) return;
    await command({ type: "interrupt", sessionId });
    setStatus("Interrupt requested.");
  }, [command, sessionId]);

  useEffect(() => () => eventSocket.current?.close(), []);

  const selectedWorkspace = workspaces.find((item) => item.id === workspaceId);
  return <SafeAreaView style={styles.page}>
    <StatusBar barStyle="light-content" />
    <Text style={styles.title}>Truss Remote</Text>
    {!sessionId && <View style={styles.connection}>
      {!workspaces.length && <><TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} value={gatewayUrl} onChangeText={setGatewayUrl} placeholder="Gateway URL" placeholderTextColor="#8a93a8" /><TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} secureTextEntry value={token} onChangeText={setToken} placeholder="Gateway token" placeholderTextColor="#8a93a8" /><Pressable style={styles.button} onPress={() => void connectGateway().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Connection failed."))}><Text style={styles.buttonText}>Connect</Text></Pressable></>}
      {workspaces.length > 0 && <><Text style={styles.sectionLabel}>Workspace</Text><View style={styles.choices}>{workspaces.map((workspace) => <Pressable key={workspace.id} style={[styles.choice, workspaceId === workspace.id && styles.choiceSelected]} onPress={() => setWorkspaceId(workspace.id)}><Text style={styles.buttonText}>{workspace.displayName}</Text></Pressable>)}</View><Text style={styles.sectionLabel}>Mode</Text><View style={styles.choices}>{(["chat", "plan", "edit"] as const).map((candidate) => <Pressable key={candidate} disabled={!selectedWorkspace?.capabilities.modes.includes(candidate)} style={[styles.choice, mode === candidate && styles.choiceSelected, !selectedWorkspace?.capabilities.modes.includes(candidate) && styles.disabled]} onPress={() => setMode(candidate)}><Text style={styles.buttonText}>{candidate}</Text></Pressable>)}</View><Pressable style={styles.button} onPress={() => void beginSession().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to open session."))}><Text style={styles.buttonText}>Open workspace</Text></Pressable></>}
    </View>}
    <Text style={styles.status}>{running && <ActivityIndicator color="#85b4ff" />} {status}</Text>
    {approval && <View style={styles.approval}><Text style={styles.approvalTitle}>Allow {approval.tool}?</Text><Text style={styles.approvalInput}>{JSON.stringify(approval.input, null, 2)}</Text><View style={styles.approvalActions}><Pressable style={styles.secondaryButton} onPress={() => void decideTool(false).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to deny tool."))}><Text style={styles.buttonText}>Deny</Text></Pressable><Pressable style={styles.button} onPress={() => void decideTool(true).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to approve tool."))}><Text style={styles.buttonText}>Allow</Text></Pressable></View></View>}
    <FlatList style={styles.messages} contentContainerStyle={styles.messageContent} data={messages} keyExtractor={(item) => item.id} renderItem={({ item }) => <View style={[styles.message, item.role === "user" ? styles.userMessage : styles.agentMessage]}><Text style={styles.role}>{item.role === "user" ? "You" : "Truss"}</Text><Text style={styles.messageText}>{item.content}</Text></View>} />
    {sessionId && <View style={styles.composer}><TextInput style={[styles.input, styles.prompt]} multiline value={prompt} onChangeText={setPrompt} placeholder="Ask Truss to help..." placeholderTextColor="#8a93a8" /><Pressable style={[styles.button, (!prompt.trim() || running) && styles.disabled]} disabled={!prompt.trim() || running} onPress={() => void send()}><Text style={styles.buttonText}>Send</Text></Pressable>{running && <Pressable style={styles.secondaryButton} onPress={() => void interrupt().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to interrupt."))}><Text style={styles.buttonText}>Stop</Text></Pressable>}</View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#101522", padding: 20 }, title: { color: "#f4f7ff", fontSize: 28, fontWeight: "700", marginBottom: 12 }, connection: { gap: 10 }, input: { borderWidth: 1, borderColor: "#303a52", borderRadius: 10, color: "#f4f7ff", padding: 12, fontSize: 16 }, button: { alignItems: "center", backgroundColor: "#4779d8", borderRadius: 10, padding: 12 }, secondaryButton: { alignItems: "center", backgroundColor: "#7c3845", borderRadius: 10, padding: 12 }, disabled: { opacity: 0.45 }, buttonText: { color: "#fff", fontWeight: "700" }, status: { color: "#b9c4dc", marginVertical: 12 }, sectionLabel: { color: "#b9c4dc", fontWeight: "700" }, choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, choice: { alignItems: "center", backgroundColor: "#273149", borderRadius: 8, padding: 9 }, choiceSelected: { backgroundColor: "#4779d8" }, messages: { flex: 1 }, messageContent: { gap: 10, paddingBottom: 12 }, message: { borderRadius: 12, padding: 12 }, userMessage: { backgroundColor: "#243c6d" }, agentMessage: { backgroundColor: "#1b2334" }, role: { color: "#85b4ff", fontSize: 12, fontWeight: "700", marginBottom: 4 }, messageText: { color: "#f4f7ff", fontSize: 16, lineHeight: 23 }, composer: { gap: 8 }, prompt: { minHeight: 52, maxHeight: 130 }, approval: { gap: 8, backgroundColor: "#282c3d", borderColor: "#6575a0", borderRadius: 12, borderWidth: 1, marginBottom: 12, padding: 12 }, approvalTitle: { color: "#f4f7ff", fontSize: 16, fontWeight: "700" }, approvalInput: { color: "#d5dbea", fontFamily: "monospace", fontSize: 12, maxHeight: 110 }, approvalActions: { flexDirection: "row", gap: 8 }
});
