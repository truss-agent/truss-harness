import type { LocalModelEndpoint } from "@truss-harness/provider-openai-compatible";
import type { AgentProfile, ToolCall } from "@truss-harness/runtime";
import { workspaceCommandHelp } from "@truss-harness/runtime";
import { Box, Text } from "ink";
import { truncate } from "./display.js";
import type { FileEntry } from "./file-browser.js";
import type { TuiTheme, TuiThemeName } from "./theme.js";
import type { Screen, SettingsField } from "./types.js";

export function Panel({
  title,
  active,
  theme,
  children,
}: {
  readonly title: string;
  readonly active: boolean;
  readonly theme: TuiTheme;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={active ? theme.focus : theme.panel}
      paddingX={1}
      width="100%"
      height="100%"
      overflow="hidden"
    >
      <Text color={active ? theme.focus : theme.muted} bold>
        {title}
      </Text>
      {children}
    </Box>
  );
}

const tuiControlHelp = [
  [
    "NAVIGATION",
    "Tab / Shift+Tab move focus; Ctrl+Left / Ctrl+Right move to an adjacent pane.",
  ],
  [
    "FILES",
    "/ opens fuzzy file search; Up/Down select; Left/Right collapse or expand; Enter opens.",
  ],
  [
    "EDITOR",
    "Up/Down scroll; d toggles Git diff; o opens the detected preview URL externally.",
  ],
  [
    "AGENT",
    "Enter sends; a opens saved multi-agent profiles; Up/Down scroll chat; n starts a new conversation outside the chat input.",
  ],
  [
    "MCP",
    "c opens credential-safe server and tool status; R tests configured servers.",
  ],
  [
    "TERMINAL",
    "Type directly and press Enter; Up/Down scroll output; slash commands run through Truss.",
  ],
  [
    "SETTINGS",
    "m opens settings outside chat; Tab changes fields; Theme previews forest, sage, and dusk.",
  ],
  ["APPROVALS", "Y or Enter allows; N or Escape denies."],
  [
    "CANCEL / EXIT",
    "Escape cancels an active agent run. Ctrl+C stops a process or run, and exits while idle.",
  ],
] as const;

interface McpToolView {
  readonly name: string;
  readonly readOnly: boolean;
}

interface McpServerView {
  readonly name: string;
  readonly state: string;
  readonly error?: string;
  readonly toolCount: number;
  readonly tools?: readonly McpToolView[];
}

export interface TuiOverlaysProps {
  readonly screen: Screen;
  readonly theme: TuiTheme;
  readonly overlayWidth: number;
  readonly fileSearchInput: string;
  readonly fileSearchResults: readonly FileEntry[];
  readonly fileSearchIndex: number;
  readonly settingsField: SettingsField;
  readonly selectedEndpoint?: LocalModelEndpoint;
  readonly endpointInput: string;
  readonly modelInput: string;
  readonly models: readonly string[];
  readonly modelIndex: number;
  readonly internetAccess: boolean;
  readonly themeName: TuiThemeName;
  readonly providerKind: string;
  readonly pendingTool?: ToolCall;
  readonly agentProfiles: readonly AgentProfile[];
  readonly mcpStatuses: readonly McpServerView[];
}

export function TuiOverlays(props: TuiOverlaysProps): React.ReactElement {
  const {
    screen,
    theme,
    overlayWidth,
    fileSearchInput,
    fileSearchResults,
    fileSearchIndex,
    settingsField,
    selectedEndpoint,
    endpointInput,
    modelInput,
    models,
    modelIndex,
    internetAccess,
    themeName,
    providerKind,
    pendingTool,
    agentProfiles,
    mcpStatuses,
  } = props;
  return (
    <>
      {screen === "file-search" && (
        <Box
          position="absolute"
          flexDirection="column"
          borderStyle="double"
          borderColor={theme.focus}
          paddingX={2}
          paddingY={1}
          width={overlayWidth}
          marginLeft={2}
          marginTop={3}
          backgroundColor={theme.overlay}
        >
          <Text bold color={theme.accent}>
            FIND FILE
          </Text>
          <Text color={theme.text}>
            <Text color={theme.focus}>&gt; </Text>
            {fileSearchInput || (
              <Text color={theme.muted}>Type part of a file name or path</Text>
            )}
          </Text>
          <Text color={theme.muted}>
            Up/Down select Enter open Escape close
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {fileSearchResults.map((entry, index) => {
              const selected =
                index ===
                Math.min(
                  fileSearchIndex,
                  Math.max(0, fileSearchResults.length - 1),
                );
              const fileName = entry.path.split("/").at(-1) ?? entry.path;
              return (
                <Text
                  key={entry.path}
                  color={selected ? theme.focus : theme.text}
                  bold={selected}
                >
                  {selected ? "> " : "  "}
                  {fileName}
                  <Text color={theme.muted}>
                    {" "}
                    {truncate(
                      entry.path,
                      Math.max(12, overlayWidth - fileName.length - 10),
                    )}
                  </Text>
                </Text>
              );
            })}
            {!fileSearchResults.length && (
              <Text color={theme.warning}>No matching files.</Text>
            )}
          </Box>
        </Box>
      )}
      {screen === "settings" && (
        <Box
          position="absolute"
          flexDirection="column"
          borderStyle="double"
          borderColor={theme.focus}
          paddingX={2}
          paddingY={1}
          width={overlayWidth}
          marginLeft={2}
          marginTop={3}
          backgroundColor={theme.overlay}
        >
          <Text bold color={theme.accent}>
            LOCAL MODEL CONFIGURATION
          </Text>
          <Text color={theme.muted}>
            Tab changes fields. Enter selects an item or saves when endpoint and
            model are set.
          </Text>
          <Text color={settingsField === "server" ? theme.focus : theme.text}>
            SERVER: {selectedEndpoint?.label ?? "Scanning local servers..."}
          </Text>
          <Text color={settingsField === "endpoint" ? theme.focus : theme.text}>
            ENDPOINT: {endpointInput}
          </Text>
          <Text color={settingsField === "model" ? theme.focus : theme.text}>
            MODEL:{" "}
            {modelInput || models[modelIndex] || "Choose or type a model"}
          </Text>
          <Text color={settingsField === "internet" ? theme.focus : theme.text}>
            INTERNET RESEARCH: {internetAccess ? "enabled" : "disabled"}{" "}
            {settingsField === "internet" ? "[Space toggles]" : ""}
          </Text>
          <Text color={settingsField === "theme" ? theme.focus : theme.text}>
            THEME: {themeName}{" "}
            {settingsField === "theme" ? "[Left/Right changes]" : ""}
          </Text>
          <Text color={theme.muted}>
            Detected models:{" "}
            {models.slice(0, 5).join(", ") || "none; type one manually"}
          </Text>
          <Text color={theme.warning}>
            Provider: {providerKind}. Local endpoints use the server selector.
            Configure cloud BYOK profiles with truss-cli setup, then relaunch
            the TUI.
          </Text>
        </Box>
      )}
      {screen === "approval" && (
        <Box
          position="absolute"
          flexDirection="column"
          borderStyle="double"
          borderColor={theme.warning}
          paddingX={2}
          paddingY={1}
          width={overlayWidth}
          marginLeft={2}
          marginTop={8}
          backgroundColor={theme.overlay}
        >
          <Text bold color={theme.warning}>
            TOOL APPROVAL REQUIRED
          </Text>
          <Text color={theme.text}>
            {pendingTool?.name} {JSON.stringify(pendingTool?.input)}
          </Text>
          <Text color={theme.muted}>
            Press Y or Enter to allow. Press N or Escape to deny.
          </Text>
        </Box>
      )}
      {screen === "agents" && (
        <Box
          position="absolute"
          flexDirection="column"
          borderStyle="double"
          borderColor={theme.focus}
          paddingX={2}
          paddingY={1}
          width={overlayWidth}
          marginLeft={2}
          marginTop={6}
          backgroundColor={theme.overlay}
        >
          <Text bold color={theme.accent}>
            MULTI-AGENT PROFILES
          </Text>
          <Text color={theme.muted}>
            Profiles are shared with truss-cli in .truss-harness/agents.json.
            Use `truss agents run &lt;id&gt; &lt;task&gt;` for independent
            concurrent runs.
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {agentProfiles.map((profile) => (
              <Text key={profile.id} color={theme.text}>
                <Text color={theme.focus}>{profile.displayName}</Text>
                <Text color={theme.muted}>
                  {" "}
                  {profile.id.slice(0, 8)} {profile.provider.providerId}/
                  {profile.provider.modelId} {profile.mode}{" "}
                  {profile.approvalPolicy}
                </Text>
              </Text>
            ))}
            {!agentProfiles.length && (
              <Text color={theme.warning}>
                No profiles yet. Add one with `truss agents add &lt;name&gt;`.
              </Text>
            )}
          </Box>
          <Text color={theme.muted}>R refreshes. A or Escape closes.</Text>
        </Box>
      )}
      {screen === "mcp" && (
        <Box
          position="absolute"
          flexDirection="column"
          borderStyle="double"
          borderColor={theme.focus}
          paddingX={2}
          paddingY={1}
          width={overlayWidth}
          marginLeft={2}
          marginTop={6}
          backgroundColor={theme.overlay}
        >
          <Text bold color={theme.accent}>
            MCP CONNECTIONS
          </Text>
          <Text color={theme.muted}>
            Status and discovered tools only. Commands, environment values, and
            credentials remain hidden.
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {mcpStatuses.map((server) => (
              <Box key={server.name} flexDirection="column">
                <Text
                  color={
                    server.state === "failed"
                      ? theme.error
                      : server.state === "connected"
                        ? theme.success
                        : theme.warning
                  }
                >
                  <Text bold>{server.name}</Text> {server.state}
                  {server.error
                    ? ` — ${server.error}`
                    : ` — ${server.toolCount} tool${server.toolCount === 1 ? "" : "s"}`}
                </Text>
                {(server.tools ?? []).map((tool) => (
                  <Text key={`${server.name}:${tool.name}`} color={theme.muted}>
                    {"  "}
                    {tool.name} [{tool.readOnly ? "read-only" : "approval"}]
                  </Text>
                ))}
              </Box>
            ))}
            {!mcpStatuses.length && (
              <Text color={theme.warning}>No MCP servers configured.</Text>
            )}
          </Box>
          <Text color={theme.muted}>
            R tests configured servers. C or Escape closes.
          </Text>
        </Box>
      )}
      {screen === "help" && (
        <Box
          position="absolute"
          flexDirection="column"
          borderStyle="double"
          borderColor={theme.focus}
          paddingX={2}
          paddingY={1}
          width={overlayWidth}
          marginLeft={2}
          marginTop={7}
          backgroundColor={theme.overlay}
        >
          <Text bold color={theme.accent}>
            TUI CONTROLS
          </Text>
          {tuiControlHelp.map(([label, detail]) => (
            <Text key={label} color={theme.text} wrap="wrap">
              <Text bold color={theme.focus}>
                {label}:{" "}
              </Text>
              {detail}
            </Text>
          ))}
          <Box marginTop={1}>
            <Text bold color={theme.accent}>
              WORKSPACE COMMANDS
            </Text>
          </Box>
          {workspaceCommandHelp()
            .split("\n")
            .slice(1)
            .map((line) => (
              <Text key={line} color={theme.text}>
                {line}
              </Text>
            ))}
          <Text color={theme.muted}>
            Press any key to close this reference.
          </Text>
        </Box>
      )}
    </>
  );
}
