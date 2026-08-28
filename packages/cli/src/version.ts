/** Kept explicit so editor-service bundles do not need package.json at runtime. */
export const CLI_VERSION = "0.1.23";

export function formatCliVersion(command: string): string {
  return `${command} ${CLI_VERSION}`;
}
