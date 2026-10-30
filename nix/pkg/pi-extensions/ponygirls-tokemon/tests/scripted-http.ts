/**
 * Hand-written Http fake with a routing table (tokemon's ScriptedTransport).
 */
import assert from "node:assert/strict";
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

/** A theme stand-in tagging colours as `<token>…</token>`. */
export const TAG_THEME = {
  appearance: "dark" as const,
  fg: (color: string, text: string): string => `<${color}>${text}</${color}>`,
  bold: (text: string): string => `<b>${text}</b>`,
};

/** The first line a border widget factory renders with TAG_THEME. */
export function renderBorderWidget(content: unknown): string {
  assert.equal(typeof content, "function", "border widgets are component factories");
  const component = (content as (tui: unknown, theme: typeof TAG_THEME) => { render(width: number): string[] })(undefined, TAG_THEME);
  const lines = component.render(200);
  assert.equal(lines.length, 1);
  return lines[0]!;
}

export const untag = (s: string): string => s.replace(/<\/?[a-z]+>/g, "");
