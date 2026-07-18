import { randomUUID } from "node:crypto";
import type { ChatMessage, Session, SessionCheckpoint } from "./contracts.js";

export interface SessionStore {
  create(messages?: readonly ChatMessage[]): Promise<Session>;
  get(id: string): Promise<Session | undefined>;
  list(): Promise<readonly Session[]>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<boolean>;
  restoreCheckpoint(id: string): Promise<Session | undefined>;
}

/** Replaceable in-memory store appropriate for local development and tests. */
export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  async create(messages: readonly ChatMessage[] = []): Promise<Session> {
    const now = new Date();
    const session = { id: randomUUID(), createdAt: now, updatedAt: now, messages: [...messages] };
    this.sessions.set(session.id, session);
    return session;
  }
  async get(id: string): Promise<Session | undefined> { return this.sessions.get(id); }
  async list(): Promise<readonly Session[]> { return [...this.sessions.values()]; }
  async save(session: Session): Promise<void> { session.updatedAt = new Date(); this.sessions.set(session.id, session); }
  async delete(id: string): Promise<boolean> { return this.sessions.delete(id); }
  async restoreCheckpoint(id: string): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    if (!session?.checkpoint) return session;

    session.messages = [...session.checkpoint.messages];
    session.updatedAt = new Date();
    this.sessions.set(id, session);
    return session;
  }
}

export function checkpoint(session: Session): SessionCheckpoint { return { messages: [...session.messages], createdAt: new Date() }; }
