import { useMDXComponents as getThemeComponents } from "nextra-theme-docs";
import { brand } from "@truss-harness/branding";

function Brand() {
  return brand.productName;
}

function CliCommand() {
  return <code>{brand.cliCommand}</code>;
}

function TuiCommand() {
  return <code>{brand.tuiCommand}</code>;
}

function WorkspaceDirectory() {
  return <code>{brand.workspaceDirectory}</code>;
}

function CliUsage({ command }: { readonly command: string }) {
  return <code>{`${brand.cliCommand} ${command}`}</code>;
}

function WorkspaceConfigPath() {
  return <code>{`${brand.workspaceDirectory}/config.json`}</code>;
}

function WorkspaceMemoryPath() {
  return <code>{`${brand.workspaceDirectory}/agent-state.json`}</code>;
}

function UserConfigPath() {
  return <code>{`%APPDATA%\\${brand.productSlug}\\config.json`}</code>;
}

function WorkspaceMarker({ boundary }: { readonly boundary: "start" | "end" }) {
  return <code>{`<!-- ${brand.productSlug}:workspace-context:${boundary} -->`}</code>;
}

export function useMDXComponents(components: Record<string, unknown>) {
  return {
    ...getThemeComponents(),
    Brand,
    CliCommand,
    TuiCommand,
    WorkspaceDirectory,
    CliUsage,
    WorkspaceConfigPath,
    WorkspaceMemoryPath,
    UserConfigPath,
    WorkspaceMarker,
    ...components
  };
}
