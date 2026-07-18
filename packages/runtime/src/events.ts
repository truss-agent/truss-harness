import type { RuntimeEvent } from "./contracts.js";

export type EventListener<T> = (event: T) => void | Promise<void>;

/** Small async event bus; clients can subscribe without knowing runtime internals. */
export class EventBus<T> {
  private readonly listeners = new Set<EventListener<T>>();

  subscribe(listener: EventListener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async emit(event: T): Promise<void> {
    await Promise.all([...this.listeners].map((listener) => listener(event)));
  }
}

export type RuntimeEventBus = EventBus<RuntimeEvent>;
