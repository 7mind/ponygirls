/**
 * Hand-written Http fake with a routing table (tokemon's ScriptedTransport).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TransportError, type Http, type HttpMethod, type HttpResponse } from "../src/http.ts";
import type { Credential } from "../src/quota.ts";

export type Route = HttpResponse | Error;

export class ScriptedHttp implements Http {
  readonly calls: Array<[HttpMethod, string]> = [];
  readonly headers: Array<Record<string, string>> = [];
  readonly bodies: Array<string | null> = [];
  private readonly routes: Map<string, Route>;

  constructor(routes: Array<[HttpMethod, string, Route]>) {
    this.routes = new Map(routes.map(([method, url, route]) => [`${method} ${url}`, route]));
  }

  async request(method: HttpMethod, url: string, headers: Record<string, string>, body: string | null): Promise<HttpResponse> {
    this.calls.push([method, url]);
    this.headers.push({ ...headers });
    this.bodies.push(body);
    const route = this.routes.get(`${method} ${url}`);
    if (route === undefined) throw new TransportError(`no scripted route for ${method} ${url}`);
    if (route instanceof Error) throw route;
    return route;
  }
}

export function json(status: number, payload: unknown, retryAfter: string | null = null): HttpResponse {
  return { status, body: JSON.stringify(payload), retryAfter };
}

/** A sanitized response from tokemon's fixtures (copied into tests/fixtures). */
export function fixture(name: string): Record<string, any> {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")) as Record<string, any>;
}

export const API_KEY: Credential = { kind: "api_key", secret: "test-key", refreshToken: null, accountId: null };
export const OAUTH: Credential = { kind: "oauth", secret: "test-access", refreshToken: "test-refresh", accountId: null };
export const META_OAUTH: Credential = { kind: "oauth", secret: "test-access", refreshToken: "dca:test-identity", accountId: null };

export const at = (seconds: number): string => new Date(seconds * 1000).toISOString();
