/**
 * Identity management for CipherChat.
 * Handles first-launch setup, persisting display name, and exposing our own userId/publicKey.
 */

import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  generateAndStoreKeyPair,
  generateUserId,
  hasKeyPair,
  getMyPublicKey,
} from "./crypto";
import type { Identity } from "../types/index";

const USER_ID_KEY = "cipher_chat_user_id";
const DISPLAY_NAME_KEY = "cipher_chat_display_name";

/**
 * Get the current identity, or null if onboarding hasn't completed.
 */
export async function getIdentity(): Promise<Identity | null> {
  const userId = await AsyncStorage.getItem(USER_ID_KEY);
  const displayName = await AsyncStorage.getItem(DISPLAY_NAME_KEY);
  const publicKeyBase64 = await getMyPublicKey();

  if (!userId || !displayName || !publicKeyBase64) return null;
  return { userId, displayName, publicKeyBase64 };
}

/**
 * Create a new identity (first launch).
 * Generates a userId and X25519 keypair.
 */
export async function createIdentity(displayName: string): Promise<Identity> {
  const userId = generateUserId();
  const { publicKeyBase64 } = await generateAndStoreKeyPair();

  await AsyncStorage.setItem(USER_ID_KEY, userId);
  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName);

  return { userId, displayName, publicKeyBase64 };
}

/**
 * Update display name.
 */
export async function updateDisplayName(displayName: string): Promise<void> {
  await AsyncStorage.setItem(DISPLAY_NAME_KEY, displayName);
}

/**
 * Derive a deterministic conversationId for a pair of userIds.
 * Sorted alphabetically so Alice+Bob == Bob+Alice.
 */
export function getConversationId(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join("__");
}

/**
 * Generate a random avatar color from a palette.
 */
const AVATAR_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#06b6d4",
];
export function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

/**
 * Get initials from a display name for avatar placeholder.
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
