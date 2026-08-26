import {
  describe, it, expect, vi,
} from 'vitest';
import { ClassicAuthorClient } from '../classic-client.js';
import { makeRes } from './helpers.js';

function stubTokenProvider() {
  return {
    getToken: vi.fn(async () => 'tok'),
    refresh: vi.fn(async () => 'tok2'),
  };
}

const HOST = 'https://author-p203220-e2129061.adobeaemcloud.com';

const mkClient = (fetchFn, extra = {}) => new ClassicAuthorClient({
  tokenProvider: stubTokenProvider(), authorHost: HOST, fetchFn, ...extra,
});

describe('classic-client', () => {
  it('targets the author host root and sends only Authorization (no x-api-key)', async () => {
    const fetchFn = vi.fn(async () => makeRes({ body: {} }));
    const client = mkClient(fetchFn);
    await client.request('GET', '/api/assets/acme.json');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${HOST}/api/assets/acme.json`);
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['x-api-key']).toBeUndefined();
  });

  it('refreshes the token once on 401 and retries', async () => {
    const tokenProvider = stubTokenProvider();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(makeRes({ status: 401 }))
      .mockResolvedValueOnce(makeRes({ status: 200, body: { ok: true } }));
    const client = new ClassicAuthorClient({ tokenProvider, authorHost: HOST, fetchFn });
    const res = await client.request('GET', '/x');
    expect(res.status).toBe(200);
    expect(tokenProvider.refresh).toHaveBeenCalledTimes(1);
  });

  it('backs off on 429 honoring Retry-After', async () => {
    const sleepFn = vi.fn(async () => {});
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(makeRes({ status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(makeRes({ status: 200 }));
    const client = new ClassicAuthorClient({
      tokenProvider: stubTokenProvider(), authorHost: HOST, fetchFn, sleepFn,
    });
    const res = await client.request('GET', '/x');
    expect(res.status).toBe(200);
    expect(sleepFn).toHaveBeenCalledWith(2000);
  });

  it('getJson returns null on 404', async () => {
    const fetchFn = vi.fn(async () => makeRes({ status: 404, body: 'nope' }));
    const client = mkClient(fetchFn);
    expect(await client.getJson('/missing.json')).toBeNull();
  });

  it('getJson throws a rich error (status/body/headers) on other non-2xx', async () => {
    const fetchFn = vi.fn(async () => makeRes({ status: 403, body: '{"error_code":"403003"}', headers: { 'x-request-id': 'abc' } }));
    const client = mkClient(fetchFn);
    await expect(client.getJson('/x.json')).rejects.toMatchObject({
      status: 403,
      responseBody: '{"error_code":"403003"}',
    });
  });

  it('postForm preserves repeated keys for multi-value writes', async () => {
    const fetchFn = vi.fn(async () => makeRes({ status: 200 }));
    const client = mkClient(fetchFn);
    await client.postForm('/content/dam/x/jcr:content/metadata', [
      ['_charset_', 'utf-8'],
      ['dc:subject@TypeHint', 'String[]'],
      ['dc:subject', 'a'],
      ['dc:subject', 'b'],
    ]);
    const [, init] = fetchFn.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const { body } = init;
    expect(body).toContain('dc%3Asubject=a');
    expect(body).toContain('dc%3Asubject=b');
  });

  it('postForm throws a rich error on non-2xx', async () => {
    const fetchFn = vi.fn(async () => makeRes({ status: 500, body: 'boom' }));
    const client = mkClient(fetchFn, { sleepFn: async () => {}, maxRetries: 0 });
    await expect(client.postForm('/x', [['a', 'b']])).rejects.toMatchObject({ status: 500 });
  });

  it('postBinary POSTs raw bytes with the given Content-Type', async () => {
    const fetchFn = vi.fn(async () => makeRes({ status: 201 }));
    const client = mkClient(fetchFn);
    const bytes = new Uint8Array([1, 2, 3]);
    const res = await client.postBinary('/api/assets/acme/x.png', bytes, 'image/png');
    expect(res.status).toBe(201);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${HOST}/api/assets/acme/x.png`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('image/png');
    expect(init.body).toBe(bytes);
  });

  it('postBinary throws a rich error on non-2xx', async () => {
    const fetchFn = vi.fn(async () => makeRes({ status: 500, body: 'boom' }));
    const client = mkClient(fetchFn, { sleepFn: async () => {}, maxRetries: 0 });
    await expect(client.postBinary('/x', new Uint8Array([0]), 'image/png'))
      .rejects.toMatchObject({ status: 500 });
  });

  it('postJson POSTs a JSON body with application/json', async () => {
    const fetchFn = vi.fn(async () => makeRes({ status: 201 }));
    const client = mkClient(fetchFn);
    await client.postJson('/api/assets/newco', { class: 'assets/folder' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(`${HOST}/api/assets/newco`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ class: 'assets/folder' });
  });

  it('throws when constructed without an authorHost', () => {
    expect(() => new ClassicAuthorClient({ tokenProvider: stubTokenProvider() }))
      .toThrow(/authorHost is required/);
  });
});
