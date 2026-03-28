/**
 * CipherChat Local Storage Layer
 *
 * Uses expo-sqlite for all on-device persistence.
 * Schema:
 *   contacts      — known contacts + their public keys
 *   conversations — one row per chat thread (metadata only)
 *   messages      — all messages (ciphertext stored, decrypted on read)
 *
 * IMPORTANT: We store the ENCRYPTED ciphertext payload in the DB,
 * not the plaintext. Decryption happens at display time.
 * If the DB file is extracted from the device, messages remain unreadable.
 */

import * as SQLite from "expo-sqlite";
import type { Message, Contact, Conversation } from "../types/index";

let db: SQLite.SQLiteDatabase | null = null;

// ─── Init ────────────────────────────────────────────────────────────────────────

export async function initDatabase(): Promise<void> {
  db = await SQLite.openDatabaseAsync("cipherchat.db");

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS contacts (
      userId        TEXT PRIMARY KEY,
      displayName   TEXT NOT NULL,
      publicKey     TEXT NOT NULL,
      avatarColor   TEXT NOT NULL DEFAULT '#6366f1',
      lastSeen      INTEGER,
      conversationId TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id              TEXT PRIMARY KEY,
      contactUserId   TEXT NOT NULL,
      lastMessageBody TEXT DEFAULT '',
      lastMessageAt   INTEGER DEFAULT 0,
      unreadCount     INTEGER DEFAULT 0,
      FOREIGN KEY (contactUserId) REFERENCES contacts(userId) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id              TEXT PRIMARY KEY,
      conversationId  TEXT NOT NULL,
      fromUserId      TEXT NOT NULL,
      toUserId        TEXT NOT NULL,
      -- Encrypted payload stored as JSON string
      encryptedPayload TEXT NOT NULL,
      -- Cached plaintext — written after first successful decrypt
      -- NULL means not yet decrypted/cached
      plaintextCache  TEXT,
      type            TEXT NOT NULL DEFAULT 'text',
      status          TEXT NOT NULL DEFAULT 'sending',
      timestamp       INTEGER NOT NULL,
      ttl             INTEGER NOT NULL DEFAULT 0,
      expiresAt       INTEGER,
      isDeleted       INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (conversationId) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(conversationId, timestamp DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_status
      ON messages(status);
  `);
}

function getDb(): SQLite.SQLiteDatabase {
  if (!db)
    throw new Error("Database not initialized. Call initDatabase() first.");
  return db;
}

// ─── Contacts ────────────────────────────────────────────────────────────────────

export async function upsertContact(
  contact: Omit<Contact, "isOnline">,
): Promise<void> {
  const d = getDb();
  await d.runAsync(
    `INSERT INTO contacts (userId, displayName, publicKey, avatarColor, lastSeen, conversationId)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET
       displayName = excluded.displayName,
       publicKey = excluded.publicKey,
       lastSeen = excluded.lastSeen`,
    [
      contact.userId,
      contact.displayName,
      contact.publicKey,
      contact.avatarColor,
      contact.lastSeen ?? null,
      contact.conversationId,
    ],
  );

  // Create conversation row if it doesn't exist
  await d.runAsync(
    `INSERT OR IGNORE INTO conversations (id, contactUserId) VALUES (?, ?)`,
    [contact.conversationId, contact.userId],
  );
}

export async function getContacts(): Promise<Contact[]> {
  const d = getDb();
  const rows = await d.getAllAsync<any>(
    "SELECT * FROM contacts ORDER BY displayName ASC",
  );
  return rows.map(rowToContact);
}

export async function getContact(userId: string): Promise<Contact | null> {
  const d = getDb();
  const row = await d.getFirstAsync<any>(
    "SELECT * FROM contacts WHERE userId = ?",
    [userId],
  );
  return row ? rowToContact(row) : null;
}

function rowToContact(row: any): Contact {
  return {
    userId: row.userId,
    displayName: row.displayName,
    publicKey: row.publicKey,
    avatarColor: row.avatarColor,
    lastSeen: row.lastSeen ?? undefined,
    isOnline: false, // always false from DB; updated in-memory by WS
    conversationId: row.conversationId,
  };
}

// ─── Conversations ───────────────────────────────────────────────────────────────

export async function getConversations(): Promise<Conversation[]> {
  const d = getDb();
  const rows = await d.getAllAsync<any>(
    `SELECT c.*, co.displayName, co.avatarColor, co.publicKey
     FROM conversations c
     JOIN contacts co ON co.userId = c.contactUserId
     ORDER BY c.lastMessageAt DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    contactUserId: r.contactUserId,
    lastMessageBody: r.lastMessageBody,
    lastMessageAt: r.lastMessageAt,
    unreadCount: r.unreadCount,
  }));
}

export async function updateConversationPreview(
  conversationId: string,
  lastMessageBody: string,
  lastMessageAt: number,
  incrementUnread: boolean,
): Promise<void> {
  const d = getDb();
  await d.runAsync(
    `UPDATE conversations SET
       lastMessageBody = ?,
       lastMessageAt = ?,
       unreadCount = unreadCount + ?
     WHERE id = ?`,
    [lastMessageBody, lastMessageAt, incrementUnread ? 1 : 0, conversationId],
  );
}

export async function clearUnreadCount(conversationId: string): Promise<void> {
  const d = getDb();
  await d.runAsync("UPDATE conversations SET unreadCount = 0 WHERE id = ?", [
    conversationId,
  ]);
}

// ─── Messages ────────────────────────────────────────────────────────────────────

/**
 * Save a message. encryptedPayload is a JSON-serialized EncryptedPayload.
 * plaintextCache is optional — pass it to warm the cache on send.
 */
export async function saveMessage(params: {
  message: Omit<Message, "body">;
  encryptedPayloadJson: string;
  plaintextCache?: string;
}): Promise<void> {
  const { message: m, encryptedPayloadJson, plaintextCache } = params;
  const d = getDb();
  await d.runAsync(
    `INSERT OR REPLACE INTO messages
       (id, conversationId, fromUserId, toUserId, encryptedPayload, plaintextCache,
        type, status, timestamp, ttl, expiresAt, isDeleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      m.id,
      m.conversationId,
      m.fromUserId,
      m.toUserId,
      encryptedPayloadJson,
      plaintextCache ?? null,
      m.type,
      m.status,
      m.timestamp,
      m.ttl,
      m.expiresAt ?? null,
      m.isDeleted ? 1 : 0,
    ],
  );
}

export async function getMessages(
  conversationId: string,
  limit = 50,
  beforeTimestamp?: number,
): Promise<
  Array<{
    id: string;
    encryptedPayloadJson: string;
    plaintextCache: string | null;
    fromUserId: string;
    toUserId: string;
    status: string;
    timestamp: number;
    ttl: number;
    expiresAt: number | null;
    isDeleted: number;
    type: string;
  }>
> {
  const d = getDb();
  if (beforeTimestamp !== undefined) {
    return d.getAllAsync<any>(
      `SELECT * FROM messages
       WHERE conversationId = ? AND timestamp < ? AND isDeleted = 0
       ORDER BY timestamp DESC LIMIT ?`,
      [conversationId, beforeTimestamp, limit],
    );
  }
  return d.getAllAsync<any>(
    `SELECT * FROM messages
     WHERE conversationId = ? AND isDeleted = 0
     ORDER BY timestamp DESC LIMIT ?`,
    [conversationId, limit],
  );
}

export async function updateMessageStatus(
  messageId: string,
  status: Message["status"],
): Promise<void> {
  const d = getDb();
  await d.runAsync("UPDATE messages SET status = ? WHERE id = ?", [
    status,
    messageId,
  ]);
}

export async function setMessagePlaintextCache(
  messageId: string,
  plaintext: string,
): Promise<void> {
  const d = getDb();
  await d.runAsync("UPDATE messages SET plaintextCache = ? WHERE id = ?", [
    plaintext,
    messageId,
  ]);
}

/**
 * Soft-delete a message (sets isDeleted = 1 and clears plaintext cache).
 */
export async function deleteMessage(messageId: string): Promise<void> {
  const d = getDb();
  await d.runAsync(
    "UPDATE messages SET isDeleted = 1, plaintextCache = NULL WHERE id = ?",
    [messageId],
  );
}

/**
 * Delete all messages in a conversation (wipe chat).
 */
export async function deleteConversation(
  conversationId: string,
): Promise<void> {
  const d = getDb();
  await db!.withTransactionAsync(async () => {
    await d.runAsync("DELETE FROM messages WHERE conversationId = ?", [
      conversationId,
    ]);
    await d.runAsync(
      "UPDATE conversations SET lastMessageBody = '', lastMessageAt = 0, unreadCount = 0 WHERE id = ?",
      [conversationId],
    );
  });
}

/**
 * Hard-delete expired disappearing messages.
 * Call this periodically (e.g. on app foreground).
 */
export async function purgeExpiredMessages(): Promise<void> {
  const d = getDb();
  const now = Date.now();
  await d.runAsync(
    "UPDATE messages SET isDeleted = 1, plaintextCache = NULL WHERE expiresAt IS NOT NULL AND expiresAt < ? AND isDeleted = 0",
    [now],
  );
}
