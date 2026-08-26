import { describe, it, expect } from 'vitest';
import { enrichAssetsClassic, fieldsToProperties } from '../enrich-classic.js';

const silent = { info: () => {}, warn: () => {} };

const generator = async () => ({
  title: 'Doc A', description: 'desc', keywords: ['x', 'y', 'z'], productCategory: 'cards',
});

function baseOptions(overrides = {}) {
  return {
    customerKey: 'acme',
    damPath: '/content/dam/acme',
    dryRun: false,
    force: false,
    noPublish: true,
    concurrency: 1,
    limit: null,
    ...overrides,
  };
}

/**
 * Fake ClassicAuthorClient. `meta` maps repoPath -> metadata props; enumerate returns the
 * given assets. Records writes/publishes.
 */
function fakeClient({ assets = [], meta = {}, folderExists = true } = {}) {
  const writes = [];
  const publishes = [];
  const uploads = [];
  const foldersCreated = [];
  const live = [...assets];
  const listPrefix = '/api/assets/acme.json';
  return {
    writes,
    publishes,
    uploads,
    foldersCreated,
    async getJson(path) {
      if (path.startsWith(listPrefix)) {
        // The bring-in folder-ensure probe (limit=1) returns null when the folder is
        // absent; the enumerate listing (limit=50) always returns the current entities.
        if (path.includes('limit=1') && !folderExists && live.length === 0) return null;
        return {
          entities: live.map((a) => ({
            class: ['assets/asset'],
            properties: { name: a.name, metadata: a.halMetadata || {} },
          })),
        };
      }
      const m = path.match(/^(.*)\/jcr:content\/metadata\.json$/);
      if (m) return meta[m[1]] || {};
      return null;
    },
    async postForm(path, params) {
      if (path === '/bin/replicate.json') {
        publishes.push(params.find(([k]) => k === 'path')[1]);
      } else {
        writes.push({ path, params });
      }
      return { ok: true, status: 200 };
    },
    async postJson(path) {
      foldersCreated.push(path);
      return { ok: true, status: 201 };
    },
    async postBinary(path, bytes, contentType) {
      uploads.push({ path, bytes, contentType });
      // Reflect the new asset so a subsequent enumerate discovers it.
      const name = path.split('/').pop();
      live.push({ name });
      return { ok: true, status: 201 };
    },
  };
}

describe('fieldsToProperties', () => {
  it('maps normalized fields + scope onto AEM property names', () => {
    const props = fieldsToProperties(
      {
        title: 'T', description: 'D', keywords: ['a'], productCategory: 'cards',
      },
      { company: 'acme', status: 'approved' },
    );
    expect(props['dc:title']).toBe('T');
    expect(props['dc:subject']).toEqual(['a']);
    expect(props.productCategory).toBe('cards');
    expect(props.company).toBe('acme');
    expect(props['dam:status']).toBe('approved');
    expect(props.campaign).toBeNull();
  });
});

describe('enrichAssetsClassic controller', () => {
  it('dry-run: generates + previews without writing', async () => {
    const client = fakeClient({ assets: [{ name: 'a.jpg' }] });
    const out = await enrichAssetsClassic({
      options: baseOptions({ dryRun: true }), client, generator, log: silent,
    });
    expect(out.dryRun).toBe(true);
    expect(out.report.counts().enriched).toBe(1);
    expect(out.preview).toContain('/content/dam/acme/a.jpg');
    expect(client.writes).toHaveLength(0);
  });

  it('stops cleanly when the folder has no assets', async () => {
    const client = fakeClient({ assets: [] });
    const out = await enrichAssetsClassic({
      options: baseOptions(), client, generator, log: silent,
    });
    expect(out.report.assets).toHaveLength(0);
  });

  it('skips assets already enriched for this customer', async () => {
    const client = fakeClient({
      assets: [{ name: 'a.jpg' }],
      meta: { '/content/dam/acme/a.jpg': { company: 'acme', 'dc:title': 'Existing' } },
    });
    const out = await enrichAssetsClassic({
      options: baseOptions(), client, generator, log: silent,
    });
    expect(out.report.counts().skipped).toBe(1);
    expect(client.writes).toHaveLength(0);
  });

  it('writes each asset via Sling POST and reports enriched', async () => {
    const client = fakeClient({ assets: [{ name: 'a.jpg' }] });
    const out = await enrichAssetsClassic({
      options: baseOptions(), client, generator, log: silent,
    });
    expect(out.report.counts().enriched).toBe(1);
    expect(out.report.exitCode()).toBe(0);
    expect(client.writes[0].path).toBe('/content/dam/acme/a.jpg/jcr:content/metadata');
  });

  it('publishes enriched assets via replication when enabled', async () => {
    const client = fakeClient({ assets: [{ name: 'a.jpg' }] });
    await enrichAssetsClassic({
      options: baseOptions({ noPublish: false }), client, generator, log: silent,
    });
    expect(client.publishes).toEqual(['/content/dam/acme/a.jpg']);
  });

  it('records a failure when a write throws', async () => {
    const client = fakeClient({ assets: [{ name: 'a.jpg' }] });
    client.postForm = async () => { throw Object.assign(new Error('boom'), { status: 500 }); };
    const out = await enrichAssetsClassic({
      options: baseOptions(), client, generator, log: silent,
    });
    expect(out.report.counts().failed).toBe(1);
    expect(out.report.exitCode()).toBe(1);
  });
});

describe('enrichAssetsClassic bring-in (E3)', () => {
  const pageHtml = '<img src="https://x.com/a.png"><img src="https://x.com/b.png">';
  function siteFetch() {
    return async (url) => {
      if (url === 'https://site.test/home') {
        return {
          ok: true, status: 200, headers: { get: () => 'text/html' }, text: async () => pageHtml,
        };
      }
      const bytes = new Uint8Array(11 * 1024).fill(1);
      return {
        ok: true,
        status: 200,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'image/png' : null) },
        arrayBuffer: async () => bytes.buffer,
      };
    };
  }

  it('dry-run: scrapes + downloads but does not upload or enrich', async () => {
    const client = fakeClient({ assets: [] });
    const out = await enrichAssetsClassic({
      options: baseOptions({ dryRun: true, bringIn: true, sourceUrl: 'https://site.test/home' }),
      client,
      generator,
      log: silent,
      fetchFn: siteFetch(),
      uploadStrategyName: 'classic',
    });
    expect(out.dryRun).toBe(true);
    expect(out.broughtIn.dryRun).toBe(true);
    expect(out.broughtIn.images).toHaveLength(2);
    expect(client.uploads).toHaveLength(0);
  });

  it('live: uploads scraped images then enriches + publishes them', async () => {
    const client = fakeClient({ assets: [] });
    const out = await enrichAssetsClassic({
      options: baseOptions({
        bringIn: true, sourceUrl: 'https://site.test/home', noPublish: false,
      }),
      client,
      generator,
      log: silent,
      fetchFn: siteFetch(),
      uploadStrategyName: 'classic',
    });
    expect(client.uploads.map((u) => u.path)).toEqual([
      '/api/assets/acme/a.png', '/api/assets/acme/b.png',
    ]);
    // Both uploaded assets are discovered, enriched, and published.
    expect(out.report.counts().enriched).toBe(2);
    expect(client.publishes).toEqual([
      '/content/dam/acme/a.png', '/content/dam/acme/b.png',
    ]);
  });

  it('creates the customer folder when it does not exist before uploading', async () => {
    const client = fakeClient({ assets: [], folderExists: false });
    await enrichAssetsClassic({
      options: baseOptions({
        bringIn: true, sourceUrl: 'https://site.test/home', noPublish: true,
      }),
      client,
      generator,
      log: silent,
      fetchFn: siteFetch(),
      uploadStrategyName: 'classic',
    });
    expect(client.foldersCreated).toEqual(['/api/assets/acme']);
    expect(client.uploads.length).toBeGreaterThan(0);
  });

  it('warns and no-ops when --bring-in is set without --source-url', async () => {
    const client = fakeClient({ assets: [] });
    const out = await enrichAssetsClassic({
      options: baseOptions({ bringIn: true, sourceUrl: null }),
      client,
      generator,
      log: silent,
      fetchFn: siteFetch(),
      uploadStrategyName: 'classic',
    });
    expect(client.uploads).toHaveLength(0);
    expect(out.report.assets).toHaveLength(0);
  });
});
