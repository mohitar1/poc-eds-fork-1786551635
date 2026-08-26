import { describe, it, expect } from 'vitest';
import { buildScanQuery, isUnderFolder, enumerateFolder } from '../enumerate.js';
import { makeRes, makeClient } from './helpers.js';

const hit = (assetId, repoPath, extra = {}) => ({
  assetId,
  repositoryMetadata: { 'repo:path': repoPath, 'repo:name': repoPath.split('/').pop(), ...extra },
});

describe('enumerate', () => {
  describe('buildScanQuery', () => {
    it('builds a match-all FULLTEXT scan (no server-side path scoping)', () => {
      const body = buildScanQuery(50);
      expect(body.query).toEqual([{ match: { text: '*', mode: 'FULLTEXT' } }]);
      expect(body.limit).toBe(50);
      expect(body.cursor).toBeUndefined();
    });
    it('includes the cursor when provided', () => {
      expect(buildScanQuery(10, 'CUR').cursor).toBe('CUR');
    });
  });

  describe('isUnderFolder', () => {
    it('matches descendants of the folder', () => {
      expect(isUnderFolder('/content/dam/acme/a.jpg', '/content/dam/acme')).toBe(true);
      expect(isUnderFolder('/content/dam/acme/sub/b.jpg', '/content/dam/acme')).toBe(true);
    });
    it('rejects the folder node itself and sibling prefixes', () => {
      expect(isUnderFolder('/content/dam/acme', '/content/dam/acme')).toBe(false);
      expect(isUnderFolder('/content/dam/acmecorp/x.jpg', '/content/dam/acme')).toBe(false);
      expect(isUnderFolder(null, '/content/dam/acme')).toBe(false);
    });
    it('tolerates a trailing slash on the folder', () => {
      expect(isUnderFolder('/content/dam/acme/a.jpg', '/content/dam/acme/')).toBe(true);
    });
  });

  describe('enumerateFolder', () => {
    it('scans all pages and returns only assets under the folder prefix', async () => {
      const page1 = makeRes({
        body: {
          hits: {
            results: [
              hit('a1', '/content/dam/acme/a.jpg'),
              hit('x1', '/content/dam/frescopa/other.jpg'),
            ],
          },
          cursor: 'NEXT',
        },
      });
      const page2 = makeRes({
        body: {
          hits: {
            results: [
              hit('a2', '/content/dam/acme/sub/b.jpg'),
              hit('x2', '/content/dam/_CSS/icon.png'),
            ],
          },
          cursor: null,
        },
      });
      const client = makeClient([page1, page2]);
      const out = await enumerateFolder({ client, folderPath: '/content/dam/acme' });
      expect(out.assets.map((a) => a.assetId)).toEqual(['a1', 'a2']);
      expect(out.scanned).toBe(4);
      expect(out.matched).toBe(2);
      expect(out.exceededWindow).toBe(false);
    });

    it('dedupes assets seen across pages', async () => {
      const page1 = makeRes({
        body: { hits: { results: [hit('a1', '/content/dam/acme/a.jpg')] }, cursor: 'NEXT' },
      });
      const page2 = makeRes({
        body: { hits: { results: [hit('a1', '/content/dam/acme/a.jpg')] }, cursor: null },
      });
      const client = makeClient([page1, page2]);
      const out = await enumerateFolder({ client, folderPath: '/content/dam/acme' });
      expect(out.assets).toHaveLength(1);
    });

    it('stops and flags exceededWindow when the scan cap is reached', async () => {
      const page = makeRes({
        body: { hits: { results: [hit('x1', '/content/dam/other/1.jpg')] }, cursor: 'MORE' },
      });
      // Always return a page that has a cursor; only the cap can break the loop.
      const client = { request: async () => page };
      const out = await enumerateFolder({
        client, folderPath: '/content/dam/acme', limit: 1, scanCap: 3,
      });
      expect(out.exceededWindow).toBe(true);
      expect(out.matched).toBe(0);
      expect(out.scanned).toBeGreaterThanOrEqual(3);
    });

    it('parses the real AEM search shape { hits: { results } } and repo:name', async () => {
      const page = makeRes({
        body: {
          hits: {
            results: [
              hit('urn:aaid:aem:1', '/content/dam/acme/hero.jpg', { 'dc:format': 'image/jpeg' }),
            ],
          },
          cursor: null,
        },
      });
      const client = makeClient([page]);
      const out = await enumerateFolder({ client, folderPath: '/content/dam/acme' });
      expect(out.assets[0]).toMatchObject({
        assetId: 'urn:aaid:aem:1',
        repoPath: '/content/dam/acme/hero.jpg',
        repoName: 'hero.jpg',
      });
    });

    it('throws a rich error (status/body/headers) on a non-ok response', async () => {
      const page = makeRes({ status: 403, body: 'IMS Client ID not allowlisted' });
      const client = makeClient([page]);
      await expect(enumerateFolder({ client, folderPath: '/content/dam/acme' }))
        .rejects.toMatchObject({ status: 403 });
    });
  });
});
