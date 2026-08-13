import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderAccount } from "@truss-harness/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { CredentialService } from "./credential-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("CredentialService", () => {
  it("round trips encrypted account credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "truss-credentials-"));
    temporaryDirectories.push(directory);
    const accounts: ProviderAccount[] = [
      {
        id: "openrouter:work",
        providerId: "openrouter",
        label: "Work",
        authMethod: "api-key",
        status: "active",
        createdAt: "now",
        updatedAt: "now",
      },
    ];
    const service = new CredentialService(
      () => join(directory, "credentials.json"),
      () => accounts,
      {
        isAvailable: () => true,
        encrypt: (value) => Buffer.from(`encrypted:${value}`),
        decrypt: (value) => value.toString().replace(/^encrypted:/, ""),
      },
    );

    await service.save("openrouter", "openrouter:work", "secret");
    expect(await service.get("openrouter:work")).toBe("secret");
    await service.remove("openrouter", "openrouter:work");
    expect(await service.get("openrouter:work")).toBeUndefined();
  });

  it("keeps credentials in memory when secure storage is unavailable", async () => {
    const account: ProviderAccount = {
      id: "openai:default",
      providerId: "openai",
      label: "OpenAI",
      authMethod: "api-key",
      status: "active",
      createdAt: "now",
      updatedAt: "now",
    };
    const service = new CredentialService(
      () => "/not-written",
      () => [account],
      {
        isAvailable: () => false,
        encrypt: () => Buffer.alloc(0),
        decrypt: () => "",
      },
    );

    await service.save("openai", "openai:default", "session-secret");
    expect(service.storageKind()).toBe("session-only");
    expect(await service.get("openai:default")).toBe("session-secret");
  });
});
