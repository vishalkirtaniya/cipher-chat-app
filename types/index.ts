// ─── Core domain types ──────────────────────────────────────────────────────────

export type MessageStatus =
  | 'sending'
  | 'server_received'
  | 'delivered'
  | 'read'
  | 'failed';

export type MessageType = 'text' | 'image' | 'system';

export interface Message {
  id: string;
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  body: string;
  type: MessageType;
  status: MessageStatus;
  timestamp: number;
  ttl: number;
  expiresAt?: number;
  deletedAt?: number;
  isDeleted: boolean;
}

export interface Contact {
  userId: string;
  displayName: string;
  publicKey: string;
  avatarColor: string;
  lastSeen?: number;
  isOnline: boolean;
  conversationId: string;
}

export interface Conversation {
  id: string;
  contactUserId: string;
  lastMessageBody: string;
  lastMessageAt: number;
  unreadCount: number;
}

// ─── Identity ───────────────────────────────────────────────────────────────────

export interface Identity {
  userId: string;
  displayName: string;
  publicKeyBase64: string;
}

// ─── Contact Card (what gets base64-encoded and shared) ─────────────────────────

export interface ContactCard {
  u: string;   // userId
  n: string;   // displayName
  k: string;   // publicKey (base64)
  v: number;   // version = 1
}

// ─── WebSocket wire types ───────────────────────────────────────────────────────

export interface WireMessage {
  type: 'message';
  from: string;
  messageId: string;
  payload: EncryptedPayload;
  timestamp: number;
  ttl?: number;
  wasQueued?: boolean;
}

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  senderPublicKey: string;
}

export interface WireReceipt {
  type: 'receipt';
  from: string;
  messageIds: string[];
  status: 'delivered' | 'read';
  timestamp: number;
}

export interface WireAck {
  type: 'ack';
  messageId: string;
  status: 'server_received' | 'delivered' | 'queued';
  serverTime: number;
}

export interface WireDeleteMessage {
  type: 'delete_message';
  from: string;
  messageIds: string[];
  timestamp: number;
}

export interface WireTyping {
  type: 'typing';
  from: string;
  isTyping: boolean;
}

export type WireEvent =
  | WireMessage
  | WireReceipt
  | WireAck
  | WireDeleteMessage
  | WireTyping
  | { type: 'pong'; serverTime: number }
  | { type: 'registered'; userId: string; serverTime: number }
  | { type: 'public_key'; userId: string; publicKey: string }
  | { type: 'online_status'; userId: string; isOnline: boolean }
  | { type: 'error'; code: string; detail?: string };

// ─── Navigation ─────────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Onboarding: undefined;
  Home: undefined;
  Chat: { contactUserId: string };
  AddContact: undefined;
  Settings: undefined;
};