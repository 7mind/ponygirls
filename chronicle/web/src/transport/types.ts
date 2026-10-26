export type SocketState = 'NEW' | 'ALIVE' | 'STALE' | 'DEAD';
export type StopReason = 'stopped' | 'unauthorized' | 'update-required' | 'protocol-error';
export type LifecycleEvent = 'visible' | 'hidden' | 'online' | 'offline' | 'network-change' | 'freeze' | 'resume' | 'pagehide' | 'pageshow';
export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
}
export interface Lifecycle {
  hidden(): boolean;
  subscribe(callback: (event: LifecycleEvent) => void): () => void;
}
export interface Socket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: ((code: number, reason: string) => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code: number, reason: string): void;
}
export type Inbound<Result> =
  | { kind: 'negotiated' }
  | { kind: 'pong'; nonce: string; at: number }
  | { kind: 'ping'; id: string; nonce: string; at: number }
  | { kind: 'reply'; id: string; result: Result }
  | { kind: 'failure'; id: string; code: string; message: string; invalidates: boolean }
  | { kind: 'stop'; reason: StopReason; message: string };
export interface Protocol<Operation, Result> {
  hello(): string;
  ping(nonce: string, at: number): string;
  pong(id: string, nonce: string, at: number): string;
  request(id: string, operation: Operation): string;
  decode(data: string): Inbound<Result>;
}
export interface ConnectionConfig {
  connectTimeout: number;
  pongTimeout: number;
  heartbeatInterval: number;
  staleGrace: number;
  requestTimeout: number;
  retryBase: number;
  retryCap: number;
  maxAttempts: number;
  maxPool: number;
  tickInterval: number;
  pauseThreshold: number;
  eventLimit: number;
}
export const connectionConfig: ConnectionConfig = {
  connectTimeout: 8_000, pongTimeout: 5_000, heartbeatInterval: 15_000,
  staleGrace: 10_000, requestTimeout: 20_000, retryBase: 1_000,
  retryCap: 30_000, maxAttempts: 8, maxPool: 3, tickInterval: 1_000,
  pauseThreshold: 2_000, eventLimit: 100,
};
export interface SocketStats {
  id: number; state: SocketState; active: boolean; createdAt: number;
  deadline: number; deadlineStartedAt: number; pendingPings: number;
}
export interface RttSample { at: number; ms: number }
export interface TransportEvent { at: number; message: string }
export interface ManagerStats {
  sockets: readonly SocketStats[];
  activeId: number | null;
  attempts: number;
  maxAttempts: number;
  retryAt: number | null;
  retryStartedAt: number | null;
  deferred: boolean;
  frozen: boolean;
  terminal: StopReason | null;
  lastClose: { code: number; reason: string } | null;
  sentPings: number;
  lostPings: number;
  rtt: readonly RttSample[];
  events: readonly TransportEvent[];
  generation: number;
}
export interface Dependencies<Operation, Result> {
  scheduler: Scheduler;
  lifecycle: Lifecycle;
  socket: () => Socket;
  random: () => number;
  nonce: () => string;
  protocol: () => Protocol<Operation, Result>;
  config: ConnectionConfig;
}
export type RequestOptions = { mutation: boolean; receiptId: string | null } | { mutation: false; receiptId: null; delivery: 'once' };
export class RequestFailure extends Error {
  readonly outcome: 'failed' | 'uncertain';
  readonly receiptId: string | null;
  readonly code: string;
  constructor(message: string, code: string, outcome: 'failed' | 'uncertain', receiptId: string | null) {
    super(message); this.name = 'RequestFailure'; this.code = code;
    this.outcome = outcome; this.receiptId = receiptId;
  }
}
