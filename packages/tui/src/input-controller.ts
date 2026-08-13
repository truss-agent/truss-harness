import type {
  LocalModelEndpoint,
  ModelProviderKind,
} from "@truss-harness/provider-openai-compatible";
import { useInput } from "ink";
import type { Dispatch, SetStateAction } from "react";
import { clamp } from "./display.js";
import type { FileEntry, FileTreeEntry } from "./file-browser.js";
import { type TuiThemeName, tuiThemeNames } from "./theme.js";
import type {
  EditorDisplayRow,
  Focus,
  Screen,
  SettingsField,
} from "./types.js";

type Setter<T> = Dispatch<SetStateAction<T>>;

interface InputState {
  readonly screen: Screen;
  readonly focus: Focus;
  readonly busy: boolean;
  readonly fileSearchResults: readonly FileEntry[];
  readonly fileSearchIndex: number;
  readonly candidates: readonly LocalModelEndpoint[];
  readonly selectedEndpoint?: LocalModelEndpoint;
  readonly settingsField: SettingsField;
  readonly endpointInput: string;
  readonly modelInput: string;
  readonly models: readonly string[];
  readonly modelIndex: number;
  readonly configurationAvailable: boolean;
  readonly previewUrl?: string;
  readonly terminalLineCount: number;
  readonly terminalHeight: number;
  readonly commandInput: string;
  readonly fileTree: readonly FileTreeEntry[];
  readonly selectedFileTreeEntry?: FileTreeEntry;
  readonly editorRows: readonly EditorDisplayRow[];
  readonly editorLineCount: number;
  readonly chatTranscriptLength: number;
  readonly chatLineCount: number;
}

interface InputSetters {
  readonly setScreen: Setter<Screen>;
  readonly setFileSearchInput: Setter<string>;
  readonly setFileSearchIndex: Setter<number>;
  readonly setSettingsField: Setter<SettingsField>;
  readonly setServerIndex: Setter<number>;
  readonly setProviderKind: Setter<ModelProviderKind>;
  readonly setEndpointInput: Setter<string>;
  readonly setModelIndex: Setter<number>;
  readonly setModelInput: Setter<string>;
  readonly setInternetAccess: Setter<boolean>;
  readonly setThemeName: Setter<TuiThemeName>;
  readonly setTerminalScroll: Setter<number>;
  readonly setCommandInput: Setter<string>;
  readonly setFileIndex: Setter<number>;
  readonly setEditorScroll: Setter<number>;
  readonly setChatScroll: Setter<number>;
  readonly setChatInput: Setter<string>;
}

interface InputActions {
  readonly interruptOrExit: () => void;
  readonly cancelRun: () => void;
  readonly resolveApproval: (approved: boolean) => void;
  readonly openSearchResult: (entry: FileEntry) => void;
  readonly refreshAgentProfiles: () => void;
  readonly testMcpConnections: () => void;
  readonly configureRuntime: () => void;
  readonly moveFocus: (direction: 1 | -1) => void;
  readonly openPreview: (url: string) => void;
  readonly runTerminalInput: (input: string) => void;
  readonly startNewConversation: () => void;
  readonly toggleDirectory: (path: string, expand?: boolean) => void;
  readonly loadFile: (entry: FileEntry) => void;
  readonly toggleDiff: () => void;
  readonly sendPrompt: () => void;
}

export interface TuiInputControllerOptions {
  readonly state: InputState;
  readonly setters: InputSetters;
  readonly actions: InputActions;
}

export function useTuiInputController({
  state,
  setters,
  actions,
}: TuiInputControllerOptions): void {
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      actions.interruptOrExit();
      return;
    }
    if (state.screen === "approval") {
      if (input.toLowerCase() === "y" || key.return)
        actions.resolveApproval(true);
      if (input.toLowerCase() === "n" || key.escape)
        actions.resolveApproval(false);
      return;
    }
    if (state.screen === "file-search") {
      if (key.escape) {
        setters.setFileSearchInput("");
        setters.setFileSearchIndex(0);
        setters.setScreen("workspace");
        return;
      }
      if (key.upArrow) {
        setters.setFileSearchIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setters.setFileSearchIndex((current) =>
          Math.min(
            Math.max(0, state.fileSearchResults.length - 1),
            current + 1,
          ),
        );
        return;
      }
      if (key.return) {
        const result =
          state.fileSearchResults[
            Math.min(
              state.fileSearchIndex,
              Math.max(0, state.fileSearchResults.length - 1),
            )
          ];
        if (result) actions.openSearchResult(result);
        return;
      }
      if (key.backspace || key.delete) {
        setters.setFileSearchInput((current) => current.slice(0, -1));
        setters.setFileSearchIndex(0);
      } else if (input) {
        setters.setFileSearchInput((current) => current + input);
        setters.setFileSearchIndex(0);
      }
      return;
    }
    if (state.screen === "help") {
      setters.setScreen("workspace");
      return;
    }
    if (state.screen === "agents") {
      if (key.escape || input.toLowerCase() === "a")
        setters.setScreen("workspace");
      if (input.toLowerCase() === "r") actions.refreshAgentProfiles();
      return;
    }
    if (state.screen === "mcp") {
      if (key.escape || input.toLowerCase() === "c") {
        setters.setScreen("workspace");
        return;
      }
      if (input.toLowerCase() === "r" && state.configurationAvailable)
        actions.testMcpConnections();
      return;
    }
    if (state.screen === "settings") {
      if (key.escape) {
        setters.setScreen("workspace");
        return;
      }
      if (key.tab) {
        const fields: readonly SettingsField[] = [
          "server",
          "endpoint",
          "model",
          "internet",
          "theme",
        ];
        setters.setSettingsField((current) => {
          const index = fields.indexOf(current);
          return fields[
            (index + (key.shift ? -1 : 1) + fields.length) % fields.length
          ];
        });
        return;
      }
      if (state.settingsField === "server") {
        if (key.upArrow)
          setters.setServerIndex((current) => Math.max(0, current - 1));
        if (key.downArrow)
          setters.setServerIndex((current) =>
            Math.min(state.candidates.length - 1, current + 1),
          );
        if (key.return && state.selectedEndpoint) {
          setters.setProviderKind(state.selectedEndpoint.kind);
          setters.setEndpointInput(state.selectedEndpoint.baseUrl);
          setters.setSettingsField("model");
        }
        return;
      }
      if (state.settingsField === "model") {
        if (key.upArrow)
          setters.setModelIndex((current) => Math.max(0, current - 1));
        if (key.downArrow)
          setters.setModelIndex((current) =>
            Math.min(state.models.length - 1, current + 1),
          );
        if (state.models[state.modelIndex] && (key.return || key.rightArrow))
          setters.setModelInput(state.models[state.modelIndex]);
      }
      if (state.settingsField === "internet") {
        if (input === " " || key.leftArrow || key.rightArrow)
          setters.setInternetAccess((current) => !current);
        if (key.return && state.endpointInput && state.modelInput)
          actions.configureRuntime();
        return;
      }
      if (state.settingsField === "theme") {
        if (key.leftArrow || key.upArrow)
          setters.setThemeName(
            (current) =>
              tuiThemeNames[
                (tuiThemeNames.indexOf(current) - 1 + tuiThemeNames.length) %
                  tuiThemeNames.length
              ],
          );
        if (key.rightArrow || key.downArrow || input === " ")
          setters.setThemeName(
            (current) =>
              tuiThemeNames[
                (tuiThemeNames.indexOf(current) + 1) % tuiThemeNames.length
              ],
          );
        if (key.return && state.endpointInput && state.modelInput)
          actions.configureRuntime();
        return;
      }
      if (key.return && state.endpointInput && state.modelInput) {
        actions.configureRuntime();
        return;
      }
      const setter =
        state.settingsField === "endpoint"
          ? setters.setEndpointInput
          : setters.setModelInput;
      if (key.backspace || key.delete)
        setter((current) => current.slice(0, -1));
      else if (!key.return && input) setter((current) => current + input);
      return;
    }
    if (key.ctrl && (key.leftArrow || key.rightArrow)) {
      actions.moveFocus(key.leftArrow ? -1 : 1);
      return;
    }
    if (
      input.toLowerCase() === "a" &&
      state.focus !== "chat" &&
      state.focus !== "terminal"
    ) {
      setters.setScreen("agents");
      return;
    }
    if (key.tab) {
      actions.moveFocus(key.shift ? -1 : 1);
      return;
    }
    if (key.escape && state.busy) {
      actions.cancelRun();
      return;
    }
    if (
      input === "o" &&
      state.focus !== "chat" &&
      state.focus !== "terminal" &&
      state.previewUrl
    ) {
      actions.openPreview(state.previewUrl);
      return;
    }
    if (state.focus === "terminal") {
      if (key.upArrow) {
        setters.setTerminalScroll((current) =>
          clamp(
            current + 1,
            0,
            Math.max(
              0,
              state.terminalLineCount - Math.max(1, state.terminalHeight - 4),
            ),
          ),
        );
        return;
      }
      if (key.downArrow) {
        setters.setTerminalScroll((current) =>
          clamp(
            current - 1,
            0,
            Math.max(
              0,
              state.terminalLineCount - Math.max(1, state.terminalHeight - 4),
            ),
          ),
        );
        return;
      }
      if (key.return) {
        const command = state.commandInput.trim();
        setters.setCommandInput("");
        if (command) actions.runTerminalInput(command);
        return;
      }
      if (key.backspace || key.delete)
        setters.setCommandInput((current) => current.slice(0, -1));
      else if (input) setters.setCommandInput((current) => current + input);
      return;
    }
    if (input === "?" && state.focus !== "chat") {
      setters.setScreen("help");
      return;
    }
    if (input === "m" && state.focus !== "chat") {
      setters.setScreen("settings");
      return;
    }
    if (input.toLowerCase() === "c" && state.focus !== "chat") {
      setters.setScreen("mcp");
      return;
    }
    if (input === "n" && state.focus !== "chat") {
      actions.startNewConversation();
      return;
    }
    if (state.focus === "files") {
      if (input === "/") {
        setters.setFileSearchInput("");
        setters.setFileSearchIndex(0);
        setters.setScreen("file-search");
        return;
      }
      if (key.upArrow)
        setters.setFileIndex((current) => Math.max(0, current - 1));
      if (key.downArrow)
        setters.setFileIndex((current) =>
          Math.min(Math.max(state.fileTree.length - 1, 0), current + 1),
        );
      if (key.leftArrow && state.selectedFileTreeEntry?.kind === "directory")
        actions.toggleDirectory(state.selectedFileTreeEntry.path, false);
      if (key.rightArrow && state.selectedFileTreeEntry?.kind === "directory")
        actions.toggleDirectory(state.selectedFileTreeEntry.path, true);
      if (key.return && state.selectedFileTreeEntry?.kind === "directory")
        actions.toggleDirectory(state.selectedFileTreeEntry.path);
      if (key.return && state.selectedFileTreeEntry?.kind === "file")
        actions.loadFile(state.selectedFileTreeEntry);
      return;
    }
    if (state.focus === "editor") {
      if (key.upArrow) {
        setters.setEditorScroll((current) =>
          clamp(
            current - 1,
            0,
            Math.max(0, state.editorRows.length - state.editorLineCount),
          ),
        );
        return;
      }
      if (key.downArrow) {
        setters.setEditorScroll((current) =>
          clamp(
            current + 1,
            0,
            Math.max(0, state.editorRows.length - state.editorLineCount),
          ),
        );
        return;
      }
      if (input === "d") actions.toggleDiff();
      return;
    }
    if (key.upArrow) {
      setters.setChatScroll((current) =>
        clamp(
          current + 1,
          0,
          Math.max(0, state.chatTranscriptLength - state.chatLineCount),
        ),
      );
      return;
    }
    if (key.downArrow) {
      setters.setChatScroll((current) =>
        clamp(
          current - 1,
          0,
          Math.max(0, state.chatTranscriptLength - state.chatLineCount),
        ),
      );
      return;
    }
    if (key.return) {
      actions.sendPrompt();
      return;
    }
    if (key.backspace || key.delete)
      setters.setChatInput((current) => current.slice(0, -1));
    else if (input) setters.setChatInput((current) => current + input);
  });
}
