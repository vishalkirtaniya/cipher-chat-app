/**
 * CipherChat App Store (Zustand)
 *
 * Feature: activeConversationId — suppress notifications when chat is open
 */

import { create } from "zustand";
import type {
  Identity,
  Contact,
  Conversation,
  Message,
  MessageStatus,
  EncryptedPayload,
} from "../types";
import {
  encryptMessage,
  decryptMessage,
  generateMessageId,
  clearSecretCache,
} from "../lib/crypto";
import {
  getContacts,
  upsertContact,
  getConversations,
  getMessages,
  saveMessage,
  updateMessageStatus,
  deleteMessage as dbDeleteMessage,
  deleteConversation as dbDeleteConversation,
  updateConversationPreview,
  clearUnreadCount,
  purgeExpiredMessages,
  setMessagePlaintextCache,
} from "../lib/storage";
import { wsClient, ConnectionState } from "../lib/websocket";
import {
  getIdentity,
  getConversationId,
  randomAvatarColor,
} from "../lib/identity";
import * as Notifications from "expo-notifications";

interface ChatStore {
  identity: Identity | null;
  setIdentity: (identity: Identity) => void;

  connectionState: ConnectionState;

  // Track which chat screen is open — used to suppress notifications
  activeConversationId: string | null;
  setActiveConversation: (id: string | null) => void;

  contacts: Map<string, Contact>;
  loadContacts: () => Promise<void>;
  addContact: (
    userId: string,
    displayName: string,
    publicKey: string,
  ) => Promise<void>;

  conversations: Conversation[];
  loadConversations: () => Promise<void>;

  messages: Map<string, Message[]>;
  loadMessages: (conversationId: string) => Promise<void>;
  sendMessage: (
    contactUserId: string,
    body: string,
    ttl?: number,
  ) => Promise<void>;
  deleteMessage: (
    messageId: string,
    conversationId: string,
    toUserId: string,
  ) => Promise<void>;
  clearChat: (conversationId: string) => Promise<void>;

  markConversationRead: (
    conversationId: string,
    contactUserId: string,
  ) => Promise<void>;

  typingUsers: Set<string>;
  setTyping: (to: string, isTyping: boolean) => void;

  init: () => Promise<void>;
  handleIncomingEvents: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  identity: null,
  connectionState: "disconnected",
  activeConversationId: null,
  contacts: new Map(),
  conversations: [],
  messages: new Map(),
  typingUsers: new Set(),

  setIdentity: (identity) => set({ identity }),
  setActiveConversation: (id) => set({ activeConversationId: id }),

  // ─── Init ────────────────────────────────────────────────────────────────────
  init: async () => {
    await purgeExpiredMessages();
    const identity = await getIdentity();
    if (!identity) return;
    set({ identity });
    await get().loadContacts();
    await get().loadConversations();
    wsClient.connect(identity.userId, identity.publicKeyBase64);
    wsClient.onStateChange((connectionState) => set({ connectionState }));
    get().handleIncomingEvents();

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  },

  // ─── Incoming WS events ──────────────────────────────────────────────────────
  handleIncomingEvents: () => {
    wsClient.on("message", async (msg: any) => {
      const { identity, contacts, activeConversationId } = get();
      if (!identity) return;

      const contact = contacts.get(msg.from);
      if (!contact) {
        console.warn("[store] Message from unknown contact:", msg.from);
        return;
      }

      let body: string;
      try {
        body = await decryptMessage(msg.payload, contact.publicKey);
      } catch (err) {
        console.error("[store] Decryption failed:", err);
        return;
      }

      const conversationId = getConversationId(identity.userId, msg.from);
      const now = msg.timestamp || Date.now();
      const ttl = msg.ttl || 0;

      const message: Message = {
        id: msg.messageId,
        conversationId,
        fromUserId: msg.from,
        toUserId: identity.userId,
        body,
        type: "text",
        status: "delivered",
        timestamp: now,
        ttl,
        expiresAt: ttl > 0 ? now + ttl : undefined,
        isDeleted: false,
      };

      await saveMessage({
        message: { ...message, body: "" } as any,
        encryptedPayloadJson: JSON.stringify(msg.payload),
        plaintextCache: body,
      });

      const preview = body.length > 40 ? body.slice(0, 40) + "…" : body;
      await updateConversationPreview(conversationId, preview, now, true);

      set((state) => ({
        messages: new Map(state.messages).set(conversationId, [
          message,
          ...(state.messages.get(conversationId) || []),
        ]),
        conversations: updateConvPreview(
          state.conversations,
          conversationId,
          preview,
          now,
        ),
      }));

      wsClient.sendReceipt(msg.from, [msg.messageId], "delivered");

      // Only notify if user is NOT currently viewing this conversation
      const isInThisChat = activeConversationId === conversationId;
      if (!isInThisChat) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: contact.displayName,
            body,
            data: { conversationId, contactUserId: msg.from },
          },
          trigger: null,
        });
      }
    });

    wsClient.on("ack", (msg: any) => {
      updateMessageStatus(msg.messageId, msg.status as MessageStatus);
      set((state) => ({
        messages: updateMessageStatusInState(
          state.messages,
          msg.messageId,
          msg.status,
        ),
      }));
    });

    wsClient.on("receipt", async (msg: any) => {
      for (const id of msg.messageIds)
        await updateMessageStatus(id, msg.status);
      set((state) => {
        let messages = state.messages;
        for (const id of msg.messageIds) {
          messages = updateMessageStatusInState(messages, id, msg.status);
        }
        return { messages };
      });
    });

    wsClient.on("delete_message", async (msg: any) => {
      for (const id of msg.messageIds) await dbDeleteMessage(id);
      set((state) => {
        const newMessages = new Map(state.messages);
        for (const [convId, msgs] of newMessages.entries()) {
          newMessages.set(
            convId,
            msgs.map((m) =>
              msg.messageIds.includes(m.id)
                ? { ...m, isDeleted: true, body: "" }
                : m,
            ),
          );
        }
        return { messages: newMessages };
      });
    });

    wsClient.on("typing", (msg: any) => {
      set((state) => {
        const typingUsers = new Set(state.typingUsers);
        if (msg.isTyping) {
          typingUsers.add(msg.from);
          setTimeout(() => {
            set((s) => {
              const t = new Set(s.typingUsers);
              t.delete(msg.from);
              return { typingUsers: t };
            });
          }, 4000);
        } else {
          typingUsers.delete(msg.from);
        }
        return { typingUsers };
      });
    });

    wsClient.on("online_status", (msg: any) => {
      set((state) => {
        const contacts = new Map(state.contacts);
        const c = contacts.get(msg.userId);
        if (c) contacts.set(msg.userId, { ...c, isOnline: msg.isOnline });
        return { contacts };
      });
    });
  },

  // ─── Contacts ────────────────────────────────────────────────────────────────
  loadContacts: async () => {
    const rows = await getContacts();
    set({ contacts: new Map(rows.map((c) => [c.userId, c])) });
  },

  addContact: async (userId, displayName, publicKey) => {
    const { identity } = get();
    if (!identity) throw new Error("No identity");
    const conversationId = getConversationId(identity.userId, userId);
    await upsertContact({
      userId,
      displayName,
      publicKey,
      avatarColor: randomAvatarColor(),
      conversationId,
    });
    await get().loadContacts();
    await get().loadConversations();
  },

  // ─── Conversations ────────────────────────────────────────────────────────────
  loadConversations: async () => {
    const convs = await getConversations();
    set({ conversations: convs });
  },

  // ─── Messages ────────────────────────────────────────────────────────────────
  loadMessages: async (conversationId) => {
    const { identity, contacts } = get();
    if (!identity) return;
    const rows = await getMessages(conversationId);
    const messages: Message[] = [];

    for (const row of rows) {
      let body = row.plaintextCache || "";
      if (!body && row.encryptedPayloadJson) {
        try {
          const contactId =
            row.fromUserId === identity.userId ? row.toUserId : row.fromUserId;
          const contact = contacts.get(contactId);
          if (contact) {
            const payload = JSON.parse(
              row.encryptedPayloadJson,
            ) as EncryptedPayload;
            body = await decryptMessage(payload, contact.publicKey);
            await setMessagePlaintextCache(row.id, body);
          }
        } catch {
          body = "[Unable to decrypt]";
        }
      }

      messages.push({
        id: row.id,
        conversationId,
        fromUserId: row.fromUserId,
        toUserId: row.toUserId,
        body,
        type: row.type as any,
        status: row.status as any,
        timestamp: row.timestamp,
        ttl: row.ttl,
        expiresAt: row.expiresAt ?? undefined,
        isDeleted: row.isDeleted === 1,
      });
    }

    set((state) => ({
      messages: new Map(state.messages).set(conversationId, messages),
    }));
  },

  sendMessage: async (contactUserId, body, ttl = 0) => {
    const { identity, contacts } = get();
    if (!identity) throw new Error("No identity");
    const contact = contacts.get(contactUserId);
    if (!contact) throw new Error("Contact not found");

    const messageId = generateMessageId();
    const conversationId = getConversationId(identity.userId, contactUserId);
    const timestamp = Date.now();
    const payload = await encryptMessage(
      body,
      contact.publicKey,
      identity.publicKeyBase64,
    );

    const message: Message = {
      id: messageId,
      conversationId,
      fromUserId: identity.userId,
      toUserId: contactUserId,
      body,
      type: "text",
      status: "sending",
      timestamp,
      ttl,
      expiresAt: ttl > 0 ? timestamp + ttl : undefined,
      isDeleted: false,
    };

    set((state) => {
      const existing = state.messages.get(conversationId) || [];
      const preview = body.length > 40 ? body.slice(0, 40) + "…" : body;
      return {
        messages: new Map(state.messages).set(conversationId, [
          message,
          ...existing,
        ]),
        conversations: updateConvPreview(
          state.conversations,
          conversationId,
          preview,
          timestamp,
        ),
      };
    });

    await saveMessage({
      message: { ...message, body: "" } as any,
      encryptedPayloadJson: JSON.stringify(payload),
      plaintextCache: body,
    });

    wsClient.sendMessage({
      to: contactUserId,
      from: identity.userId,
      messageId,
      payload,
      timestamp,
      ttl: ttl || undefined,
    });

    const preview = body.length > 40 ? body.slice(0, 40) + "…" : body;
    await updateConversationPreview(conversationId, preview, timestamp, false);
  },

  deleteMessage: async (messageId, conversationId, toUserId) => {
    await dbDeleteMessage(messageId);
    wsClient.sendDeleteSignal(toUserId, [messageId]);
    set((state) => ({
      messages: new Map(state.messages).set(
        conversationId,
        (state.messages.get(conversationId) || []).map((m) =>
          m.id === messageId ? { ...m, isDeleted: true, body: "" } : m,
        ),
      ),
    }));
  },

  clearChat: async (conversationId) => {
    await dbDeleteConversation(conversationId);
    set((state) => ({
      messages: new Map(state.messages).set(conversationId, []),
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? { ...c, lastMessageBody: "", lastMessageAt: 0, unreadCount: 0 }
          : c,
      ),
    }));
  },

  markConversationRead: async (conversationId, contactUserId) => {
    const { messages } = get();
    const msgs = messages.get(conversationId) || [];
    const unread = msgs
      .filter((m) => m.status === "delivered" || m.status === "server_received")
      .map((m) => m.id);
    await clearUnreadCount(conversationId);
    if (unread.length > 0) wsClient.sendReceipt(contactUserId, unread, "read");
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId ? { ...c, unreadCount: 0 } : c,
      ),
    }));
  },

  setTyping: (to, isTyping) => wsClient.sendTyping(to, isTyping),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateConvPreview(
  conversations: Conversation[],
  conversationId: string,
  preview: string,
  timestamp: number,
): Conversation[] {
  return conversations
    .map((c) =>
      c.id === conversationId
        ? { ...c, lastMessageBody: preview, lastMessageAt: timestamp }
        : c,
    )
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

function updateMessageStatusInState(
  messages: Map<string, Message[]>,
  messageId: string,
  status: string,
): Map<string, Message[]> {
  const newMap = new Map(messages);
  for (const [convId, msgs] of newMap.entries()) {
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      const updated = [...msgs];
      updated[idx] = { ...updated[idx], status: status as MessageStatus };
      newMap.set(convId, updated);
      break;
    }
  }
  return newMap;
}
