import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export interface ModelEndpoint { endpoint: string; model: string; revision: string; credentialFile: string }
export interface ModelConfiguration { annotation: ModelEndpoint; embedding: ModelEndpoint & { dimensions: number; sendDimensions: boolean; queryPrefix: string; documentPrefix: string } }
export async function configuration(): Promise<ModelConfiguration> {
  const path = process.env.CHRONICLE_CUDA_MODELS;
  assert.ok(path !== undefined, 'CHRONICLE_CUDA_MODELS must name a synthetic local model configuration');
  const result: ModelConfiguration = JSON.parse(await readFile(path, 'utf8'));
  for (const endpoint of [result.annotation, result.embedding]) {
    assert.match(endpoint.revision, /^[0-9a-f]{40}$/, 'immutable HF revision required');
    const url = new URL(endpoint.endpoint);
    assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.username, ''); assert.equal(url.password, '');
    assert.ok(endpoint.model.length > 0 && endpoint.credentialFile.length > 0);
  }
  assert.equal(result.embedding.dimensions, 2048);
  assert.equal(result.embedding.sendDimensions, false, 'natural 2048D output: do not request unsupported truncation');
  assert.equal(result.embedding.queryPrefix, 'query: ');
  assert.equal(result.embedding.documentPrefix, 'passage: ');
  return result;
}
export async function modelPost(endpoint: ModelEndpoint, payload: unknown): Promise<unknown> {
  const credential = (await readFile(endpoint.credentialFile, 'utf8')).trim();
  assert.ok(credential.length > 0);
  const response = await fetch(endpoint.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(120_000) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
export function cosine(a: number[], b: number[]): number {
  assert.equal(a.length, b.length);
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  const norm = (v: number[]) => Math.sqrt(v.reduce((sum, value) => sum + value * value, 0));
  return dot / (norm(a) * norm(b));
}
