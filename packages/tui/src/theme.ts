import type { SyntaxToken } from "./file-browser.js";

export const tuiThemeNames = ["forest", "sage", "dusk"] as const;
export type TuiThemeName = (typeof tuiThemeNames)[number];

export interface TuiTheme {
  readonly name: TuiThemeName;
  readonly panel: string;
  readonly focus: string;
  readonly accent: string;
  readonly muted: string;
  readonly text: string;
  readonly directory: string;
  readonly agent: string;
  readonly user: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly overlay: string;
  readonly syntax: Readonly<Record<NonNullable<SyntaxToken["color"]>, string>>;
}

export const tuiThemes: Readonly<Record<TuiThemeName, TuiTheme>> = {
  forest: {
    name: "forest",
    panel: "#416b4c",
    focus: "#7fc58a",
    accent: "#a4dca0",
    muted: "#7e9e81",
    text: "#d8e6d7",
    directory: "#8fba7e",
    agent: "#b4d59a",
    user: "#77bd8a",
    success: "#91ca92",
    warning: "#d3b978",
    error: "#d79a8e",
    overlay: "#13231d",
    syntax: { blue: "#9eb4cf", cyan: "#8cc8bd", gray: "#71867d", green: "#a9c994", magenta: "#c4a8c8", red: "#d4958a", yellow: "#d6c184" }
  },
  sage: {
    name: "sage",
    panel: "#5d7666",
    focus: "#a5c6ab",
    accent: "#b3d5ba",
    muted: "#8e9f91",
    text: "#dce5dd",
    directory: "#9bbcab",
    agent: "#bad1a0",
    user: "#8ab9b0",
    success: "#9dca9c",
    warning: "#d6ba83",
    error: "#d69b91",
    overlay: "#1a241d",
    syntax: { blue: "#9eafcf", cyan: "#89c0b4", gray: "#7d8d80", green: "#afcc9a", magenta: "#c5aac4", red: "#d5958d", yellow: "#d7c183" }
  },
  dusk: {
    name: "dusk",
    panel: "#3d665d",
    focus: "#78aa95",
    accent: "#8cc2aa",
    muted: "#728a82",
    text: "#d1dfda",
    directory: "#7eaaa0",
    agent: "#a7c38e",
    user: "#7cadba",
    success: "#83bb91",
    warning: "#ceb776",
    error: "#d29289",
    overlay: "#101d1c",
    syntax: { blue: "#93aaca", cyan: "#7eb9ae", gray: "#687d76", green: "#9dbf8c", magenta: "#bda2c3", red: "#cf9188", yellow: "#d0ba80" }
  }
};

export function isTuiThemeName(value: unknown): value is TuiThemeName {
  return typeof value === "string" && tuiThemeNames.includes(value as TuiThemeName);
}

export function tuiTheme(value: TuiThemeName | undefined): TuiTheme {
  return tuiThemes[value ?? "forest"];
}
