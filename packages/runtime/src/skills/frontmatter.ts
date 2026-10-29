/** Lowercase kebab-case; also the skill directory name. */
const skillNamePattern = /^[a-z0-9][a-z0-9-]{0,63}$/;
const maxDescriptionCharacters = 1024;

export function isSkillName(value: unknown): value is string {
  return typeof value === "string" && skillNamePattern.test(value);
}

export interface SkillDocument {
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

function scalar(raw: string, key: string): string {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Reported below with the field name.
    }
    throw new Error(
      `Skill frontmatter field ${key} has an invalid quoted value`,
    );
  }
  if (value.startsWith("'")) {
    if (value.length < 2 || !value.endsWith("'"))
      throw new Error(
        `Skill frontmatter field ${key} has an invalid quoted value`,
      );
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === "|" || value === ">" || /^[|>][+-]?$/.test(value))
    throw new Error(
      `Skill frontmatter field ${key} must be a single-line value`,
    );
  return value;
}

/**
 * Reads the small frontmatter subset skills use: top-level `key: value` lines
 * with plain, single- or double-quoted scalars. Unknown keys are ignored so
 * newer skill formats still load; nothing in frontmatter can carry authority.
 */
export function parseSkillDocument(text: string): SkillDocument {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const opening = /^---\r?\n/.exec(source);
  if (!opening) throw new Error("SKILL.md must start with --- frontmatter");
  const closing = /^---[ \t]*(?:\r?\n|$)/m;
  const rest = source.slice(opening[0].length);
  const end = closing.exec(rest);
  if (!end) throw new Error("SKILL.md frontmatter is not closed with ---");
  const fields = new Map<string, string>();
  for (const line of rest.slice(0, end.index).split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    // Indented lines belong to nested values of keys skills do not use.
    if (/^\s/.test(line)) continue;
    const match = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (!match) throw new Error("SKILL.md frontmatter has an invalid line");
    const [, key, value = ""] = match;
    if (key === "name" || key === "description")
      fields.set(key, scalar(value, key));
  }
  const name = fields.get("name");
  const description = fields.get("description")?.trim();
  if (!isSkillName(name))
    throw new Error(
      "Skill name must be 1-64 lowercase letters, digits or hyphens",
    );
  if (!description) throw new Error("Skill frontmatter needs a description");
  if (description.length > maxDescriptionCharacters)
    throw new Error(
      `Skill description exceeds ${maxDescriptionCharacters} characters`,
    );
  return {
    name,
    description,
    body: rest.slice(end.index + end[0].length),
  };
}
