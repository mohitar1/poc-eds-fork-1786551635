import { describe, it, expect } from 'vitest';
import { writeAssetViaPatch, patchAssetMetadata } from '../write-patch.js';
import { makeRes, makeClient } from './helpers.js';

describe('write-patch', () => {
  it('sends If-Match and the json-patch content type', async () => {
    const client = makeClient([makeRes({ status: 200 })]);
    await patchAssetMetadata(client, 'a1', [{ op: 'add', path: '/dc:title', value: 'T' }], '"v1"');
    const { opts } = client.calls[0];
    expect(opts.method).toBe('PATCH');
    expect(opts.headers['If-Match']).toBe('"v1"');
    expect(opts.headers['Content-Type']).toBe('application/json-patch+json');
  });

  it('recovers from a 412 by re-reading the ETag and retrying', async () => {
    const responses = [
      makeRes({ status: 412 }), // first PATCH: stale ETag
      makeRes({ body: { assetMetadata: {}, repositoryMetadata: {} }, headers: { ETag: '"v2"' } }), // re-GET
      makeRes({ status: 200 }), // retry PATCH ok
    ];
    const client = makeClient(responses);
    const res = await writeAssetViaPatch({
      client, assetId: 'a1', patchOps: [{ op: 'add', path: '/x', value: 1 }], etag: '"v1"',
    });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
  });

  it('reports a hard failure without retrying on a 400', async () => {
    const client = makeClient([makeRes({ status: 400, body: 'bad patch' })]);
    const res = await writeAssetViaPatch({
      client, assetId: 'a1', patchOps: [], etag: '"v1"',
    });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
  });
});
