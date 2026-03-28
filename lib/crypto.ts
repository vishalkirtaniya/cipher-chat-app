import nacl from "tweetnacl";
import { encodeBase64, decodeBase64 } from "tweetnacl-util";
import * as SecureStore from "expo-secure-store";

const PRIVATE_KEY_STORE_KEY = "cipher_chat_private_key";
const PUBLIC_KEY_STORE_KEY = "cipher_chat_public_key";

// ─── UTF-8 helpers ──────────────────────────────────────────────────────────────

function stringToBytes(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 128) {
      bytes.push(code);
    } else if (code < 2048) {
      bytes.push((code >> 6) | 192);
      bytes.push((code & 63) | 128);
    } else {
      bytes.push((code >> 12) | 224);
      bytes.push(((code >> 6) & 63) | 128);
      bytes.push((code & 63) | 128);
    }
  }
  return new Uint8Array(bytes);
}

function bytesToString(bytes: Uint8Array): string {
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte < 128) {
      str += String.fromCharCode(byte);
      i++;
    } else if (byte < 224) {
      str += String.fromCharCode(((byte & 31) << 6) | (bytes[i + 1] & 63));
      i += 2;
    } else {
      str += String.fromCharCode(
        ((byte & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)
      );
      i += 3;
    }
  }
  return str;
}

// ─── Key generation & storage ───────────────────────────────────────────────────

export async function generateAndStoreKeyPair(): Promise<{ publicKeyBase64: string }> {
  const keyPair = nacl.box.keyPair();
  const publicKeyBase64 = encodeBase64(keyPair.publicKey);
  const privateKeyBase64 = encodeBase64(keyPair.secretKey);
  await SecureStore.setItemAsync(PRIVATE_KEY_STORE_KEY, privateKeyBase64);
  await SecureStore.setItemAsync(PUBLIC_KEY_STORE_KEY, publicKeyBase64);
  return { publicKeyBase64 };
}

export async function getMyPublicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(PUBLIC_KEY_STORE_KEY);
}

async function getMyPrivateKey(): Promise<Uint8Array | null> {
  const stored = await SecureStore.getItemAsync(PRIVATE_KEY_STORE_KEY);
  if (!stored) return null;
  return decodeBase64(stored);
}

export async function hasKeyPair(): Promise<boolean> {
  const key = await SecureStore.getItemAsync(PRIVATE_KEY_STORE_KEY);
  return !!key;
}

// ─── Shared secret ──────────────────────────────────────────────────────────────

const sharedSecretCache = new Map<string, Uint8Array>();

export async function getSharedSecret(theirPublicKeyBase64: string): Promise<Uint8Array> {
  if (sharedSecretCache.has(theirPublicKeyBase64)) {
    return sharedSecretCache.get(theirPublicKeyBase64)!;
  }
  const myPrivateKey = await getMyPrivateKey();
  if (!myPrivateKey) throw new Error("No private key found");
  const theirPublicKey = decodeBase64(theirPublicKeyBase64);
  const sharedSecret = nacl.box.before(theirPublicKey, myPrivateKey);
  sharedSecretCache.set(theirPublicKeyBase64, sharedSecret);
  return sharedSecret;
}

export function clearSecretCache(): void {
  sharedSecretCache.clear();
}

// ─── Encryption ─────────────────────────────────────────────────────────────────

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  senderPublicKey: string;
}

export async function encryptMessage(
  plaintext: string,
  theirPublicKeyBase64: string,
  myPublicKeyBase64: string,
): Promise<EncryptedPayload> {
  const sharedSecret = await getSharedSecret(theirPublicKeyBase64);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = stringToBytes(plaintext);
  const ciphertextBytes = nacl.box.after(messageBytes, nonce, sharedSecret);
  if (!ciphertextBytes) throw new Error("Encryption failed");
  return {
    ciphertext: encodeBase64(ciphertextBytes),
    nonce: encodeBase64(nonce),
    senderPublicKey: myPublicKeyBase64,
  };
}

export async function decryptMessage(
  payload: EncryptedPayload,
  theirPublicKeyBase64: string,
): Promise<string> {
  const sharedSecret = await getSharedSecret(theirPublicKeyBase64);
  const ciphertextBytes = decodeBase64(payload.ciphertext);
  const nonceBytes = decodeBase64(payload.nonce);
  const plaintext = nacl.box.open.after(ciphertextBytes, nonceBytes, sharedSecret);
  if (!plaintext) throw new Error("Decryption failed");
  return bytesToString(plaintext);
}

// ─── Utility ────────────────────────────────────────────────────────────────────

export function generateMessageId(): string {
  const bytes = nacl.randomBytes(16);
  return encodeBase64(bytes).replace(/[+/=]/g, "").slice(0, 22);
}

export function generateUserId(): string {
  const bytes = nacl.randomBytes(12);
  return "u_" + encodeBase64(bytes).replace(/[+/=]/g, "").slice(0, 16);
}