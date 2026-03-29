/**
 * CipherChat WebSocket Client
 * Auto-reconnect, heartbeat, typed events, send queue
 */

import { EventEmitter } from "eventemitter3";
import type { EncryptedPayload } from "../types";

export type ConnectionState = "disconnected" | "connecting" | "connected";

const PING_INTERVAL_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

class ChatWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private userId: string | null = null;
  private publicKey: string | null = null;
  private serverUrl: string;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private shouldReconnect = true;
  private sendQueue: string[] = [];
  public connectionState: ConnectionState = "disconnected";
  private stateListeners: Array<(s: ConnectionState) => void> = [];

  constructor(serverUrl: string) {
    super();
    this.serverUrl = serverUrl;
    console.log("[WS] Initialized with URL:", serverUrl);
  }

  connect(userId: string, publicKey: string): void {
    console.log("[WS] connect() called with:", userId, publicKey);

    this.userId = userId;
    this.publicKey = publicKey;
    this.shouldReconnect = true;
    this._connect();
  }

  disconnect(): void {
    console.log("[WS] disconnect() called");

    this.shouldReconnect = false;
    this._stopPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this._setState("disconnected");
  }

  // ─── Send helpers ─────────────────────────────────────────────────────────────

  sendMessage(params: {
    to: string;
    from: string;
    messageId: string;
    payload: EncryptedPayload;
    timestamp: number;
    ttl?: number;
  }): void {
    this._send({ type: "message", ...params });
  }

  sendMessageRequest(params: any): void {
    this._send({ type: "message_request", ...params, timestamp: Date.now() });
  }

  acceptRequest(params: any): void {
    this._send({ type: "request_accepted", ...params, timestamp: Date.now() });
  }

  declineRequest(to: string, requestId: string): void {
    this._send({ type: "request_declined", to, from: this.userId, requestId });
  }

  sendReceipt(
    to: string,
    messageIds: string[],
    status: "delivered" | "read",
  ): void {
    this._send({ type: "receipt", to, messageIds, status });
  }

  sendDeleteSignal(to: string, messageIds: string[]): void {
    this._send({ type: "delete_message", to, messageIds });
  }

  sendTyping(to: string, isTyping: boolean): void {
    this._send({ type: "typing", to, isTyping });
  }

  requestPublicKey(targetUserId: string): void {
    this._send({ type: "get_public_key", targetUserId });
  }

  checkOnline(userId: string): void {
    this._send({ type: "check_online", userId });
  }

  onStateChange(listener: (s: ConnectionState) => void): () => void {
    this.stateListeners.push(listener);
    return () => {
      this.stateListeners = this.stateListeners.filter((l) => l !== listener);
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private _connect(): void {
    console.log("[WS] Connecting to:", this.serverUrl);

    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    )
      return;

    this._setState("connecting");

    try {
      this.ws = new WebSocket(this.serverUrl);
    } catch (err) {
      console.log("[WS] Connection failed:", err);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log("[WS] Connected ✅");

      this.reconnectAttempts = 0;

      const payload = {
        type: "register",
        userId: this.userId,
        publicKey: this.publicKey,
      };

      console.log("[WS] Sending register:", payload);

      this.ws!.send(JSON.stringify(payload));
    };

    this.ws.onmessage = (event) => {
      console.log("[WS] Raw message:", event.data);

      try {
        const msg = JSON.parse(event.data);
        console.log("[WS] Parsed message:", msg);

        this._handleServerEvent(msg);
      } catch {
        console.warn("[WS] Failed to parse server message");
      }
    };

    this.ws.onclose = (event) => {
      console.log("[WS] Closed:", event.code, event.reason);

      this._stopPing();
      this._setState("disconnected");

      if (this.shouldReconnect && event.code !== 1000)
        this._scheduleReconnect();
    };

    this.ws.onerror = (e) => {
      console.log("[WS] Error:", e);
    };
  }

  private _handleServerEvent(msg: any): void {
    console.log("[WS] Handling event:", msg);

    if (msg.type === "registered") {
      console.log("[WS] Registered with server ✅");

      this._setState("connected");
      this._startPing();
      this._drainQueue();
    }

    this.emit(msg.type, msg);
  }

  private _send(data: object): void {
    const json = JSON.stringify(data);

    console.log("[WS] Sending:", json);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(json);
    } else {
      console.log("[WS] Queued message (socket not open)");
      if (this.sendQueue.length < 200) this.sendQueue.push(json);
    }
  }

  private _drainQueue(): void {
    console.log("[WS] Draining queue:", this.sendQueue.length);

    while (
      this.sendQueue.length > 0 &&
      this.ws?.readyState === WebSocket.OPEN
    ) {
      this.ws.send(this.sendQueue.shift()!);
    }
  }

  private _startPing(): void {
    console.log("[WS] Starting ping");

    this._stopPing();

    this.pingTimer = setInterval(
      () => this._send({ type: "ping" }),
      PING_INTERVAL_MS,
    );
  }

  private _stopPing(): void {
    if (this.pingTimer) {
      console.log("[WS] Stopping ping");
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private _scheduleReconnect(): void {
    if (!this.shouldReconnect) return;

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS,
    );

    console.log("[WS] Reconnecting in:", delay, "ms");

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  private _setState(state: ConnectionState): void {
    if (this.connectionState === state) return;

    console.log("[WS] State:", state);

    this.connectionState = state;
    this.stateListeners.forEach((l) => l(state));
  }
}

// 🔥 ENV DEBUG
console.log("SERVER URL ENV:", process.env.EXPO_PUBLIC_SERVER_URL);

export const wsClient = new ChatWebSocket(
  process.env.EXPO_PUBLIC_SERVER_URL || "ws://43.205.211.233:8080",
);
