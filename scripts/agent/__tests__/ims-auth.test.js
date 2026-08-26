import {
  describe, it, expect, vi,
} from 'vitest';
import { createImsToken, ImsTokenProvider, StaticTokenProvider } from '../ims-auth.js';
import { makeRes } from './helpers.js';

describe('ims-auth', () => {
  describe('createImsToken', () => {
    it('posts client_credentials form and returns the token', async () => {
      const fetchFn = vi.fn(async () => makeRes({ body: { access_token: 'T', expires_in: 3600 } }));
      const out = await createImsToken({ clientId: 'id', clientSecret: 'sec', fetchFn });
      expect(out).toEqual({ accessToken: 'T', expiresIn: 3600 });
      const [, init] = fetchFn.mock.calls[0];
      expect(init.body).toContain('grant_type=client_credentials');
      expect(init.body).toContain('client_id=id');
    });

    it('throws when credentials are missing', async () => {
      await expect(createImsToken({ clientId: '', clientSecret: '', fetchFn: vi.fn() }))
        .rejects.toThrow(/required/);
    });
  });

  describe('ImsTokenProvider', () => {
    it('caches the token and only refetches after the expiry buffer', async () => {
      let clock = 0;
      const fetchFn = vi.fn(async () => makeRes({ body: { access_token: `T${fetchFn.mock.calls.length}`, expires_in: 600 } }));
      const provider = new ImsTokenProvider({
        clientId: 'id', clientSecret: 'sec', fetchFn, now: () => clock,
      });
      const first = await provider.getToken();
      const second = await provider.getToken();
      expect(first).toBe(second);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Advance past (expires_in - 5min buffer) = 300s -> must refetch.
      clock = 301 * 1000;
      await provider.getToken();
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('refresh() forces a new grant', async () => {
      const fetchFn = vi.fn(async () => makeRes({ body: { access_token: 'X', expires_in: 3600 } }));
      const provider = new ImsTokenProvider({ clientId: 'id', clientSecret: 'sec', fetchFn });
      await provider.getToken();
      await provider.refresh();
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('StaticTokenProvider', () => {
    it('returns the supplied token without any grant', async () => {
      const provider = new StaticTokenProvider({ token: 'PRE_ISSUED' });
      expect(await provider.getToken()).toBe('PRE_ISSUED');
    });

    it('refresh() returns the same static token', async () => {
      const provider = new StaticTokenProvider({ token: 'PRE_ISSUED' });
      expect(await provider.refresh()).toBe('PRE_ISSUED');
    });

    it('throws when no token is supplied', () => {
      expect(() => new StaticTokenProvider({})).toThrow(/token is required/);
    });
  });
});
