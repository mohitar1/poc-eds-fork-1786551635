/**
 * IMS client_credentials token provider (mirrors cloudflare/src/origin/dm.js
 * createIMSToken/getIMSToken, plan §2.2). Reuses the DM technical account creds — no new
 * secret. `fetchFn` is injectable for tests.
 */

import { IMS_TOKEN_URL, IMS_SCOPE, IMS_TOKEN_EXPIRY_BUFFER_SECONDS } from './constants.js';

/**
 * Perform a single client_credentials grant. Returns { accessToken, expiresIn }.
 */
export async function createImsToken({ clientId, clientSecret, fetchFn = fetch }) {
  if (!clientId || !clientSecret) {
    throw new Error('createImsToken: clientId and clientSecret are required');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: IMS_SCOPE,
  });
  const res = await fetchFn(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`IMS token grant failed: ${res.status} ${text}`.trim());
  }
  const json = await res.json();
  return { accessToken: json.access_token, expiresIn: json.expires_in };
}

/**
 * Caches a token and refreshes it IMS_TOKEN_EXPIRY_BUFFER_SECONDS before expiry.
 */
export class ImsTokenProvider {
  constructor({
    clientId, clientSecret, fetchFn = fetch, now = () => Date.now(),
  }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetchFn = fetchFn;
    this.now = now;
    this.token = null;
    this.expiresAtMs = 0;
  }

  isValid() {
    return Boolean(this.token) && this.now() < this.expiresAtMs;
  }

  async getToken({ force = false } = {}) {
    if (!force && this.isValid()) return this.token;
    const { accessToken, expiresIn } = await createImsToken({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      fetchFn: this.fetchFn,
    });
    this.token = accessToken;
    const ttlSeconds = Math.max(0, (expiresIn || 0) - IMS_TOKEN_EXPIRY_BUFFER_SECONDS);
    this.expiresAtMs = this.now() + ttlSeconds * 1000;
    return this.token;
  }

  /** Force a refresh (used on a 401). */
  async refresh() {
    return this.getToken({ force: true });
  }
}

/**
 * A token provider backed by a fixed, pre-issued token (AUTHOR_SPARK_IMS_TOKEN).
 * No IMS grant is performed. `refresh()` cannot mint a new token, so it returns the
 * same value — an expired/invalid supplied token surfaces as a 401/403 from the API.
 */
export class StaticTokenProvider {
  constructor({ token }) {
    if (!token) throw new Error('StaticTokenProvider: token is required');
    this.token = token;
  }

  async getToken() {
    return this.token;
  }

  async refresh() {
    return this.token;
  }
}
