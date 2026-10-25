import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { topics, unrelatedQuery } from './fixtures.ts';
import { configuration, modelPost, cosine } from './support.ts';

// Behavioral-Active Blackbox Good-Communication, specified: opt-in local real CUDA models.
test('real Nemotron embeddings: auth, batch indices, 2048D finite vectors, prefixes, repeatability and labeled controls', { skip: process.env.CHRONICLE_CUDA !== '1', timeout: 240_000 }, async () => {
  const { embedding } = await configuration();
  for (const endpoint of [embedding]) {
    for (const authorization of ['', 'Bearer deliberately-invalid-synthetic-key']) {
      const response = await fetch(endpoint.endpoint, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 401, 'real serving API must require its credential');
      await response.body?.cancel();
    }
  }
  const timings: { batch: number; milliseconds: number }[] = [];
  async function embed(input: string[]): Promise<number[][]> {
    const started = performance.now();
    const result = await modelPost(embedding, { model: embedding.model, input, encoding_format: 'float' }) as { data: { index: number; embedding: number[] }[] };
    timings.push({ batch: input.length, milliseconds: performance.now() - started });
    assert.equal(result.data.length, input.length);
    assert.deepEqual(result.data.map(row => row.index).sort((a, b) => a - b), input.map((_, index) => index));
    return result.data.sort((a, b) => a.index - b.index).map(row => {
      assert.equal(row.embedding.length, embedding.dimensions);
      assert.ok(row.embedding.every(Number.isFinite));
      assert.ok(row.embedding.some(value => value !== 0));
      return row.embedding;
    });
  }
  const documents = await embed(topics.map(topic => embedding.documentPrefix + topic.document));
  const queries = await embed(topics.map(topic => embedding.queryPrefix + topic.query));
  const repeated = await embed([embedding.queryPrefix + topics[0].query]);
  const reordered = await embed([embedding.queryPrefix + topics[1].query, embedding.queryPrefix + topics[0].query]);
  const repeatCosine = cosine(queries[0], repeated[0]);
  assert.ok(repeatCosine > 0.9999, `repeat cosine ${repeatCosine}`);
  assert.ok(cosine(queries[0], reordered[1]) > 0.9999 && cosine(queries[1], reordered[0]) > 0.9999, 'batch index/order correspondence');
  const scores = queries.map(query => documents.map(document => cosine(query, document)));
  const predictions = scores.map(row => row.indexOf(Math.max(...row)));
  assert.deepEqual(predictions, topics.map((_, index) => index), 'every labeled paraphrase must retrieve its own topic at rank 1');
  const matched = scores.map((row, index) => row[index]);
  const mismatched = scores.map((row, index) => row[(index + 1) % row.length]);
  assert.ok(matched.every((score, index) => score > mismatched[index] + 0.1), 'cyclically mismatched vectors must lose by >=0.1 cosine');
  const unrelated = (await embed([embedding.queryPrefix + unrelatedQuery]))[0];
  const unrelatedScores = documents.map(document => cosine(unrelated, document));
  assert.ok(Math.max(...unrelatedScores) < Math.min(...matched), 'unrelated query must score below every labeled positive');
  console.log(JSON.stringify({ embedding: { model: embedding.model, revision: embedding.revision }, dimensions: embedding.dimensions, recallAt1: predictions.length / topics.length, repeatCosine, matched, mismatched, unrelatedScores, timings, note: 'Single synthetic smoke run; observed latency includes HTTP and warmup, not a throughput benchmark.' }));
});
