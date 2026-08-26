import { describe, it, expect } from 'vitest';
import { createFixtureClient } from '../fixture-client.js';

describe('fixture-client', () => {
  const assets = [
    {
      assetId: 'a1', repoPath: '/content/dam/x/a.jpg', repoName: 'a.jpg', dcFormat: 'image/jpeg',
    },
    {
      assetId: 'a2',
      repoPath: '/content/dam/x/b.jpg',
      repoName: 'b.jpg',
      assetMetadata: { company: 'x', 'dc:title': 'B' },
    },
  ];

  it('returns all assets from a search', async () => {
    const client = createFixtureClient(assets);
    const res = await client.request('search', { method: 'POST', path: '/assets/search' });
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.items[0].repositoryMetadata['repo:path']).toBe('/content/dam/x/a.jpg');
  });

  it('returns per-asset metadata with an ETag', async () => {
    const client = createFixtureClient(assets);
    const res = await client.request('metadata', { method: 'GET', path: '/assets/a2/metadata' });
    expect(res.headers.get('ETag')).toBe('"fixture"');
    const body = await res.json();
    expect(body.assetMetadata['dc:title']).toBe('B');
  });

  it('404s renditions so the pipeline skips model input offline', async () => {
    const client = createFixtureClient(assets);
    const res = await client.request('rendition', { method: 'GET', path: '/assets/a1/renditions/thumbnail/as/x' });
    expect(res.status).toBe(404);
  });
});
