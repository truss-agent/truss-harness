import type { ModelProvider } from "./contracts.js";

export class ModelProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();
  private defaultProviderId?: string;

  register(provider: ModelProvider, options: { default?: boolean } = {}): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Model provider already registered: ${provider.id}`);
    }

    this.providers.set(provider.id, provider);

    if (options.default || !this.defaultProviderId) {
      this.defaultProviderId = provider.id;
    }
  }

  get(id: string): ModelProvider | undefined {
    return this.providers.get(id);
  }

  default(): ModelProvider {
    if (!this.defaultProviderId) {
      throw new Error("No model providers registered");
    }

    const provider = this.providers.get(this.defaultProviderId);
    if (!provider) {
      throw new Error(`Default model provider is not registered: ${this.defaultProviderId}`);
    }

    return provider;
  }

  list(): readonly ModelProvider[] {
    return [...this.providers.values()];
  }
}
