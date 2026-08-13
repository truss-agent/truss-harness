import { brand } from "@truss-harness/branding";
import type { ClientConfiguration } from "@truss-harness/cli/runtime";
import type { WorkspacePlan } from "@truss-harness/runtime";
import { Box, Text } from "ink";
import { Panel, TuiOverlays, type TuiOverlaysProps } from "./components.js";
import { formatTokenCount, truncate } from "./display.js";
import type { FileTreeEntry } from "./file-browser.js";
import type { TuiLayout } from "./layout.js";
import type { TerminalLine } from "./terminal-controller.js";
import type { TuiTheme } from "./theme.js";
import type {
  ChatDisplayLine,
  EditorDisplayRow,
  Focus,
  RunStatus,
  Viewport,
} from "./types.js";

export interface TuiWorkspaceViewProps {
  readonly viewport: Viewport;
  readonly layout: TuiLayout;
  readonly theme: TuiTheme;
  readonly configuration?: ClientConfiguration;
  readonly runStatus: RunStatus;
  readonly busy: boolean;
  readonly contextTokens: number;
  readonly contextWindow: number;
  readonly tokensPerSecond?: number;
  readonly previewUrl?: string;
  readonly focus: Focus;
  readonly visibleFileTree: readonly FileTreeEntry[];
  readonly fileTreeLength: number;
  readonly fileTreeStart: number;
  readonly fileIndex: number;
  readonly openFilePath?: string;
  readonly editorTitle: string;
  readonly visibleEditorRows: readonly EditorDisplayRow[];
  readonly activePlan?: WorkspacePlan;
  readonly chatLines: readonly ChatDisplayLine[];
  readonly chatScroll: number;
  readonly chatInput: string;
  readonly visibleTerminalLines: readonly TerminalLine[];
  readonly commandInput: string;
  readonly sessionId?: string;
  readonly overlays: Omit<TuiOverlaysProps, "theme">;
}

export function TuiWorkspaceView({
  viewport,
  layout,
  theme,
  configuration,
  runStatus,
  busy,
  contextTokens,
  contextWindow,
  tokensPerSecond,
  previewUrl,
  focus,
  visibleFileTree,
  fileTreeLength,
  fileTreeStart,
  fileIndex,
  openFilePath,
  editorTitle,
  visibleEditorRows,
  activePlan,
  chatLines,
  chatScroll,
  chatInput,
  visibleTerminalLines,
  commandInput,
  sessionId,
  overlays,
}: TuiWorkspaceViewProps): React.ReactElement {
  const {
    compact,
    terminalHeight,
    workspaceHeight,
    filesWidth,
    chatWidth,
    editorWidth,
    compactChatHeight,
    editorHeight,
  } = layout;
  const filesPanel = (
    <Panel title="FILES  [/] find" active={focus === "files"} theme={theme}>
      {visibleFileTree.map((entry, visibleIndex) => {
        const selected = fileTreeStart + visibleIndex === fileIndex;
        const marker =
          entry.kind === "directory" ? (entry.expanded ? "v " : "> ") : "  ";
        const indentation = " ".repeat(entry.depth * 2);
        const width = Math.max(6, filesWidth - indentation.length - 7);
        return (
          <Text
            key={`${entry.kind}:${entry.path}`}
            wrap="truncate-end"
            color={
              selected
                ? theme.focus
                : entry.kind === "directory"
                  ? theme.directory
                  : entry.path === openFilePath
                    ? theme.success
                    : theme.text
            }
            bold={selected || entry.kind === "directory"}
          >
            {selected ? "> " : "  "}
            {indentation}
            {marker}
            {truncate(entry.name, width)}
          </Text>
        );
      })}
      {!fileTreeLength && (
        <Text color={theme.muted}>No workspace files found.</Text>
      )}
    </Panel>
  );
  const editorPanel = (
    <Panel
      title={`${editorTitle}  [up/down] scroll  [d] diff${previewUrl ? "  [o] browser" : ""}`}
      active={focus === "editor"}
      theme={theme}
    >
      {visibleEditorRows.map((row) => {
        const lineLabel = row.continuation
          ? "  |"
          : String(row.sourceLine).padStart(3);
        return (
          <Text key={row.key} wrap="truncate-end" color={theme.text}>
            <Text color={theme.muted}>{lineLabel}</Text> {(() => {
              let offset = 0;
              return row.tokens.map((token) => {
                const key = `${offset}:${token.text}`;
                offset += token.text.length;
                return (
                  <Text
                    key={key}
                    color={token.color ? theme.syntax[token.color] : theme.text}
                    dimColor={token.dim}
                  >
                    {token.text}
                  </Text>
                );
              });
            })()}
          </Text>
        );
      })}
    </Panel>
  );
  const agentPanel = (
    <Panel
      title={
        chatScroll
          ? `AGENT  [${chatScroll} lines above]`
          : "AGENT  [Enter] send"
      }
      active={focus === "chat"}
      theme={theme}
    >
      {activePlan && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.accent} wrap="truncate-end">
            PLAN: {truncate(activePlan.title, Math.max(8, chatWidth - 9))}
          </Text>
          {activePlan.steps.slice(0, 3).map((step) => (
            <Text
              key={step.id}
              wrap="truncate-end"
              color={
                step.status === "completed"
                  ? theme.success
                  : step.status === "in_progress"
                    ? theme.warning
                    : theme.muted
              }
            >
              {step.status === "completed"
                ? "[x]"
                : step.status === "in_progress"
                  ? "[..]"
                  : "[ ]"}{" "}
              {truncate(step.content, Math.max(8, chatWidth - 7))}
            </Text>
          ))}
        </Box>
      )}
      {chatLines.map((line) => (
        <Text
          key={line.key}
          color={line.role === "user" ? theme.user : theme.agent}
          bold={line.header}
        >
          {line.text}
        </Text>
      ))}
      <Box flexGrow={1} />
      <Text
        wrap="truncate-end"
        color={focus === "chat" ? theme.focus : theme.muted}
      >
        {focus === "chat" ? "> " : "  "}
        {truncate(
          chatInput ||
            (busy ? "Working... Escape cancels" : "Ask about this workspace"),
          Math.max(12, chatWidth - 5),
        )}
      </Text>
    </Panel>
  );

  return (
    <Box
      flexDirection="column"
      height={viewport.rows}
      paddingX={1}
      overflow="hidden"
    >
      <Box height={1} justifyContent="space-between" marginBottom={1}>
        <Text bold color={theme.accent}>
          {brand.productName.toUpperCase()}
        </Text>
        <Text color={theme.muted}>
          {configuration
            ? `${configuration.provider} / ${configuration.model}`
            : "No model selected"}
        </Text>
        <Text
          color={
            runStatus === "waiting"
              ? theme.warning
              : busy
                ? theme.focus
                : theme.success
          }
        >
          {runStatus === "waiting"
            ? "APPROVAL"
            : runStatus === "tool"
              ? "TOOL"
              : busy
                ? "WORKING"
                : "READY"}
        </Text>
      </Box>
      <Box height={1} justifyContent="space-between" marginBottom={1}>
        <Text color={theme.muted}>
          CONTEXT{" "}
          <Text
            color={
              contextTokens / contextWindow >= 0.9
                ? theme.error
                : contextTokens / contextWindow >= 0.7
                  ? theme.warning
                  : theme.accent
            }
          >
            {formatTokenCount(contextTokens)} /{" "}
            {formatTokenCount(contextWindow)}
          </Text>{" "}
          estimated
        </Text>
        <Text color={theme.muted}>
          SPEED{" "}
          <Text color={busy ? theme.success : theme.muted}>
            {tokensPerSecond
              ? `${tokensPerSecond.toFixed(1)} tok/s`
              : "-- tok/s"}
          </Text>
          {previewUrl
            ? `  PREVIEW ${truncate(previewUrl, Math.max(16, Math.floor(viewport.columns * 0.3)))}`
            : ""}
        </Text>
      </Box>
      {compact ? (
        <Box
          height={workspaceHeight}
          flexDirection="column"
          gap={1}
          overflow="hidden"
        >
          <Box
            height={editorHeight}
            flexDirection="row"
            gap={1}
            overflow="hidden"
          >
            <Box width={filesWidth} height="100%">
              {filesPanel}
            </Box>
            <Box width={editorWidth} height="100%">
              {editorPanel}
            </Box>
          </Box>
          <Box height={compactChatHeight} width="100%">
            {agentPanel}
          </Box>
        </Box>
      ) : (
        <Box
          height={workspaceHeight}
          flexDirection="row"
          gap={1}
          overflow="hidden"
        >
          <Box width={filesWidth} height="100%">
            {filesPanel}
          </Box>
          <Box width={editorWidth} height="100%">
            {editorPanel}
          </Box>
          <Box width={chatWidth} height="100%">
            {agentPanel}
          </Box>
        </Box>
      )}
      <Box height={terminalHeight} marginTop={1}>
        <Panel
          title="TERMINAL  [Enter] run"
          active={focus === "terminal"}
          theme={theme}
        >
          {visibleTerminalLines.map((line) => (
            <Text
              key={line.id}
              wrap="truncate-end"
              color={
                line.text.startsWith("[agent error]") ||
                line.text.startsWith("[terminal error]")
                  ? theme.error
                  : line.text.startsWith("[tool")
                    ? theme.warning
                    : theme.muted
              }
            >
              {truncate(line.text, Math.max(20, viewport.columns - 8))}
            </Text>
          ))}
          <Box flexGrow={1} />
          <Text
            wrap="truncate-end"
            color={focus === "terminal" ? theme.focus : theme.muted}
          >
            {focus === "terminal" ? "> " : "  "}
            {truncate(
              commandInput || "Type a workspace command",
              Math.max(16, viewport.columns - 10),
            )}
          </Text>
        </Panel>
      </Box>
      <Box height={1} marginTop={1} justifyContent="space-between">
        <Text color={theme.muted} wrap="truncate-end">
          Tab focus | Ctrl+Left/Right pane | / find | a agents | c MCP | m
          settings | Esc cancel run | Ctrl+C exit idle
        </Text>
        <Text color={theme.muted}>
          {sessionId ? `session ${sessionId.slice(0, 8)}` : "new session"}
        </Text>
      </Box>
      <TuiOverlays theme={theme} {...overlays} />
    </Box>
  );
}
