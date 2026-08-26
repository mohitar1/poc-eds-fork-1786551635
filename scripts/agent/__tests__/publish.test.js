import { describe, it, expect } from 'vitest';
import { chunk, publishAssets } from '../publish.js';
import { makeRes, makeClient } from './helpers.js';

describe('publish', () => {
  describe('chunk', () => {
    it('splits into fixed-size groups', () => {
      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });
    it('returns [] for empty input', () => {
      expect(chunk([], 10)).toEqual([]);
    });
  });

  describe('publishAssets', () => {
    it('batches at most 10 URNs per request', async () => {
      const urns = Array.from({ length: 23 }, (_, i) => `urn:${i}`);
      const responses = [
        makeRes({ status: 200 }), makeRes({ status: 200 }), makeRes({ status: 200 }),
      ];
      const client = makeClient(responses);
      const out = await publishAssets(client, urns, { target: 'AEM_PUBLISH' });
      expect(client.calls).toHaveLength(3);
      const sizes = client.calls.map((c) => JSON.parse(c.opts.body).assets.length);
      expect(sizes).toEqual([10, 10, 3]);
      expect(out.published).toBe(23);
    });

    it('polls an async publish job on 202', async () => {
      const accepted = makeRes({ status: 202, headers: { Location: '/adobe/assets/jobs/job-1/status' } });
      const done = makeRes({ status: 200, body: { status: 'COMPLETED' } });
      const client = makeClient([accepted, done]);
      const out = await publishAssets(client, ['urn:1'], { sleepFn: async () => {} });
      expect(out.published).toBe(1);
      expect(client.calls[1].opts.path).toContain('/assets/jobs/job-1/status');
    });
  });
});
