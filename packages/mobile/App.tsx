import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";

type ChatItem = { readonly id: string; readonly role: "user" | "assistant" | "system"; readonly content: string };
type RemoteEvent = { readonly type: string; readonly sessionId: string; readonly text?: string; readonly message?: string; readonly callId?: string; readonly tool?: string; readonly input?: Record<string, unknown> };
type AgentMode = "chat" | "plan" | "edit";
type ToolApproval = { readonly callId: string; readonly tool: string; readonly input: Record<string, unknown> };

function nextId(): string { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export default function App() {
  const [gatewayUrl, setGatewayUrl] = useState("http://127.0.0.1:4787");
  const [token, setToken] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("chat");
  const [sessionId, setSessionId] = useState<string>();
  const [approval, setApproval] = useState<ToolApproval>();
  const [messages, setMessages] = useState<readonly ChatItem[]>([]);
  const [status, setStatus] = useState("Enter a trusted gateway URL and token.");
  const [running, setRunning] = useState(false);
  const eventAbort = useRef<AbortController | undefined>(undefined);

  const command = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/v1/commands`, {
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

  const connectEvents = useCallback(async () => {
    eventAbort.current?.abort();
    const controller = new AbortController();
    eventAbort.current = controller;
    const response = await fetch(`${gatewayUrl.replace(/\/$/, "")}/v1/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("Unable to open the gateway event stream.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (!controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const frames = pending.split("\n\n");
      pending = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((entry) => entry.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice("data: ".length)) as RemoteEvent;
        if (event.type === "text_delta" && event.text) appendAssistant(event.text);
        if (event.type === "run_started") { setRunning(true); setStatus("Agent is working."); }
        if (event.type === "run_completed") { setRunning(false); setStatus("Run completed."); }
        if (event.type === "run_failed") { setRunning(false); setStatus(event.message ?? "Run failed."); }
        if (event.type === "tool_call_requested" && event.callId && event.tool && event.input) {
          setApproval({ callId: event.callId, tool: event.tool, input: event.input });
          setStatus("Tool approval required.");
        }
      }
    }
  }, [appendAssistant, gatewayUrl, token]);

  const beginSession = useCallback(async () => {
    if (!token.trim()) throw new Error("A gateway token is required.");
    setStatus("Connecting to gateway…");
    void connectEvents().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Event stream disconnected."));
    const result = await command({ type: "create_session", workspaceId: "workspace", mode });
    setSessionId(result.sessionId);
    setStatus("Connected. Start a conversation.");
  }, [command, connectEvents, mode, token]);

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

  useEffect(() => () => eventAbort.current?.abort(), []);

  return <SafeAreaView style={styles.page}>
    <StatusBar style="light" />
    <Text style={styles.title}>Truss Remote</Text>
    {!sessionId && <View style={styles.connection}>
      <TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} value={gatewayUrl} onChangeText={setGatewayUrl} placeholder="Gateway URL" placeholderTextColor="#8a93a8" />
      <TextInput style={styles.input} autoCapitalize="none" autoCorrect={false} secureTextEntry value={token} onChangeText={setToken} placeholder="Gateway token" placeholderTextColor="#8a93a8" />
      <View style={styles.modes}>{(["chat", "plan", "edit"] as const).map((candidate) => <Pressable key={candidate} style={[styles.mode, mode === candidate && styles.modeSelected]} onPress={() => setMode(candidate)}><Text style={styles.buttonText}>{candidate}</Text></Pressable>)}</View>
      <Pressable style={styles.button} onPress={() => void beginSession().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Connection failed."))}><Text style={styles.buttonText}>Connect</Text></Pressable>
    </View>}
    <Text style={styles.status}>{running && <ActivityIndicator color="#85b4ff" />} {status}</Text>
    {approval && <View style={styles.approval}><Text style={styles.approvalTitle}>Allow {approval.tool}?</Text><Text style={styles.approvalInput}>{JSON.stringify(approval.input, null, 2)}</Text><View style={styles.approvalActions}><Pressable style={styles.secondaryButton} onPress={() => void decideTool(false).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to deny tool."))}><Text style={styles.buttonText}>Deny</Text></Pressable><Pressable style={styles.button} onPress={() => void decideTool(true).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to approve tool."))}><Text style={styles.buttonText}>Allow</Text></Pressable></View></View>}
    <FlatList style={styles.messages} contentContainerStyle={styles.messageContent} data={messages} keyExtractor={(item) => item.id} renderItem={({ item }) => <View style={[styles.message, item.role === "user" ? styles.userMessage : styles.agentMessage]}><Text style={styles.role}>{item.role === "user" ? "You" : item.role === "assistant" ? "Truss" : "System"}</Text><Text style={styles.messageText}>{item.content}</Text></View>} />
    {sessionId && <View style={styles.composer}>
      <TextInput style={[styles.input, styles.prompt]} multiline value={prompt} onChangeText={setPrompt} placeholder="Ask Truss to help…" placeholderTextColor="#8a93a8" />
      <Pressable style={[styles.button, !prompt.trim() && styles.disabled]} disabled={!prompt.trim() || running} onPress={() => void send()}><Text style={styles.buttonText}>Send</Text></Pressable>
      {running && <Pressable style={styles.secondaryButton} onPress={() => void interrupt().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Unable to interrupt."))}><Text style={styles.buttonText}>Stop</Text></Pressable>}
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#101522", padding: 20 },
  title: { color: "#f4f7ff", fontSize: 28, fontWeight: "700", marginBottom: 12 },
  connection: { gap: 10 }, input: { borderWidth: 1, borderColor: "#303a52", borderRadius: 10, color: "#f4f7ff", padding: 12, fontSize: 16 }, modes: { flexDirection: "row", gap: 8 }, mode: { flex: 1, alignItems: "center", borderRadius: 8, padding: 9, backgroundColor: "#273149" }, modeSelected: { backgroundColor: "#4779d8" },
  button: { alignItems: "center", backgroundColor: "#4779d8", borderRadius: 10, padding: 12 }, secondaryButton: { alignItems: "center", backgroundColor: "#7c3845", borderRadius: 10, padding: 12 }, disabled: { opacity: 0.45 }, buttonText: { color: "#fff", fontWeight: "700" },
  status: { color: "#b9c4dc", marginVertical: 12 }, messages: { flex: 1 }, messageContent: { gap: 10, paddingBottom: 12 }, message: { borderRadius: 12, padding: 12 }, userMessage: { backgroundColor: "#243c6d" }, agentMessage: { backgroundColor: "#1b2334" }, role: { color: "#85b4ff", fontSize: 12, fontWeight: "700", marginBottom: 4 }, messageText: { color: "#f4f7ff", fontSize: 16, lineHeight: 23 },
  composer: { gap: 8 }, prompt: { minHeight: 52, maxHeight: 130 }, approval: { gap: 8, backgroundColor: "#282c3d", borderColor: "#6575a0", borderRadius: 12, borderWidth: 1, marginBottom: 12, padding: 12 }, approvalTitle: { color: "#f4f7ff", fontSize: 16, fontWeight: "700" }, approvalInput: { color: "#d5dbea", fontFamily: "monospace", fontSize: 12, maxHeight: 110 }, approvalActions: { flexDirection: "row", gap: 8 },
});
