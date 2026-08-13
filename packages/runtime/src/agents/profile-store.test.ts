import { describe, expect, it } from "vitest";
import { InMemoryAgentProfileStore } from "./profile-store.js";

const provider = {
  providerId: "ollama",
  modelId: "qwen-coder",
} as const;

describe("InMemoryAgentProfileStore", () => {
  it("creates, updates, lists, and deletes normalized profiles", async () => {
    const profiles = new InMemoryAgentProfileStore();
    const created = await profiles.create({
      displayName: "  Reviewer  ",
      instructions: "  Review the diff.  ",
      provider,
      mode: "plan",
      approvalPolicy: "auto-read",
      internetAccess: true,
    });

    expect(created).toMatchObject({
      displayName: "Reviewer",
      instructions: "Review the diff.",
      provider,
      mode: "plan",
      approvalPolicy: "auto-read",
      internetAccess: true,
    });
    expect(await profiles.list()).toEqual([created]);

    const updated = await profiles.update(created.id, {
      displayName: "Implementer",
      instructions: "   ",
      mode: "edit",
    });
    expect(updated.displayName).toBe("Implementer");
    expect(updated.instructions).toBeUndefined();
    expect(updated.mode).toBe("edit");
    expect(await profiles.delete(created.id)).toBe(true);
    expect(await profiles.get(created.id)).toBeUndefined();
  });

  it("rejects incomplete provider and profile metadata", async () => {
    const profiles = new InMemoryAgentProfileStore();

    await expect(
      profiles.create({ displayName: "", provider }),
    ).rejects.toMatchObject({
      code: "invalid_profile",
    });
    await expect(
      profiles.create({
        displayName: "Reviewer",
        provider: { providerId: "", modelId: "qwen-coder" },
      }),
    ).rejects.toMatchObject({
      code: "invalid_profile",
    });
    await expect(
      profiles.create({
        displayName: "Reviewer",
        provider: { providerId: "ollama", modelId: "" },
      }),
    ).rejects.toMatchObject({
      code: "invalid_profile",
    });
  });
});
