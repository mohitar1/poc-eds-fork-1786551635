import {
  describe, it, expect, vi,
} from 'vitest';
import { AuthorClient } from '../author-client.js';
import { buildHosts } from '../constants.js';
import { makeRes } from './helpers.js';

const HOSTS = buildHosts('p203220-e2129061');

function stubTokenProvider() {
  return {
    getToken: vi.fn(async () => 'tok'),
    refresh: vi.fn(async () => 'tok2'),
  };
}

describe('author-client', () => {
  it('resolves the host per operation and stamps auth headers', async () => {
    const fetchFn = vi.fn(async () => makeRes({ body: {} }));
    const client = new AuthorClient({
      tokenProvider: stubTokenProvider(), clientId: 'apikey', fetchFn, hosts: HOSTS,
    });
    await client.request('metadata', { method: 'GET', path: '/assets/a/metadata' });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://author-p203220-e2129061.adobeaemcloud.com/adobe/assets/a/metadata');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['x-api-key']).toBe('apikey');
    expect(init.headers['x-adobe-accept-experimental']).toBe('1');
  });

  it('refreshes the token once on 401 and retries', async () => {
    const tokenProvider = stubTokenProvider();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(makeRes({ status: 401 }))
      .mockResolvedValueOnce(makeRes({ status: 200, body: { ok: true } }));
    const client = new AuthorClient({
      tokenProvider, clientId: 'k', fetchFn, hosts: HOSTS,
    });
    const res = await client.request('metadata', { path: '/x' });
    expect(res.status).toBe(200);
    expect(tokenProvider.refresh).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('backs off and retries on 429, honoring Retry-After', async () => {
    const sleepFn = vi.fn(async () => {});
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(makeRes({ status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(makeRes({ status: 200 }));
    const client = new AuthorClient({
      tokenProvider: stubTokenProvider(), clientId: 'k', fetchFn, sleepFn, hosts: HOSTS,
    });
    const res = await client.request('search', { method: 'POST', path: '/assets/search' });
    expect(res.status).toBe(200);
    expect(sleepFn).toHaveBeenCalledWith(2000);
  });

  it('gives up after maxRetries on persistent 5xx', async () => {
    const fetchFn = vi.fn(async () => makeRes({ status: 503 }));
    const client = new AuthorClient({
      tokenProvider: stubTokenProvider(), clientId: 'k', fetchFn, sleepFn: async () => {}, maxRetries: 2, hosts: HOSTS,
    });
    const res = await client.request('jobs', { path: '/x' });
    expect(res.status).toBe(503);
    expect(fetchFn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('requestJson throws on non-2xx', async () => {
    const fetchFn = vi.fn(async () => makeRes({ status: 400, body: 'bad' }));
    const client = new AuthorClient({
      tokenProvider: stubTokenProvider(), clientId: 'k', fetchFn, hosts: HOSTS,
    });
    await expect(client.requestJson('metadata', { path: '/x' })).rejects.toThrow(/400/);
  });

  it('adds x-gw-ims-org-id when configured', async () => {
    const fetchFn = vi.fn(async () => makeRes({}));
    const client = new AuthorClient({
      tokenProvider: stubTokenProvider(), clientId: 'k', fetchFn, imsOrgId: 'ORG@AdobeOrg', hosts: HOSTS,
    });
    await client.request('metadata', { path: '/x' });
    expect(fetchFn.mock.calls[0][1].headers['x-gw-ims-org-id']).toBe('ORG@AdobeOrg');
  });

  it('throws when constructed without a hosts map', () => {
    expect(() => new AuthorClient({ tokenProvider: stubTokenProvider(), clientId: 'k' }))
      .toThrow(/hosts map is required/);
  });
});
