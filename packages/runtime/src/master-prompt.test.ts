import { describe, expect, it } from "vitest";
import {
  MasterPromptTemplateError,
  renderMasterPrompt,
  validateMasterPrompt,
} from "./master-prompt.js";

const context = {
  workspace: { name: "demo<&", root: "/work/<demo>" },
  repository: { branch: "feature/<safe>", changedFiles: ["a&b.ts"] },
  agent: { mode: "edit" as const },
  session: { id: "session-1" },
  date: { iso: "2026-08-28T00:00:00.000Z" },
};

describe("master prompt templates", () => {
  it("preserves literal XML while safely rendering approved variables", () => {
    expect(
      renderMasterPrompt(
        {
          enabled: true,
          template:
            '<project name="{{workspace.name}}">{{repository.branch}}</project>',
        },
        context,
      ),
    ).toBe('<project name="demo&lt;&amp;">feature/&lt;safe&gt;</project>');
  });

  it("reports unknown and malformed variables before a model request", () => {
    const validation = validateMasterPrompt({
      enabled: true,
      template: "{{environment.API_KEY}} {{workspace.name}",
    });
    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        "Unknown master prompt variable: {{environment.API_KEY}}.",
        "Master prompt tokens must use complete {{variable.name}} syntax.",
      ]),
    );
    expect(() =>
      renderMasterPrompt(
        { enabled: true, template: "{{environment.API_KEY}}" },
        context,
      ),
    ).toThrow(MasterPromptTemplateError);
  });

  it("does not render a disabled template", () => {
    expect(
      renderMasterPrompt(
        { enabled: false, template: "<ignored>{{workspace.name}}</ignored>" },
        context,
      ),
    ).toBeUndefined();
  });
});
