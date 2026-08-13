import type {
  DesktopThemePalette,
  DesktopThemePreference,
} from "../../shared.js";

export const customThemeProperties: Readonly<
  Record<keyof DesktopThemePalette, string>
> = {
  background: "--desktop-background",
  surface: "--desktop-surface",
  panel: "--desktop-panel",
  border: "--desktop-border",
  text: "--desktop-text",
  muted: "--desktop-muted",
  accent: "--desktop-accent",
  accentText: "--desktop-accent-text",
  warning: "--desktop-warning",
  error: "--desktop-error",
};

export interface ThemeRoot {
  readonly dataset: DOMStringMap;
  readonly style: Pick<CSSStyleDeclaration, "removeProperty" | "setProperty">;
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export function parseCustomTheme(source: string): DesktopThemePalette {
  const value = source.trim();
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Custom theme must be a JSON object.");
  const palette: Record<string, string> = {};
  for (const [name, color] of Object.entries(parsed)) {
    if (!(name in customThemeProperties))
      throw new Error(`Unknown custom theme token: ${name}.`);
    if (!isThemeColor(color))
      throw new Error(`${name} must be a #RRGGBB color.`);
    palette[name] = color;
  }
  return palette as DesktopThemePalette;
}

export function applyTheme(
  root: ThemeRoot,
  theme: DesktopThemePreference,
): void {
  for (const property of Object.values(customThemeProperties))
    root.style.removeProperty(property);
  if (theme.name === "default") {
    delete root.dataset.desktopTheme;
    return;
  }
  root.dataset.desktopTheme = theme.name;
  if (theme.name !== "custom") return;
  for (const [name, value] of Object.entries(theme.custom ?? {})) {
    const property = customThemeProperties[name as keyof DesktopThemePalette];
    if (property && isThemeColor(value))
      root.style.setProperty(property, value);
  }
}

export function themeDisplayName(theme: DesktopThemePreference): string {
  return theme.name === "custom"
    ? "Custom"
    : theme.name[0].toUpperCase() + theme.name.slice(1);
}
