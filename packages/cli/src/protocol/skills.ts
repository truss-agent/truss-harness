import {
  normalizeSkillSelection,
  type SkillImport,
  type SkillSelection,
} from "@truss-harness/runtime";
import { isAbsolute } from "node:path";
import type {
  RuntimeServiceResult,
  RuntimeServiceSkills,
  RuntimeServiceSkillScope,
} from "../protocol-contracts.js";

const maxContentCharacters = 65_536;
const maxResources = 200;
const maxResourceCharacters = 262_144;

function optionalSessionId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.length > 256)
    throw new Error("sessionId must be a non-empty string.");
  return value;
}

function scope(value: unknown): RuntimeServiceSkillScope {
  if (value === "user" || value === "workspace" || value === "session")
    return value;
  throw new Error("scope must be user, workspace, or session.");
}

function skillImport(request: Record<string, unknown>): SkillImport {
  if (request.replace !== undefined && typeof request.replace !== "boolean")
    throw new Error("replace must be a boolean.");
  const replace = request.replace === true;
  if ((request.path === undefined) === (request.content === undefined))
    throw new Error("Provide either a local path or skill content.");
  if (request.path !== undefined) {
    if (
      typeof request.path !== "string" ||
      !isAbsolute(request.path) ||
      request.path.length > 4096
    )
      throw new Error("path must be an absolute local directory.");
    return { kind: "directory", path: request.path, replace };
  }
  if (
    typeof request.content !== "string" ||
    request.content.length > maxContentCharacters
  )
    throw new Error("content must be SKILL.md text of at most 64 KiB.");
  const resources = request.resources ?? [];
  if (!Array.isArray(resources) || resources.length > maxResources)
    throw new Error(
      `resources must be a list of at most ${maxResources} files.`,
    );
  return {
    kind: "content",
    content: request.content,
    replace,
    resources: resources.map((resource: unknown) => {
      const value = resource as Record<string, unknown> | null;
      if (
        !value ||
        typeof value.path !== "string" ||
        typeof value.content !== "string" ||
        value.content.length > maxResourceCharacters
      )
        throw new Error("Each resource needs a path and text content.");
      return { path: value.path, content: value.content };
    }),
  };
}

/**
 * Validates a skills request completely before any side effect, then returns
 * the host operation to run. Throws for malformed input.
 */
export function skillRequest(
  type: string,
  request: Record<string, unknown>,
  skills: RuntimeServiceSkills,
): (() => Promise<RuntimeServiceResult>) | "unavailable" {
  if (type === "skills_list") {
    const sessionId = optionalSessionId(request.sessionId);
    return async () => ({ skills: await skills.list(sessionId) });
  }
  if (type === "skills_settings") {
    const target = scope(request.scope);
    const sessionId = optionalSessionId(request.sessionId);
    if (target === "session" && !sessionId)
      throw new Error("Session skill settings need a sessionId.");
    let selection: Partial<SkillSelection> | undefined;
    if (request.selection !== null)
      selection = normalizeSkillSelection(request.selection);
    return async () => ({
      skills: await skills.setSettings(target, sessionId, selection),
    });
  }
  if (type === "skills_import") {
    const input = skillImport(request);
    const importSkill = skills.import;
    if (!importSkill) return "unavailable";
    return async () => ({ skill: await importSkill(input) });
  }
  if (typeof request.id !== "string" || !request.id)
    throw new Error("id must be a skill ID.");
  const remove = skills.remove;
  if (!remove) return "unavailable";
  const id = request.id;
  return async () => {
    await remove(id);
    return { removed: true };
  };
}
