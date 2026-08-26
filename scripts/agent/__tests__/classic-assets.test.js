import { describe, it, expect } from 'vitest';
import {
  damRelPath, apiFolderJsonPath, apiAssetPath, metadataNodePath, metadataJsonPath,
  enumerateFolderClassic, getAssetMetadataClassic, buildSlingParams,
  writeAssetMetadataClassic, publishAssetsClassic,
  uploadAssetClassic, uploadImagesClassic, deleteAssetClassic, ensureFolderClassic,
} from '../classic-assets.js';

const asset = (name, metadata = {}) => ({ class: ['assets/asset'], properties: { name, metadata } });
const folder = (name) => ({ class: ['assets/folder'], properties: { name } });

function fakeClient({ pages = {}, onPost, onPostBinary } = {}) {
  const posts = [];
  const binaries = [];
  const jsonPosts = [];
  const requests = [];
  return {
    posts,
    binaries,
    jsonPosts,
    requests,
    async getJson(path) {
      return path in pages ? pages[path] : null;
    },
    async postForm(path, params) {
      posts.push({ path, params });
      if (onPost) return onPost(path, params);
      return { ok: true, status: 200 };
    },
    async postBinary(path, bytes, contentType) {
      binaries.push({ path, bytes, contentType });
      if (onPostBinary) return onPostBinary(path, bytes, contentType);
      return { ok: true, status: 201 };
    },
    async postJson(path, obj) {
      jsonPosts.push({ path, obj });
      return { ok: true, status: 201 };
    },
    async request(method, path) {
      requests.push({ method, path });
      return { ok: true, status: 200 };
    },
  };
}

describe('classic-assets path helpers', () => {
  it('damRelPath strips the DAM root', () => {
    expect(damRelPath('/content/dam/acme')).toBe('/acme');
    expect(damRelPath('/content/dam')).toBe('');
    expect(damRelPath('/content/dam/a/b')).toBe('/a/b');
  });

  it('apiFolderJsonPath builds an encoded, paged listing URL', () => {
    expect(apiFolderJsonPath('/content/dam/acme', { offset: 0, limit: 50 }))
      .toBe('/api/assets/acme.json?offset=0&limit=50');
    expect(apiFolderJsonPath('/content/dam/My Brand', { offset: 10, limit: 5 }))
      .toBe('/api/assets/My%20Brand.json?offset=10&limit=5');
  });

  it('apiAssetPath builds an encoded asset URL under /api/assets', () => {
    expect(apiAssetPath('/content/dam/acme/x.jpg')).toBe('/api/assets/acme/x.jpg');
    expect(apiAssetPath('/content/dam/acme/a b.jpg')).toBe('/api/assets/acme/a%20b.jpg');
  });

  it('metadata paths point at the Sling metadata node', () => {
    expect(metadataNodePath('/content/dam/acme/x.jpg')).toBe('/content/dam/acme/x.jpg/jcr:content/metadata');
    expect(metadataJsonPath('/content/dam/acme/x.jpg')).toBe('/content/dam/acme/x.jpg/jcr:content/metadata.json');
    expect(metadataNodePath('/content/dam/acme/a b.jpg')).toContain('a%20b.jpg/jcr:content/metadata');
  });
});

describe('buildSlingParams', () => {
  it('always includes _charset_ and writes single values', () => {
    const p = buildSlingParams({ 'dc:title': 'Hi' });
    expect(p).toContainEqual(['_charset_', 'utf-8']);
    expect(p).toContainEqual(['dc:title', 'Hi']);
  });

  it('writes multi-value arrays with a String[] type hint and repeated keys', () => {
    const p = buildSlingParams({ 'dc:subject': ['a', 'b'] });
    expect(p).toContainEqual(['dc:subject@TypeHint', 'String[]']);
    expect(p.filter(([k]) => k === 'dc:subject')).toEqual([['dc:subject', 'a'], ['dc:subject', 'b']]);
  });

  it('skips null, empty string, and empty arrays (no empty writes)', () => {
    const p = buildSlingParams({
      a: null, b: '', c: [], d: [null, ''], e: 'keep',
    });
    const keys = p.map(([k]) => k);
    expect(keys).not.toContain('a');
    expect(keys).not.toContain('b');
    expect(keys).not.toContain('c');
    expect(keys).not.toContain('d');
    expect(keys).toContain('e');
  });
});

describe('enumerateFolderClassic', () => {
  it('lists assets and recurses into sub-folders', async () => {
    const client = fakeClient({
      pages: {
        '/api/assets/acme.json?offset=0&limit=50': { entities: [asset('a.jpg'), folder('sub')] },
        '/api/assets/acme/sub.json?offset=0&limit=50': { entities: [asset('b.jpg')] },
      },
    });
    const out = await enumerateFolderClassic({ client, folderPath: '/content/dam/acme' });
    expect(out.matched).toBe(2);
    expect(out.assets.map((a) => a.repoPath)).toEqual([
      '/content/dam/acme/a.jpg',
      '/content/dam/acme/sub/b.jpg',
    ]);
  });

  it('pages a folder until a short page is returned', async () => {
    const client = fakeClient({
      pages: {
        '/api/assets/acme.json?offset=0&limit=2': { entities: [asset('a.jpg'), asset('b.jpg')] },
        '/api/assets/acme.json?offset=2&limit=2': { entities: [asset('c.jpg')] },
      },
    });
    const out = await enumerateFolderClassic({ client, folderPath: '/content/dam/acme', limit: 2 });
    expect(out.matched).toBe(3);
  });

  it('treats a missing root folder as zero assets (rootMissing)', async () => {
    const client = fakeClient({ pages: {} });
    const out = await enumerateFolderClassic({ client, folderPath: '/content/dam/ghost' });
    expect(out.assets).toHaveLength(0);
    expect(out.rootMissing).toBe(true);
  });

  it('flags exceededWindow when the scan cap is hit', async () => {
    const client = fakeClient({
      pages: {
        '/api/assets/acme.json?offset=0&limit=50': { entities: [asset('a.jpg'), asset('b.jpg')] },
      },
    });
    const out = await enumerateFolderClassic({ client, folderPath: '/content/dam/acme', scanCap: 1 });
    expect(out.exceededWindow).toBe(true);
  });

  it('carries HAL metadata onto each asset', async () => {
    const client = fakeClient({
      pages: {
        '/api/assets/acme.json?offset=0&limit=50': { entities: [asset('a.jpg', { 'dc:format': 'image/jpeg' })] },
      },
    });
    const out = await enumerateFolderClassic({ client, folderPath: '/content/dam/acme' });
    expect(out.assets[0].halMetadata['dc:format']).toBe('image/jpeg');
  });
});

describe('getAssetMetadataClassic', () => {
  it('returns the flat property map', async () => {
    const client = fakeClient({
      pages: { '/content/dam/acme/x.jpg/jcr:content/metadata.json': { 'dc:title': 'T', company: 'acme' } },
    });
    const props = await getAssetMetadataClassic({ client, repoPath: '/content/dam/acme/x.jpg' });
    expect(props).toEqual({ 'dc:title': 'T', company: 'acme' });
  });

  it('returns {} when the metadata node is absent', async () => {
    const client = fakeClient({ pages: {} });
    expect(await getAssetMetadataClassic({ client, repoPath: '/content/dam/acme/x.jpg' })).toEqual({});
  });
});

describe('writeAssetMetadataClassic', () => {
  it('POSTs to the metadata node with the built params', async () => {
    const client = fakeClient();
    const res = await writeAssetMetadataClassic({
      client,
      repoPath: '/content/dam/acme/x.jpg',
      properties: { 'dc:title': 'T', 'dc:subject': ['a', 'b'] },
    });
    expect(res).toEqual({ ok: true, status: 200 });
    expect(client.posts[0].path).toBe('/content/dam/acme/x.jpg/jcr:content/metadata');
    expect(client.posts[0].params).toContainEqual(['dc:title', 'T']);
  });
});

describe('publishAssetsClassic', () => {
  it('activates each path and counts successes/failures', async () => {
    const client = fakeClient({
      onPost: (path, params) => {
        const p = params.find(([k]) => k === 'path')[1];
        if (p.endsWith('bad.jpg')) throw Object.assign(new Error('boom'), { status: 500 });
        return { ok: true, status: 200 };
      },
    });
    const out = await publishAssetsClassic({
      client,
      repoPaths: ['/content/dam/acme/a.jpg', '/content/dam/acme/bad.jpg'],
    });
    expect(out.published).toBe(1);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].repoPath).toBe('/content/dam/acme/bad.jpg');
  });
});

describe('uploadAssetClassic', () => {
  it('POSTs bytes to the /api/assets path and returns repoPath', async () => {
    const client = fakeClient();
    const bytes = new Uint8Array([1, 2, 3]);
    const out = await uploadAssetClassic({
      client, folderPath: '/content/dam/acme', fileName: 'hero.png', bytes, contentType: 'image/png',
    });
    expect(out).toEqual({ repoPath: '/content/dam/acme/hero.png', repoName: 'hero.png' });
    expect(client.binaries[0].path).toBe('/api/assets/acme/hero.png');
    expect(client.binaries[0].contentType).toBe('image/png');
    expect(client.binaries[0].bytes).toBe(bytes);
  });
});

describe('uploadImagesClassic', () => {
  it('uploads a batch and reports per-file failures without aborting', async () => {
    const client = fakeClient({
      onPostBinary: (path) => {
        if (path.endsWith('bad.png')) throw Object.assign(new Error('boom'), { status: 500 });
        return { ok: true, status: 201 };
      },
    });
    const images = [
      { fileName: 'a.png', bytes: new Uint8Array([1]), contentType: 'image/png' },
      { fileName: 'bad.png', bytes: new Uint8Array([2]), contentType: 'image/png' },
    ];
    const out = await uploadImagesClassic({ client, folderPath: '/content/dam/acme', images });
    expect(out.uploaded).toEqual([{ repoPath: '/content/dam/acme/a.png', repoName: 'a.png' }]);
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0].fileName).toBe('bad.png');
  });
});

describe('deleteAssetClassic', () => {
  it('DELETEs the /api/assets path', async () => {
    const client = fakeClient();
    await deleteAssetClassic({ client, repoPath: '/content/dam/acme/x.jpg' });
    expect(client.requests[0]).toEqual({ method: 'DELETE', path: '/api/assets/acme/x.jpg' });
  });
});

describe('ensureFolderClassic', () => {
  it('creates the folder via a JSON POST when the listing 404s', async () => {
    const client = fakeClient({ pages: {} }); // getJson returns null (missing)
    const out = await ensureFolderClassic({ client, folderPath: '/content/dam/newco' });
    expect(out.created).toBe(true);
    expect(client.jsonPosts[0].path).toBe('/api/assets/newco');
    expect(client.jsonPosts[0].obj.class).toBe('assets/folder');
    expect(client.jsonPosts[0].obj.properties.title).toBe('newco');
  });

  it('is a no-op when the folder already exists', async () => {
    const client = fakeClient({
      pages: { '/api/assets/acme.json?offset=0&limit=1': { entities: [] } },
    });
    const out = await ensureFolderClassic({ client, folderPath: '/content/dam/acme' });
    expect(out.created).toBe(false);
    expect(client.jsonPosts).toHaveLength(0);
  });
});
