import {
  describe, it, expect, vi,
} from 'vitest';
import {
  RepositoryUploadStrategy, ClassicUploadStrategy, OpenApiUploadStrategy,
  createUploadStrategy,
} from '../upload-strategy.js';

// ---------------------------------------------------------------------------
// Fake client that captures calls
// ---------------------------------------------------------------------------

function fakeClient({ folderExists = true } = {}) {
  const getJsonCalls = [];
  const postJsonCalls = [];
  const postBinaryCalls = [];
  return {
    authorHost: 'https://author-test.adobeaemcloud.com',
    getJsonCalls,
    postJsonCalls,
    postBinaryCalls,
    async buildHeaders(extra = {}) {
      return { Authorization: 'Bearer tok', ...extra };
    },
    async getJson(path) {
      getJsonCalls.push(path);
      if (!folderExists) return null;
      return { entities: [] };
    },
    async postJson(path, body) {
      postJsonCalls.push({ path, body });
      return { ok: true, status: 201 };
    },
    async postBinary(path, bytes, contentType) {
      postBinaryCalls.push({ path, bytes, contentType });
      return { ok: true, status: 201 };
    },
  };
}

const smallPng = new Uint8Array([137, 80, 78, 71]); // 4-byte fake PNG

// ---------------------------------------------------------------------------
// createUploadStrategy factory
// ---------------------------------------------------------------------------

describe('createUploadStrategy factory', () => {
  it('returns RepositoryUploadStrategy when name=repository', () => {
    const s = createUploadStrategy('repository', { client: fakeClient(), apiKey: 'k', fetchFn: fetch });
    expect(s).toBeInstanceOf(RepositoryUploadStrategy);
  });

  it('returns ClassicUploadStrategy when name=classic', () => {
    const s = createUploadStrategy('classic', { client: fakeClient(), fetchFn: fetch });
    expect(s).toBeInstanceOf(ClassicUploadStrategy);
  });

  it('returns OpenApiUploadStrategy when name=openapi', () => {
    const s = createUploadStrategy('openapi', { client: fakeClient(), fetchFn: fetch });
    expect(s).toBeInstanceOf(OpenApiUploadStrategy);
  });

  it('auto-selects repository when apiKey present and name=null', () => {
    const s = createUploadStrategy(null, { client: fakeClient(), apiKey: 'k', fetchFn: fetch });
    expect(s).toBeInstanceOf(RepositoryUploadStrategy);
  });

  it('auto-selects classic when no apiKey and name=null', () => {
    const s = createUploadStrategy(null, { client: fakeClient(), fetchFn: fetch });
    expect(s).toBeInstanceOf(ClassicUploadStrategy);
  });

  it('throws on unknown strategy name', () => {
    expect(() => createUploadStrategy('foobar', { client: fakeClient(), fetchFn: fetch }))
      .toThrow(/Unknown upload strategy/);
  });
});

// ---------------------------------------------------------------------------
// ClassicUploadStrategy
// ---------------------------------------------------------------------------

describe('ClassicUploadStrategy', () => {
  it('uploadAsset delegates to postBinary on the classic path', async () => {
    const client = fakeClient();
    const strategy = new ClassicUploadStrategy({ client });
    const res = await strategy.uploadAsset({
      folderPath: '/content/dam/acme',
      fileName: 'hero.png',
      bytes: smallPng,
      contentType: 'image/png',
    });
    expect(res.repoPath).toBe('/content/dam/acme/hero.png');
    expect(client.postBinaryCalls[0].path).toBe('/api/assets/acme/hero.png');
  });

  it('ensureFolder: returns created=false when folder exists', async () => {
    const client = fakeClient({ folderExists: true });
    const strategy = new ClassicUploadStrategy({ client });
    const res = await strategy.ensureFolder({ folderPath: '/content/dam/acme' });
    expect(res.created).toBe(false);
  });

  it('ensureFolder: returns created=true and POSTs when folder missing', async () => {
    const client = fakeClient({ folderExists: false });
    const strategy = new ClassicUploadStrategy({ client });
    const res = await strategy.ensureFolder({ folderPath: '/content/dam/acme' });
    expect(res.created).toBe(true);
    expect(client.postJsonCalls[0].path).toBe('/api/assets/acme');
  });

  it('uploadImages captures per-file failures without aborting the batch', async () => {
    const client = fakeClient();
    let callCount = 0;
    client.postBinary = async () => {
      callCount += 1;
      if (callCount === 1) throw new Error('disk full');
      return { ok: true, status: 201 };
    };
    const strategy = new ClassicUploadStrategy({ client });
    const images = [
      { fileName: 'a.png', bytes: smallPng, contentType: 'image/png' },
      { fileName: 'b.png', bytes: smallPng, contentType: 'image/png' },
    ];
    const res = await strategy.uploadImages({ folderPath: '/content/dam/acme', images });
    expect(res.uploaded).toHaveLength(1);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].fileName).toBe('a.png');
    expect(res.failures[0].error).toMatch(/disk full/);
  });
});

// ---------------------------------------------------------------------------
// RepositoryUploadStrategy (mock fetch)
// ---------------------------------------------------------------------------

describe('RepositoryUploadStrategy', () => {
  function buildFetch({ txn = '1234', assetId = 'urn:aaid:aem:abc', etag = '"0"' } = {}) {
    const putCalls = [];
    const postCalls = [];

    const fetchFn = vi.fn(async (url, opts) => {
      const method = opts?.method || 'GET';

      // Step 1 — GET folder → return Location with ;t=<txn>
      if (method === 'GET' && url.includes('/adobe/repository?path=')) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (k) => (k === 'location'
              ? `https://author-test.adobeaemcloud.com/adobe/repository/content/dam/acme;t=${txn}`
              : null),
          },
          json: async () => ({}),
        };
      }

      // Step 2 — POST ;api=create → asset-id + etag
      if (method === 'POST' && url.includes(';api=create')) {
        postCalls.push({ step: 'create', url });
        return {
          ok: true,
          status: 200,
          headers: {
            get: (k) => {
              if (k === 'asset-id') return assetId;
              if (k === 'etag') return etag;
              return null;
            },
          },
          text: async () => '',
        };
      }

      // Step 5 — POST finalize → 201 + Location
      if (method === 'POST' && url.includes('block_upload_finalize')) {
        postCalls.push({ step: 'finalize', url });
        return {
          ok: true,
          status: 201,
          headers: {
            get: (k) => (k === 'location'
              ? 'https://author-test.adobeaemcloud.com/content/dam/acme/hero.png'
              : null),
          },
          text: async () => '',
        };
      }

      // Step 3 — POST ;api=block_upload → SAS URLs + finalize URL
      if (method === 'POST' && url.includes(';api=block_upload')) {
        postCalls.push({ step: 'block_upload', url });
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            'repo:blocksize': 10 * 1024 * 1024,
            _links: {
              'http://ns.adobe.com/adobecloud/rel/block/transfer': [
                { href: 'https://blob.azure.test/container/blob?blockid=1&comp=block&sig=x' },
              ],
              'http://ns.adobe.com/adobecloud/rel/block/finalize': {
                href: 'https://author-test.adobeaemcloud.com/adobe/repository/content/dam/acme;api=block_upload_finalize;token=abc',
              },
            },
          }),
        };
      }

      // Step 4 — PUT to Azure Blob SAS URL
      if (method === 'PUT' && url.includes('blob.azure.test')) {
        putCalls.push({ url, size: opts?.body?.byteLength });
        return {
          ok: true, status: 201, headers: { get: () => null }, text: async () => '',
        };
      }

      return {
        ok: false, status: 404, headers: { get: () => null }, text: async () => 'not found',
      };
    });

    return { fetchFn, putCalls, postCalls };
  }

  it('uploadAsset: executes all 5 steps and returns repoPath', async () => {
    const client = fakeClient();
    const { fetchFn, putCalls, postCalls } = buildFetch();
    const strategy = new RepositoryUploadStrategy({ client, fetchFn });

    const res = await strategy.uploadAsset({
      folderPath: '/content/dam/acme',
      fileName: 'hero.png',
      bytes: smallPng,
      contentType: 'image/png',
    });

    expect(res.repoPath).toBe('/content/dam/acme/hero.png');
    expect(res.repoName).toBe('hero.png');
    expect(postCalls.map((c) => c.step)).toEqual(['create', 'block_upload', 'finalize']);
    expect(putCalls).toHaveLength(1);
  });

  it('uploadAsset: splits large bytes into multiple blocks', async () => {
    const client = fakeClient();
    const bigBytes = new Uint8Array(25 * 1024 * 1024); // 25 MB
    const putCalls = [];

    const fetchFn = vi.fn(async (url, opts) => {
      const method = opts?.method || 'GET';
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          headers: { get: (k) => (k === 'location' ? ';t=1' : null) },
          json: async () => ({}),
        };
      }
      if (method === 'POST' && url.includes(';api=create')) {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (k) => {
              if (k === 'asset-id') return 'urn:x';
              if (k === 'etag') return '"0"';
              return null;
            },
          },
          text: async () => '',
        };
      }
      if (method === 'POST' && url.includes(';api=block_upload')) {
        // Return 3 SAS URLs for the 3 blocks expected (25 MB / 10 MB = 3)
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            'repo:blocksize': 10 * 1024 * 1024, // 10 MB blocks
            _links: {
              'http://ns.adobe.com/adobecloud/rel/block/transfer': [
                { href: 'https://blob.test/b?blockid=1' },
                { href: 'https://blob.test/b?blockid=2' },
                { href: 'https://blob.test/b?blockid=3' },
              ],
              'http://ns.adobe.com/adobecloud/rel/block/finalize': { href: 'https://author-test.adobeaemcloud.com/finalize' },
            },
          }),
        };
      }
      if (method === 'PUT') {
        putCalls.push(opts?.body?.byteLength);
        return {
          ok: true, status: 201, headers: { get: () => null }, text: async () => '',
        };
      }
      if (method === 'POST') {
        return {
          ok: true,
          status: 201,
          headers: { get: (k) => (k === 'location' ? '/content/dam/acme/big.png' : null) },
          text: async () => '',
        };
      }
      return {
        ok: false, status: 404, headers: { get: () => null }, text: async () => '',
      };
    });

    const strategy = new RepositoryUploadStrategy({ client, fetchFn });
    await strategy.uploadAsset({
      folderPath: '/content/dam/acme',
      fileName: 'big.png',
      bytes: bigBytes,
      contentType: 'image/png',
    });

    expect(putCalls).toHaveLength(3);
    expect(putCalls[0]).toBe(10 * 1024 * 1024);
    expect(putCalls[1]).toBe(10 * 1024 * 1024);
    expect(putCalls[2]).toBe(5 * 1024 * 1024);
  });

  it('throws when create step fails', async () => {
    const client = fakeClient();
    const fetchFn = vi.fn(async (url, opts) => {
      const method = opts?.method || 'GET';
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          headers: { get: (k) => (k === 'location' ? ';t=1' : null) },
          json: async () => ({}),
        };
      }
      if (method === 'POST' && url.includes(';api=create')) {
        return {
          ok: false, status: 403, headers: { get: () => null }, text: async () => 'forbidden',
        };
      }
      return {
        ok: false, status: 404, headers: { get: () => null }, text: async () => '',
      };
    });
    const strategy = new RepositoryUploadStrategy({ client, fetchFn });
    await expect(strategy.uploadAsset({
      folderPath: '/content/dam/acme', fileName: 'x.png', bytes: smallPng, contentType: 'image/png',
    })).rejects.toThrow(/403/);
  });

  it('uploadImages captures per-file failures without aborting', async () => {
    const client = fakeClient();
    let callCount = 0;
    const { fetchFn } = buildFetch();
    const origFetch = fetchFn.getMockImplementation();
    fetchFn.mockImplementation(async (url, opts) => {
      if ((opts?.method || 'GET') === 'POST' && url.includes(';api=create')) {
        callCount += 1;
        if (callCount === 1) {
          return {
            ok: false, status: 500, headers: { get: () => null }, text: async () => 'err',
          };
        }
      }
      return origFetch(url, opts);
    });

    const strategy = new RepositoryUploadStrategy({ client, fetchFn });
    const images = [
      { fileName: 'fail.png', bytes: smallPng, contentType: 'image/png' },
      { fileName: 'ok.png', bytes: smallPng, contentType: 'image/png' },
    ];
    const res = await strategy.uploadImages({ folderPath: '/content/dam/acme', images });
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0].fileName).toBe('fail.png');
    expect(res.uploaded).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// OpenApiUploadStrategy
// ---------------------------------------------------------------------------

describe('OpenApiUploadStrategy', () => {
  it('throws NotImplementedError on all methods', async () => {
    const s = new OpenApiUploadStrategy();
    await expect(s.uploadAsset({})).rejects.toThrow(/not yet implemented/);
    await expect(s.ensureFolder({})).rejects.toThrow(/not yet implemented/);
    await expect(s.uploadImages({})).rejects.toThrow(/not yet implemented/);
  });
});
