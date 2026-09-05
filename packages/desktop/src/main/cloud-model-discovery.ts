import type { CloudProviderDefinition } from "@truss-harness/provider-openai-compatible";
import type { DesktopModelInfo } from "../shared.js";
import {
  modelInfoFromRecord,
  usableChatModels,
} from "./desktop-configuration.js";

/** Lists cloud models without depending on Electron or credential storage. */
export async function discoverCloudModels(
  definition: CloudProviderDefinition,
  baseUrl: string,
  credential: string,
  requestFetch: typeof fetch = globalThis.fetch,
): Promise<readonly DesktopModelInfo[]> {
  const root = baseUrl.replace(/\/$/, "");
  const ollama = definition.compatibility === "ollama-api";
  const anthropic = definition.id === "anthropic";
  const headers: Record<string, string> = anthropic
    ? { "x-api-key": credential, "anthropic-version": "2023-06-01" }
    : { Authorization: `Bearer ${credential}` };
  const records: unknown[] = [];
  let nextUrl: string | undefined = `${root}/${ollama ? "api/tags" : "models"}`;
  for (let page = 0; nextUrl && page < 20; page += 1) {
    const response = await requestFetch(nextUrl, { headers });
    if (!response.ok)
      throw new Error(
        `${definition.label} model discovery failed (${response.status}).`,
      );
    const payload = (await response.json()) as {
      readonly data?: readonly unknown[];
      readonly models?: readonly unknown[];
      readonly nextPageToken?: string;
      readonly has_more?: boolean;
      readonly last_id?: string | null;
    };
    records.push(...(ollama ? (payload.models ?? []) : (payload.data ?? [])));
    const pagedUrl: URL = new URL(nextUrl);
    if (anthropic && payload.has_more && payload.last_id) {
      if (pagedUrl.searchParams.get("after_id") === payload.last_id) break;
      pagedUrl.searchParams.set("after_id", payload.last_id);
      nextUrl = pagedUrl.toString();
    } else if (!anthropic && !ollama && payload.nextPageToken) {
      pagedUrl.searchParams.set("pageToken", payload.nextPageToken);
      nextUrl = pagedUrl.toString();
    } else nextUrl = undefined;
  }
  const models = usableChatModels(
    records.flatMap((record) => {
      const info = modelInfoFromRecord(record, definition.id);
      return info ? [info] : [];
    }),
  );
  return [...new Map(models.map((model) => [model.id, model])).values()];
}
