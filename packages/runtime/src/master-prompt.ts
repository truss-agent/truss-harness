/**
 * A user-owned persistent instruction layer. Templates remain plain text: XML
 * is never parsed or rewritten, and only explicit double-brace tokens are
 * interpolated from this intentionally small, credential-safe context.
 */
export interface MasterPromptConfiguration {
  readonly enabled: boolean;
  readonly template: string;
}

export interface MasterPromptContext {
  readonly workspace: {
    readonly name: string;
    readonly root: string;
  };
  readonly repository: {
    readonly branch?: string;
    readonly changedFiles?: readonly string[];
  };
  readonly agent: { readonly mode: "chat" | "plan" | "edit" };
  readonly session: { readonly id: string };
  readonly date: { readonly iso: string };
}

export const masterPromptVariables = [
  "workspace.name",
  "workspace.root",
  "repository.branch",
  "repository.changedFiles",
  "agent.mode",
  "session.id",
  "date.iso",
] as const;

export type MasterPromptVariable = (typeof masterPromptVariables)[number];

const maximumTemplateLength = 16_000;
const maximumRenderedLength = 24_000;
const maximumChangedFiles = 100;
const token = /{{\s*([^{}]+?)\s*}}/g;

export class MasterPromptTemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterPromptTemplateError";
  }
}

export interface MasterPromptValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly variables: readonly MasterPromptVariable[];
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function tokens(template: string): readonly string[] {
  return [...template.matchAll(token)].map((match) => match[1]);
}

export function validateMasterPrompt(
  configuration: MasterPromptConfiguration | undefined,
): MasterPromptValidation {
  if (!configuration?.enabled) {
    return { valid: true, errors: [], variables: [] };
  }
  const errors: string[] = [];
  const template = configuration.template;
  if (!template.trim()) errors.push("A master prompt must not be empty.");
  if (template.length > maximumTemplateLength) {
    errors.push(
      `A master prompt may contain at most ${maximumTemplateLength.toLocaleString()} characters.`,
    );
  }
  const openingTokenCount = template.match(/{{/g)?.length ?? 0;
  const closingTokenCount = template.match(/}}/g)?.length ?? 0;
  if (openingTokenCount !== closingTokenCount) {
    errors.push(
      "Master prompt tokens must use complete {{variable.name}} syntax.",
    );
  }
  const seen = new Set<MasterPromptVariable>();
  for (const name of tokens(template)) {
    if (!masterPromptVariables.includes(name as MasterPromptVariable)) {
      errors.push(`Unknown master prompt variable: {{${name}}}.`);
      continue;
    }
    seen.add(name as MasterPromptVariable);
  }
  return { valid: errors.length === 0, errors, variables: [...seen] };
}

function values(
  context: MasterPromptContext,
): Record<MasterPromptVariable, string> {
  return {
    "workspace.name": context.workspace.name,
    "workspace.root": context.workspace.root,
    "repository.branch": context.repository.branch ?? "",
    "repository.changedFiles": (context.repository.changedFiles ?? [])
      .slice(0, maximumChangedFiles)
      .join("\n"),
    "agent.mode": context.agent.mode,
    "session.id": context.session.id,
    "date.iso": context.date.iso,
  };
}

export function renderMasterPrompt(
  configuration: MasterPromptConfiguration | undefined,
  context: MasterPromptContext,
): string | undefined {
  if (!configuration?.enabled) return undefined;
  const validation = validateMasterPrompt(configuration);
  if (!validation.valid) {
    throw new MasterPromptTemplateError(validation.errors.join(" "));
  }
  const replacements = values(context);
  const rendered = configuration.template.replace(
    token,
    (_match, name: string) =>
      xmlEscape(replacements[name as MasterPromptVariable]),
  );
  if (rendered.length > maximumRenderedLength) {
    throw new MasterPromptTemplateError(
      `The rendered master prompt exceeds ${maximumRenderedLength.toLocaleString()} characters.`,
    );
  }
  return rendered;
}
