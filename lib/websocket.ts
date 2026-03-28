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
  }

  connect(userId: string, publicKey: string): void {
    this.userId = userId;
    this.publicKey = publicKey;
    this.shouldReconnect = true;
    this._connect();
  }

  disconnect(): void {
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

  /** Send a message request — plaintext intro, no encryption yet */
  sendMessageRequest(params: {
    to: string;
    from: string;
    fromDisplayName: string;
    fromPublicKey: string;
    requestId: string;
    previewText: string;
  }): void {
    this._send({ type: "message_request", ...params, timestamp: Date.now() });
  }

  /** Accept a request — send back our public key so both sides can encrypt */
  acceptRequest(params: {
    to: string;
    from: string;
    fromDisplayName: string;
    fromPublicKey: string;
    requestId: string;
  }): void {
    this._send({ type: "request_accepted", ...params, timestamp: Date.now() });
  }

  /** Decline a request */
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
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    )
      return;
    this._setState("connecting");
    try {
      this.ws = new WebSocket(this.serverUrl);
    } catch {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.ws!.send(
        JSON.stringify({
          type: "register",
          userId: this.userId,
          publicKey: this.publicKey,
        }),
      );
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this._handleServerEvent(msg);
      } catch {
        console.warn("[ws] Failed to parse server message");
      }
    };

    this.ws.onclose = (event) => {
      this._stopPing();
      this._setState("disconnected");
      if (this.shouldReconnect && event.code !== 1000)
        this._scheduleReconnect();
    };

    this.ws.onerror = () => {};
  }

  private _handleServerEvent(msg: any): void {
    if (msg.type === "registered") {
      this._setState("connected");
      this._startPing();
      this._drainQueue();
    }
    this.emit(msg.type, msg);
  }

  private _send(data: object): void {
    const json = JSON.stringify(data);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(json);
    } else {
      if (this.sendQueue.length < 200) this.sendQueue.push(json);
    }
  }

  private _drainQueue(): void {
    while (
      this.sendQueue.length > 0 &&
      this.ws?.readyState === WebSocket.OPEN
    ) {
      this.ws.send(this.sendQueue.shift()!);
    }
  }

  private _startPing(): void {
    this._stopPing();
    this.pingTimer = setInterval(
      () => this._send({ type: "ping" }),
      PING_INTERVAL_MS,
    );
  }

  private _stopPing(): void {
    if (this.pingTimer) {
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
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  private _setState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.stateListeners.forEach((l) => l(state));
  }
}

console.log("SERVER URL:", process.env.EXPO_PUBLIC_SERVER_URL);

export const wsClient = new ChatWebSocket(
  process.env.EXPO_PUBLIC_SERVER_URL || "ws://43.205.211.233:8080",
);


