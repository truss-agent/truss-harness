type Validator = (value: unknown) => boolean;
const string: Validator = (value) =>
  typeof value === "string" && !value.includes("\0");
const bool: Validator = (value) => typeof value === "boolean";
const object: Validator = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const optional =
  (validate: Validator): Validator =>
  (value) =>
    value === undefined || validate(value);
const array =
  (validate: Validator): Validator =>
  (value) =>
    Array.isArray(value) && value.every(validate);
const shape =
  (fields: Record<string, Validator>): Validator =>
  (value) =>
    object(value) &&
    Object.entries(fields).every(([key, validate]) =>
      validate((value as Record<string, unknown>)[key]),
    );
const oneOf =
  (...values: unknown[]): Validator =>
  (value) =>
    values.includes(value);
const finite: Validator = (value) =>
  typeof value === "number" && Number.isFinite(value);
const attachment = shape({
  id: string,
  kind: oneOf("file", "image"),
  name: string,
  mediaType: string,
  size: finite,
  data: optional(string),
  text: optional(string),
});
const message = shape({
  role: oneOf("user", "assistant", "system", "tool"),
  content: string,
  attachments: optional(array(attachment)),
});
const configurationFields: Record<string, Validator> = {
  provider: string,
  baseUrl: string,
  model: string,
  mode: oneOf("chat", "plan", "edit"),
  permission: oneOf("ask", "auto-read", "auto-all"),
  contextWindow: (value) => finite(value) && Number(value) > 0,
  internetAccess: optional(bool),
  mcpServers: optional(object),
  credentialAccountId: optional(string),
  modelContextWindow: optional(finite),
  autocomplete: optional(shape({ enabled: bool, model: optional(string) })),
  formatOnSave: optional(bool),
  masterPrompt: optional(shape({ template: string, enabled: optional(bool) })),
};
const configuration = shape(configurationFields);
const partial = (fields: Record<string, Validator>): Validator =>
  shape(
    Object.fromEntries(
      Object.entries(fields).map(([key, validate]) => [
        key,
        optional(validate),
      ]),
    ),
  );
const provider = shape({
  providerId: string,
  modelId: string,
  endpointId: optional(string),
  endpointUrl: optional(string),
  credentialRef: optional(string),
  options: optional(object),
});
const profileFields: Record<string, Validator> = {
  displayName: string,
  provider,
  mode: oneOf("chat", "plan", "edit"),
  approvalPolicy: oneOf("ask", "auto-read", "auto-all"),
  internetAccess: bool,
  instructions: string,
};
const profile = shape({
  displayName: string,
  provider,
  mode: optional(oneOf("chat", "plan", "edit")),
  approvalPolicy: optional(oneOf("ask", "auto-read", "auto-all")),
  internetAccess: optional(bool),
  instructions: optional(string),
});
const conversation = shape({
  id: string,
  title: string,
  messages: array(message),
  updatedAt: string,
});
const signatures: Record<string, readonly Validator[]> = {};
function register(names: string, validators: readonly Validator[]): void {
  for (const name of names.split(" ")) signatures[`truss:${name}`] = validators;
}
register(
  "app-version initial-state stop-chat list-agents stop-all-agents list-files get-plan git-status git-graph git-generate-commit-message git-pull git-push stop-terminal connect-truss-go disconnect-truss-go credential-storage check-for-updates download-update install-update choose-workspace refresh-local-model list-skills import-skill",
  [],
);
register(
  "delete-agent stop-agent list-directory read-file create-workspace-file create-workspace-folder delete-workspace-entry reveal-workspace-entry diff-file git-commit run-terminal open-external delete-provider-account remove-skill",
  [string],
);
register(
  "write-file rename-workspace-entry copy-workspace-entry format-file check-syntax start-agent",
  [string, string],
);
register("git-stage git-unstage git-discard", [array(string)]);
register("create-agent", [profile]);
register("update-agent", [string, partial(profileFields)]);
register("resolve-agent-approval", [string, string, bool]);
register("resolve-approval", [string, bool, optional(bool)]);
register("send-chat", [
  shape({
    prompt: string,
    conversationId: string,
    history: array(message),
    activeFilePath: optional(string),
    attachedPaths: optional(array(string)),
    openFilePaths: optional(array(string)),
    attachments: optional(array(attachment)),
  }),
]);
register("complete", [
  shape({
    prefix: optional(string),
    suffix: optional(string),
    path: optional(string),
  }),
]);
register("test-mcp-server", [
  string,
  shape({
    command: string,
    args: optional(array(string)),
    env: optional(object),
    enabled: optional(bool),
    readOnly: optional(bool),
  }),
]);
register("configure-theme", [
  shape({
    name: oneOf("default", "blue", "orange", "multicolor", "custom"),
    custom: optional(
      partial(
        Object.fromEntries(
          [
            "background",
            "surface",
            "panel",
            "border",
            "text",
            "muted",
            "accent",
            "accentText",
            "warning",
            "error",
          ].map((key) => [key, string]),
        ),
      ),
    ),
  }),
]);
register("adjust-zoom", [oneOf(-1, 1)]);
register("update-skill-settings", [
  oneOf("user", "workspace"),
  (value) =>
    value === null ||
    (partial({
      mode: oneOf("automatic", "manual", "off"),
      superpowersEnabled: bool,
      skillIds: (ids) => array(string)(ids) && (ids as unknown[]).length <= 64,
    })(value) &&
      Object.keys(value as object).every((key) =>
        ["mode", "superpowersEnabled", "skillIds"].includes(key),
      )),
]);
register("configure-updates", [
  shape({ checkOnLaunch: bool, autoDownload: bool }),
]);
register("save-conversations", [array(conversation), optional(string)]);
register("discover-models", [
  optional(partial(configurationFields)),
  optional(string),
]);
register("configure test-provider-connection", [
  configuration,
  optional(string),
]);
register("save-workspace-ui-state", [
  shape({
    expandedDirectories: array(string),
    openEditors: array(
      shape({ path: string, mode: oneOf("file", "diff"), scrollTop: finite }),
    ),
    activeFile: optional(string),
    fileTreeScrollTop: finite,
  }),
]);
register("clear-credential", [string, optional(string)]);
register("save-provider-account", [
  shape({
    providerId: string,
    label: string,
    authMethod: oneOf("api-key"),
    id: optional(string),
  }),
  string,
]);
register("update-provider-account", [
  string,
  shape({
    label: optional(string),
    status: optional(oneOf("active", "reauth-required", "disabled")),
    scopes: optional(array(string)),
  }),
]);

/** Structured-clone input must also be bounded JSON before reaching services. */
function json(value: unknown, depth = 0): boolean {
  if (depth > 30) return false;
  if (value === undefined || value === null || typeof value === "boolean")
    return true;
  if (typeof value === "string") return value.length <= 16_000_000;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value))
    return (
      value.length <= 100_000 && value.every((item) => json(item, depth + 1))
    );
  return (
    object(value) &&
    Object.keys(value as object).length <= 10_000 &&
    Object.entries(value as object).every(
      ([key, item]) =>
        key !== "__proto__" &&
        key !== "constructor" &&
        key !== "prototype" &&
        json(item, depth + 1),
    )
  );
}
export function validDesktopIpcInput(
  channel: string,
  args?: readonly unknown[],
): boolean {
  const signature = signatures[channel];
  return Boolean(
    signature &&
      (args === undefined ||
        (args.length <= signature.length &&
          json(args) &&
          signature.every((validate, index) => validate(args[index])))),
  );
}
