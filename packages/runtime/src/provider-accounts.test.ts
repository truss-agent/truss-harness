import { describe, expect, it } from "vitest";
import {
  defaultProviderAccountId,
  InMemoryProviderAccountStore,
} from "./provider-accounts.js";

describe("provider accounts", () => {
  it("creates, filters, updates, and deletes non-secret account metadata", async () => {
    const store = new InMemoryProviderAccountStore();
    const openai = await store.create({
      providerId: " openai ",
      label: " Personal ",
      authMethod: "api-key",
      scopes: ["models", "models"],
    });
    await store.create({
      providerId: "openrouter",
      label: "Work",
      authMethod: "api-key",
    });

    expect(openai.providerId).toBe("openai");
    expect(openai.label).toBe("Personal");
    expect(openai.scopes).toEqual(["models"]);
    expect((await store.list("openai")).map((account) => account.id)).toEqual([
      openai.id,
    ]);

    const updated = await store.update(openai.id, {
      label: "Personal API",
      status: "reauth-required",
    });
    expect(updated).toMatchObject({
      label: "Personal API",
      status: "reauth-required",
    });
    expect(await store.delete(openai.id)).toBe(true);
    expect(await store.get(openai.id)).toBeUndefined();
  });

  it("creates deterministic IDs for migrated provider keys", () => {
    expect(defaultProviderAccountId(" openai ")).toBe(
      "provider:openai:default",
    );
    expect(defaultProviderAccountId("custom/provider")).toBe(
      "provider:custom%2Fprovider:default",
    );
  });

  it("rejects incomplete account metadata", async () => {
    const store = new InMemoryProviderAccountStore();
    await expect(
      store.create({ providerId: "openai", label: "", authMethod: "api-key" }),
    ).rejects.toThrow("requires a label");
    await expect(
      store.create({
        providerId: "openai",
        label: "Personal",
        authMethod: "unsupported" as never,
      }),
    ).rejects.toThrow("unsupported auth method");
  });
});
