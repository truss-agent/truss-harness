import type { ChildProcess } from "node:child_process";
import { executeWorkspaceCommand } from "@truss-harness/runtime";
import { useCallback, useRef, useState } from "react";
import {
  detectedPreviewUrl,
  runTrackedCommand,
  stopProcessTree,
} from "./processes.js";

export interface TerminalLine {
  readonly id: number;
  readonly text: string;
}

export function useTerminalController(workspaceRoot: string) {
  const nextLineId = useRef(1);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    {
      id: 0,
      text: "Terminal ready. Shell commands run in the workspace root; slash commands run locally.",
    },
  ]);
  const [terminalScroll, setTerminalScroll] = useState(0);
  const [commandInput, setCommandInput] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string>();
  const terminalProcess = useRef<ChildProcess | undefined>(undefined);

  const appendTerminal = useCallback((output: string): void => {
    const next = output.replace(/\r/g, "").split("\n").filter(Boolean);
    if (!next.length) return;
    const detected = detectedPreviewUrl(output);
    if (detected) setPreviewUrl(detected);
    setTerminalScroll(0);
    const entries = next.map((text) => ({ id: nextLineId.current++, text }));
    setTerminalLines((current) => [...current, ...entries].slice(-110));
  }, []);

  const runTerminalInput = async (input: string): Promise<void> => {
    const command = await executeWorkspaceCommand({ workspaceRoot, input });
    if (command.handled) {
      appendTerminal(
        `[workspace command] ${command.command ?? input}: ${command.ok ? "completed" : "failed"}`,
      );
      appendTerminal(command.message);
      return;
    }
    await runTrackedCommand(input, workspaceRoot, appendTerminal, (process) => {
      terminalProcess.current = process;
    });
  };

  const interruptProcess = (): boolean => {
    if (!terminalProcess.current) return false;
    const process = terminalProcess.current;
    terminalProcess.current = undefined;
    void stopProcessTree(process).then(() =>
      appendTerminal("[terminal] Process stopped."),
    );
    return true;
  };

  return {
    terminalLines,
    terminalScroll,
    setTerminalScroll,
    commandInput,
    setCommandInput,
    previewUrl,
    appendTerminal,
    runTerminalInput,
    interruptProcess,
  };
}
