/** Authentication material resolved immediately before a provider request is sent. */
export type ResolvedCredential =
  | { readonly kind: "bearer"; readonly token: string }
  | { readonly kind: "header"; readonly name: string; readonly value: string }
  | { readonly kind: "request-signer"; sign(request: Request): Promise<Request> };

/** A replaceable source of model-provider credentials. */
export interface CredentialProvider {
  readonly id: string;
  resolve(): Promise<ResolvedCredential>;
  refresh?(): Promise<void>;
}

export type ApiKeySource = string | (() => string | Promise<string>);

/** Resolves an API key without exposing it to the agent runtime or persisted configuration. */
export class ApiKeyCredential implements CredentialProvider {
  constructor(
    readonly id: string,
    private readonly source: ApiKeySource,
    private readonly placement: { readonly kind: "bearer" } | { readonly kind: "header"; readonly name: string } = { kind: "bearer" }
  ) {}

  async resolve(): Promise<ResolvedCredential> {
    const value = (typeof this.source === "function" ? await this.source() : this.source).trim();
    if (!value) throw new Error(`Credential '${this.id}' did not resolve to a value.`);
    return this.placement.kind === "bearer"
      ? { kind: "bearer", token: value }
      : { kind: "header", name: this.placement.name, value };
  }
}

/** Dependency-injected credential lookup; clients decide how each credential is stored. */
export class CredentialProviderRegistry {
  private readonly credentials = new Map<string, CredentialProvider>();

  register(credential: CredentialProvider): void {
    if (this.credentials.has(credential.id)) throw new Error(`Credential provider already registered: ${credential.id}`);
    this.credentials.set(credential.id, credential);
  }

  get(id: string): CredentialProvider | undefined {
    return this.credentials.get(id);
  }

  require(id: string): CredentialProvider {
    const credential = this.get(id);
    if (!credential) throw new Error(`Credential provider is not registered: ${id}`);
    return credential;
  }

  list(): readonly CredentialProvider[] {
    return [...this.credentials.values()];
  }
}
