import type { IncomingMessage, Server } from "node:http";
import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import type { ResolvedAuth } from "../auth/config.js";
import { cookieName, parseSessionCookie } from "./cookies.js";
import type { Principal } from "../domain/document.js";

const HEARTBEAT_MS = 30_000;
const MAX_FRAME_BYTES = 1024;
const MAX_BUFFER_BYTES = 64 * 1024;
const MAX_CONNECTIONS_PER_TOKEN = 8;

interface Session {
  token: string;
  principal: Principal;
  nonce: Buffer;
  previous: Buffer | null;
  pending: boolean;
}

export class LiveUpdates {
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor(private readonly getAuth: () => ResolvedAuth) {
    this.heartbeat = setInterval(() => this.checkPeers(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  attach(server: Server): void {
    server.on("upgrade", (req, socket, head) => {
      const auth = this.getAuth();
      const host = (req.headers.host ?? "").split(":")[0]!.toLowerCase();
      if (this.destroyed || req.url !== "/api/v1/live" ||
          !auth.config.allowedHosts.some((h) => h.toLowerCase() === host) ||
          typeof req.headers.origin !== "string" || !auth.config.allowedOrigins.includes(req.headers.origin)) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      const token = this.cookie(req);
      const principal = token === null || req.headers.authorization !== undefined ? null : auth.authenticate(token);
      this.sockets.handleUpgrade(req, socket, head, (ws) => {
        ws.on("error", () => ws.terminate());
        if (token === null || principal === null) { ws.close(4401, "Sign in required"); return; }
        const count = [...this.sessions.values()].filter((s) => s.token === token).length;
        if (count >= MAX_CONNECTIONS_PER_TOKEN) { ws.close(1013, "Too many live connections"); return; }
        const session: Session = { token, principal, nonce: randomBytes(8), previous: null, pending: false };
        this.sessions.set(ws, session);
        ws.on("close", () => this.sessions.delete(ws));
        ws.on("pong", (data) => {
          if (data.equals(session.nonce) || (session.previous !== null && data.equals(session.previous))) session.pending = false;
        });
        ws.on("message", (data, binary) => {
          if (!this.authorized(ws, session)) return;
          if (binary) { ws.close(1003, "Text frames required"); return; }
          let message: unknown;
          try { message = JSON.parse(data.toString()); }
          catch { ws.close(1007, "Invalid JSON"); return; }
          if (typeof message !== "object" || message === null) { ws.close(1007, "Invalid heartbeat"); return; }
          const ping = message as { type?: unknown; nonce?: unknown; clientTs?: unknown };
          if (ping.type !== "ping" || typeof ping.nonce !== "string" || ping.nonce.length < 1 || ping.nonce.length > 64 ||
              typeof ping.clientTs !== "number" || !Number.isFinite(ping.clientTs)) {
            ws.close(1007, "Invalid heartbeat"); return;
          }
          this.send(ws, JSON.stringify({ type: "pong", nonce: ping.nonce, clientTs: ping.clientTs, serverTs: Date.now() }));
        });
      });
    });
    server.on("close", () => this.close());
  }

  private cookie(req: IncomingMessage): string | null {
    return parseSessionCookie(req.headers.cookie, cookieName(this.getAuth().config.cookieSecure));
  }

  endSession(cookieHeader: string | undefined): void {
    const token = parseSessionCookie(cookieHeader, cookieName(this.getAuth().config.cookieSecure));
    if (token === null) return;
    for (const [ws, session] of this.sessions) if (session.token === token) ws.close(4401, "Session changed; sign in again");
  }

  changed(key: string, revision: number): void {
    if (this.destroyed) return;
    const frame = JSON.stringify({ type: "changed", key, revision });
    for (const [ws, session] of this.sessions) if (this.authorized(ws, session)) this.send(ws, frame);
  }

  private authorized(ws: WebSocket, session: Session): boolean {
    const principal = this.getAuth().authenticate(session.token);
    if (principal !== null && principal.userId === session.principal.userId && principal.tokenId === session.principal.tokenId &&
        principal.type === session.principal.type) return true;
    ws.close(4401, "Session revoked; sign in again");
    return false;
  }

  private send(ws: WebSocket, frame: string): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFER_BYTES) { ws.terminate(); return; }
    ws.send(frame);
  }

  private checkPeers(): void {
    const candidates: Array<[WebSocket, Session]> = [];
    for (const [ws, session] of this.sessions) {
      if (!this.authorized(ws, session) || ws.readyState !== WebSocket.OPEN) continue;
      if (session.pending) candidates.push([ws, session]);
      session.previous = session.nonce;
      session.nonce = randomBytes(8);
      session.pending = true;
      ws.ping(session.nonce);
    }
    // Buffered pongs must reach the I/O phase before a stalled peer is reaped.
    setImmediate(() => {
      if (this.destroyed) return;
      for (const [ws, session] of candidates) if (session.pending) ws.terminate();
    });
  }

  close(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.heartbeat);
    for (const ws of this.sockets.clients) ws.terminate();
    this.sessions.clear();
    this.sockets.close();
  }
}
