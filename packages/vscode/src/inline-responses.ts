export class InlineResponseBuffer {
  private readonly buffers = new Map<string, string>();

  begin(requestId: string): void {
    this.buffers.set(requestId, "");
  }

  append(requestId: string, text: string): void {
    const current = this.buffers.get(requestId);
    if (current !== undefined) this.buffers.set(requestId, current + text);
  }

  value(requestId: string): string | undefined {
    return this.buffers.get(requestId);
  }

  end(requestId: string): void {
    this.buffers.delete(requestId);
  }
}
