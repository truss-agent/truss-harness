import type { ChatAttachment } from "@truss-harness/runtime";
import type {
  ConversationMessage,
  StoredConversation,
  StoredConversationState,
} from "./contracts.js";

const maxStoredConversations = 12;
const maxStoredMessages = 60;
const maxStoredMessageCharacters = 4_000;

function isAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<ChatAttachment>;
  return (
    (attachment.kind === "image" || attachment.kind === "file") &&
    typeof attachment.id === "string" &&
    typeof attachment.name === "string" &&
    typeof attachment.mediaType === "string" &&
    typeof attachment.size === "number" &&
    (attachment.data === undefined || typeof attachment.data === "string") &&
    (attachment.text === undefined || typeof attachment.text === "string")
  );
}

export function normalizeConversationState(
  value: unknown,
): StoredConversationState {
  if (!value || typeof value !== "object") return { conversations: [] };
  const source = value as Partial<StoredConversationState>;
  const conversations = Array.isArray(source.conversations)
    ? source.conversations
        .flatMap((conversation): StoredConversation[] => {
          if (!conversation || typeof conversation !== "object") return [];
          const candidate = conversation as Partial<StoredConversation>;
          if (
            typeof candidate.id !== "string" ||
            typeof candidate.title !== "string" ||
            !Array.isArray(candidate.messages)
          ) {
            return [];
          }
          const messages = candidate.messages
            .flatMap((message): ConversationMessage[] => {
              if (!message || typeof message !== "object") return [];
              const item = message as Partial<ConversationMessage>;
              if (
                (item.role !== "user" && item.role !== "assistant") ||
                typeof item.content !== "string"
              ) {
                return [];
              }
              const attachments = Array.isArray(item.attachments)
                ? item.attachments.filter(isAttachment)
                : [];
              return [
                {
                  role: item.role,
                  content: item.content.slice(-maxStoredMessageCharacters),
                  ...(attachments.length ? { attachments } : {}),
                },
              ];
            })
            .slice(-maxStoredMessages);
          return [
            {
              id: candidate.id,
              title: candidate.title.slice(0, 80),
              messages,
              updatedAt:
                typeof candidate.updatedAt === "string"
                  ? candidate.updatedAt
                  : new Date().toISOString(),
            },
          ];
        })
        .slice(0, maxStoredConversations)
    : [];
  const activeId =
    typeof source.activeId === "string" &&
    conversations.some((conversation) => conversation.id === source.activeId)
      ? source.activeId
      : conversations[0]?.id;
  return { conversations, activeId };
}

export function normalizeHistory(
  value: readonly ConversationMessage[],
): readonly ConversationMessage[] {
  return (
    normalizeConversationState({
      conversations: [
        {
          id: "history",
          title: "history",
          messages: value,
          updatedAt: new Date().toISOString(),
        },
      ],
    }).conversations[0]?.messages ?? []
  );
}
