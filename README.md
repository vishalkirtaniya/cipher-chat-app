<div align="center">

```
 ██████╗██╗██████╗ ██╗  ██╗███████╗██████╗  ██████╗██╗  ██╗ █████╗ ████████╗
██╔════╝██║██╔══██╗██║  ██║██╔════╝██╔══██╗██╔════╝██║  ██║██╔══██╗╚══██╔══╝
██║     ██║██████╔╝███████║█████╗  ██████╔╝██║     ███████║███████║   ██║   
██║     ██║██╔═══╝ ██╔══██║██╔══╝  ██╔══██╗██║     ██╔══██║██╔══██║   ██║   
╚██████╗██║██║     ██║  ██║███████╗██║  ██║╚██████╗██║  ██║██║  ██║   ██║   
 ╚═════╝╚═╝╚═╝     ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝  
```

**The mobile app — end-to-end encrypted messaging for Android & iOS.**

[![React Native](https://img.shields.io/badge/React%20Native-0.74-61DAFB?style=flat-square&logo=react)](https://reactnative.dev)
[![Expo](https://img.shields.io/badge/Expo-SDK%2051-000020?style=flat-square&logo=expo)](https://expo.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?style=flat-square&logo=typescript)](https://typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

> **Backend repo:** [cipher-chat-server](https://github.com/vishalkirtaniya/cipher-chat-backend)

</div>

---

## Why I Built This

Most messaging apps today claim to be "secure" — but they store your messages in the cloud, control your keys, and can technically read everything you send. Even apps that advertise end-to-end encryption often keep metadata, backup plaintext to servers, or use proprietary closed-source implementations you can't verify.

I built CipherChat to answer a simple question: **what does a messaging app look like if you take "no server should ever see your messages" as an absolute, non-negotiable constraint from day one?**

The result is an app where:
- Your private keys are generated on your device and **never leave it**
- Messages are encrypted before they leave your phone and decrypted only on the recipient's device
- The server is a dumb router — it sees only ciphertext blobs it cannot read
- Every conversation is stored in a local SQLite database on your phone — not in any cloud

This is not a production replacement for Signal. It is a ground-up implementation of the core principles behind secure messaging, built to understand and demonstrate how these systems actually work.

---

## Table of Contents

- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Cryptography](#cryptography)
- [Tech Stack](#tech-stack)
- [Features](#features)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Connect to the Server](#connect-to-the-server)
  - [Run with Expo Go](#run-with-expo-go)
  - [Build the APK](#build-the-apk)
- [Future Roadmap](#future-roadmap)
- [Security Notes](#security-notes)

---

> **App Link:** [cipher-chat.apk](https://drive.google.com/file/d/1Rjmf2XIdt95SjxWswdvXqZL8CxVUTxWP/view?usp=drive_link)

---


## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                   CipherChat Mobile App                      │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   UI Layer                          │    │
│  │  OnboardingScreen  HomeScreen  ChatScreen           │    │
│  │  AddContactScreen  SettingsScreen                   │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │              Zustand Store (chatStore)               │    │
│  │  identity · contacts · conversations · messages     │    │
│  │  activeConversationId · typingUsers · connectionState│    │
│  └───────┬──────────────┬────────────────┬─────────────┘    │
│          │              │                │                   │
│  ┌───────▼──────┐ ┌─────▼──────┐ ┌──────▼──────────────┐   │
│  │  crypto.ts   │ │ storage.ts │ │    websocket.ts      │   │
│  │              │ │            │ │                      │   │
│  │ X25519 ECDH  │ │  SQLite    │ │  WS client           │   │
│  │ XSalsa20     │ │  Messages  │ │  Auto-reconnect      │   │
│  │ SecureStore  │ │  Contacts  │ │  Heartbeat ping      │   │
│  │ Key cache    │ │  Convs     │ │  Send queue          │   │
│  └──────────────┘ └────────────┘ └──────────────────────┘   │
│                                           │                  │
└───────────────────────────────────────────┼──────────────────┘
                                            │ WebSocket
                                            ▼
                              cipher-chat-server (EC2)
                              routes ciphertext only
```

**The core invariant:** The WebSocket connection to the server carries only `{ ciphertext, nonce, senderPublicKey }`. Plaintext never leaves the device.

---

## How It Works

### First Launch — Identity Creation

When you open the app for the first time, a random `userId` and an **X25519 keypair** are generated on your device using `tweetnacl`. The private key is stored in `expo-secure-store` (hardware-backed keychain on supported devices — iOS Secure Enclave, Android StrongBox/TEE). The public key is stored in `AsyncStorage` and is what you share with contacts.

### Adding a Contact — Key Exchange

Instead of a central directory, CipherChat uses a **contact card** system. Your contact card is a compact base64-encoded string containing your `userId`, `displayName`, and `publicKey`:

```
Your contact card (base64-encoded):
eyJ1IjoidV9hYmMxMjMiLCJuIjoiQWxpY2UiLCJrIjoibkprd2Rnak9Z...
         ↓ decodes to
{ "u": "u_abc123", "n": "Alice", "k": "nJkwdgjOYBf...", "v": 1 }
```

You share this code with the person you want to chat with. They paste it into the Add Contact screen. You do the same with their code. Both sides now have each other's public keys stored in their local SQLite `contacts` table.

### Sending a Message — Encryption Flow

```
1. Alice types "Hello Bob"
2. App fetches Bob's public key from local contacts table
3. ECDH: sharedSecret = nacl.box.before(bobPublicKey, alicePrivateKey)
   → cached in memory (Map) to avoid SecureStore reads per message
4. nonce = nacl.randomBytes(24)   ← fresh 24-byte random nonce per message
5. ciphertext = nacl.box.after(messageBytes, nonce, sharedSecret)
6. { ciphertext, nonce, senderPublicKey } sent to server over WebSocket
7. Server looks up Bob's socket and forwards the opaque blob
8. Bob's app: sharedSecret = nacl.box.before(alicePublicKey, bobPrivateKey)
9. plaintext = nacl.box.open.after(ciphertext, nonce, sharedSecret)
10. "Hello Bob" appears on Bob's screen
```

The server at step 7 sees only an opaque base64 blob. It cannot decrypt it. Even if the server is compromised, your messages are safe.

### Storage — Encrypted at Rest

Messages are stored in SQLite in their **encrypted form** (the ciphertext payload JSON). When you open a conversation, the app decrypts them on the fly using the shared secret. A `plaintextCache` column stores the decrypted text for UI performance, but the source of truth is always the encrypted blob — if the DB file is extracted from the device, it is unreadable without the private key.

**SQLite Schema:**
```sql
contacts      -- userId, displayName, publicKey, avatarColor, conversationId
conversations -- id, contactUserId, lastMessageBody, lastMessageAt, unreadCount
messages      -- id, conversationId, encryptedPayload (JSON), plaintextCache,
              --   status, timestamp, ttl, expiresAt, isDeleted
```

---

## Cryptography

| Concern | Algorithm | Why |
|---|---|---|
| Key exchange | X25519 (Curve25519 ECDH) | Fast, secure, simple API via `tweetnacl` |
| Symmetric encryption | XSalsa20-Poly1305 (`nacl.box`) | Authenticated encryption — tamper-proof |
| Nonce | 24-byte random per message | Prevents replay attacks |
| Private key storage | `expo-secure-store` | Hardware-backed on iOS (Secure Enclave) and Android (StrongBox/TEE) |
| Message storage | SQLite (ciphertext only) | Plaintext never written to disk |
| CSPRNG | `react-native-get-random-values` | Polyfills `crypto.getRandomValues` for React Native/Hermes |

**Why `tweetnacl` over AES-GCM?**
`tweetnacl` is a well-audited, minimal cryptography library with no native module dependencies. XSalsa20-Poly1305 provides equivalent security to AES-256-GCM and works identically across iOS and Android without any platform-specific code — which matters for a cross-platform React Native app.

**What this does NOT have (yet):**
- Forward secrecy (Double Ratchet) — compromising the private key exposes past messages
- Key verification (safety numbers) — contact cards must be verified out-of-band

---

## Tech Stack

| Package | Version | Purpose |
|---|---|---|
| `expo` | SDK 51 | Build toolchain, managed workflow |
| `react-native` | 0.74 | Cross-platform UI framework |
| `tweetnacl` | 1.0.3 | X25519 ECDH + XSalsa20-Poly1305 encryption |
| `tweetnacl-util` | 0.15.1 | Base64 encode/decode for key serialization |
| `react-native-get-random-values` | latest | CSPRNG polyfill for React Native/Hermes |
| `expo-secure-store` | 13.x | Hardware-backed private key storage |
| `expo-sqlite` | 14.x | Local message database |
| `expo-notifications` | 0.28.x | Local push notifications |
| `expo-clipboard` | 6.x | Contact card copy/share |
| `zustand` | 4.x | Lightweight global state management |
| `eventemitter3` | 5.x | WebSocket event routing |
| `@react-navigation/native-stack` | 6.x | Screen navigation |
| `@react-native-async-storage/async-storage` | 1.23.x | Identity persistence |

---

## Features

### Implemented
- **End-to-end encryption** — X25519 ECDH key exchange, XSalsa20-Poly1305 per-message encryption
- **Zero server storage** — server routes ciphertext only, never writes to disk
- **Local SQLite storage** — all messages stored on-device in encrypted form
- **Contact card system** — base64-encoded cards for decentralized key exchange
- **Message delivery receipts** — sent (○), server received (✓), delivered (✓✓), read (✓✓)
- **Disappearing messages** — per-message TTL: 30s, 5m, 1h, 24h, 7 days
- **Message delete** — delete for everyone, signals peer to delete locally
- **Typing indicators** — real-time, debounced, auto-expire after 4s
- **Smart notifications** — suppressed when the relevant chat screen is active
- **Offline message delivery** — messages queued on server, flushed on reconnect
- **Auto-reconnect** — exponential backoff WebSocket reconnection with send queue
- **Connection status badge** — live animated indicator (green/amber/red)
- **Dark theme** — system-wide dark UI optimized for OLED

---

## Project Structure

```
cipher-chat-app/
├── index.js                     # Entry point — polyfills MUST load first
├── App.tsx                      # Navigation root, auth gate, notification setup
├── app.json                     # Expo config
├── package.json
├── .env                         # EXPO_PUBLIC_SERVER_URL (not committed)
│
├── types/
│   └── index.ts                 # All TypeScript types — Message, Contact,
│                                #   Conversation, Identity, WireEvent, etc.
│
├── lib/
│   ├── crypto.ts                # Key generation, ECDH shared secret,
│   │                            #   encryptMessage, decryptMessage, generateId
│   ├── storage.ts               # SQLite schema + all DB operations
│   │                            #   (upsertContact, saveMessage, getMessages, etc.)
│   ├── websocket.ts             # WS client singleton, auto-reconnect,
│   │                            #   25s heartbeat, typed send helpers, send queue
│   └── identity.ts              # UserId + keypair lifecycle,
│                                #   contact card encode/decode, getConversationId
│
├── store/
│   └── chatStore.ts             # Zustand store — wires crypto + storage + WS
│                                #   handles all incoming WS events
│                                #   activeConversationId for notification gating
│
├── screens/
│   ├── OnboardingScreen.tsx     # First launch: display name → generate keypair
│   ├── HomeScreen.tsx           # Conversation list, unread badges, online dots
│   ├── ChatScreen.tsx           # Message thread, TTL picker, delete, typing
│   ├── AddContactScreen.tsx     # Base64 contact card — generate, copy, scan, add
│   └── SettingsScreen.tsx       # Identity info, public key, security details
│
└── components/
    └── ConnectionBadge.tsx      # Animated WS connection status indicator
```

---

## Getting Started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| npm | 9+ | Included with Node |
| Expo Go | SDK 51 | Install from App Store / Play Store |
| Java JDK | 17 | Only needed for APK builds |
| Android SDK | API 34 | Only needed for APK builds |

---

### Connect to the Server

This app requires the [cipher-chat-server](https://github.com/yourusername/cipher-chat-server) to be running. You can either:

**Option A — Run locally:**
```bash
git clone https://github.com/yourusername/cipher-chat-server.git
cd cipher-chat-server
npm install && npm start
```

**Option B — Use the deployed EC2 server:**
Already deployed at `ws://43.205.211.233:8080`

Create a `.env` file in the app root:
```bash
# Local server (iOS Simulator)
EXPO_PUBLIC_SERVER_URL=ws://localhost:8080

# Local server (Android Emulator)
EXPO_PUBLIC_SERVER_URL=ws://10.0.2.2:8080

# Local server (Physical device — use your machine's LAN IP)
EXPO_PUBLIC_SERVER_URL=ws://192.168.1.X:8080

# Production EC2
EXPO_PUBLIC_SERVER_URL=ws://43.205.211.233:8080
```

---

### Run with Expo Go

```bash
# Clone this repo
git clone https://github.com/vishalkirtaniya/cipher-chat-app.git
cd cipher-chat-app

# Install dependencies
npm install

# Start Metro bundler
npx expo start --clear
```

Scan the QR code with **Expo Go** (SDK 51) on your phone.

**Testing with two users:**

| Step | Device 1 (Alice) | Device 2 (Bob) |
|---|---|---|
| 1 | Open app → enter name → Create identity | Open app → enter name → Create identity |
| 2 | Tap ＋ → Copy your base64 code | — |
| 3 | Send code to Bob (WhatsApp, etc.) | — |
| 4 | — | Tap ＋ → Paste Alice's code → Add |
| 5 | — | Tap ＋ → Copy your base64 code → send to Alice |
| 6 | Tap ＋ → Paste Bob's code → Add | — |
| 7 | Both can now send E2E encrypted messages | ✓ |

---

### Build the APK

**Step 1 — Generate a signing keystore**

```bash
cd android/app

keytool -genkey -v \
  -keystore cipher-chat.keystore \
  -alias cipher-chat \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

**Step 2 — Add signing config to `android/app/build.gradle`**

Inside the `android { }` block:

```gradle
signingConfigs {
    release {
        storeFile file('cipher-chat.keystore')
        storePassword 'YOUR_KEYSTORE_PASSWORD'
        keyAlias 'cipher-chat'
        keyPassword 'YOUR_KEY_PASSWORD'
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
    }
}
```

**Step 3 — Prebuild native project**

```bash
npx expo prebuild --platform android --clean

# Fix required resource colors
mkdir -p android/app/src/main/res/values
cat > android/app/src/main/res/values/colors.xml << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="splashscreen_background">#0f0f14</color>
    <color name="iconBackground">#0f0f14</color>
    <color name="colorPrimary">#6366f1</color>
    <color name="colorPrimaryDark">#4f46e5</color>
    <color name="colorAccent">#6366f1</color>
</resources>
EOF
```

**Step 4 — Build**

```bash
cd android

# Debug APK (needs Metro running)
./gradlew assembleDebug

# Release APK (standalone, no Metro needed)
./gradlew assembleRelease
```

APK output:
```
android/app/build/outputs/apk/release/app-release.apk
```

Install via USB:
```bash
adb install android/app/build/outputs/apk/release/app-release.apk
```

Or send the APK to your phone via WhatsApp/Telegram/email and install directly (enable "Install from unknown sources" when prompted).

---

## Future Roadmap

### 🔐 Security Hardening
- **Double Ratchet Algorithm** — Signal-style forward secrecy. Currently a static keypair is used per user. The Double Ratchet rotates keys with every message so that compromising a key does not expose past messages.
- **Key fingerprint verification** — Display safety numbers (a human-readable fingerprint of the shared key) so users can verify out-of-band that they are talking to the right person and not a MITM.
- **Sealed sender** — Hide the sender's identity from the server. Currently the server knows `from` and `to`. Sealed sender encrypts the sender identity so even the server cannot see who is messaging whom.
- **Key rotation** — Scheduled rotation of identity keypairs with graceful handoff.
- **Encrypted backups** — User-controlled encrypted backup/restore for switching phones.

### 📞 Voice & Video Calls
- **Encrypted voice calls** — WebRTC P2P audio with SRTP encryption. The signaling server handles call setup (offer/answer/ICE candidates) but audio goes peer-to-peer, never through the server.
- **Encrypted video calls** — Same WebRTC stack extended to video with DTLS-SRTP transport security.
- **Call recording notification** — Alert both parties if recording is detected.

### 💬 Chat Features
- **Auto-delete chat** — Conversation-level timer that permanently wipes all messages after a set period regardless of individual message TTL.
- **Group chats** — Sender keys protocol (as used by Signal) for efficient group E2E encryption.
- **Message reactions** — Emoji reactions, encrypted and routed through the signaling channel.
- **Image/file sharing** — Per-file symmetric key generated on sender device. File encrypted locally, key sent via the encrypted message channel.
- **Message search** — Encrypted local index for full-text search without exposing plaintext.
- **QR code contact exchange** — Camera-based QR scanning as an alternative to copy-paste.

### 🏗 App Infrastructure
- **Multi-device support** — Device-specific keypairs linked to a primary identity key.
- **Push notifications via FCM/APNs** — True background delivery with end-to-end encrypted notification payloads.
- **iOS support** — Currently Android-focused. iOS build requires EAS and Apple Developer account.

---

## Security Notes & Known Limitations

> This project implements sound cryptographic primitives correctly but has not been independently audited for production use.

1. **No forward secrecy** — A compromised private key exposes all past messages. Addressed in roadmap by Double Ratchet.
2. **No key verification** — Contact cards must be verified out-of-band. No safety numbers screen yet.
3. **Social graph visible to server** — The server knows which userIds are communicating, though not the content.
4. **Offline queue is in-memory on server** — Queued messages are lost if the server restarts.
5. **Debug APK not hardened** — Enable ProGuard/R8, certificate pinning, and root detection for production.

---

## Contributing

Pull requests welcome. Please open an issue first for major changes.

```bash
# Type check
npx tsc --noEmit

# Lint
npx eslint . --ext .ts,.tsx
```

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

<div align="center">

Built with 🔒 by Vishal · Messages stay on your device, where they belong.

</div>