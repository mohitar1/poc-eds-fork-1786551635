/**
 * Author-API HTTP client (plan §2.2 / §2.11).
 *
 * Resolves the host per logical operation, stamps the shared auth headers
 * (Authorization / x-api-key / x-adobe-accept-experimental), and handles the
 * cross-cutting failure modes: 401 -> refresh token once and retry; 429/5xx ->
 * exponential backoff with jitter honoring Retry-After; bounded retries. `fetchFn` and
 * `sleepFn` are injectable so the retry logic is unit-testable without real timers or
 * network.
 */

import {
  HEADER_AUTHORIZATION,
  HEADER_API_KEY,
  HEADER_EXPERIMENTAL,
  EXPERIMENTAL_VALUE,
} from './constants.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function defaultSleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function backoffDelayMs(attempt, baseMs) {
  const exp = baseMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * baseMs);
  return exp + jitter;
}

/**
 * Render a request as a copy-pasteable curl, redacting the bearer token to $TOKEN so the
 * secret never lands in logs. Enabled by AGENT_DEBUG (any truthy value).
 */
export function toCurl({
  method, url, headers, body,
}) {
  const parts = [`curl -sS -X ${method} '${url}'`];
  for (const [k, v] of Object.entries(headers || {})) {
    const val = k.toLowerCase() === 'authorization' ? 'Bearer $TOKEN' : v;
    parts.push(`-H '${k}: ${val}'`);
  }
  if (body) {
    const asStr = typeof body === 'string' ? body : JSON.stringify(body);
    parts.push(`--data '${asStr}'`);
  }
  return parts.join(' ');
}

export class AuthorClient {
  constructor({
    tokenProvider,
    clientId,
    hosts,
    fetchFn = fetch,
    sleepFn = defaultSleep,
    maxRetries = 4,
    baseBackoffMs = 500,
    imsOrgId = null,
  }) {
    if (!hosts) throw new Error('AuthorClient: hosts map is required (build via buildHosts(aemEnvId))');
    this.tokenProvider = tokenProvider;
    this.clientId = clientId;
    this.hosts = hosts;
    this.fetchFn = fetchFn;
    this.sleepFn = sleepFn;
    this.maxRetries = maxRetries;
    this.baseBackoffMs = baseBackoffMs;
    this.imsOrgId = imsOrgId;
  }

  resolveUrl(op, path) {
    const host = this.hosts[op];
    if (!host) throw new Error(`AuthorClient: no host mapped for operation "${op}"`);
    if (/^https?:\/\//.test(path)) return path;
    return `${host}${path}`;
  }

  async buildHeaders(extra = {}) {
    const token = await this.tokenProvider.getToken();
    const headers = {
      [HEADER_AUTHORIZATION]: `Bearer ${token}`,
      [HEADER_EXPERIMENTAL]: EXPERIMENTAL_VALUE,
      ...extra,
    };
    if (this.clientId) headers[HEADER_API_KEY] = this.clientId;
    if (this.imsOrgId) headers['x-gw-ims-org-id'] = this.imsOrgId;
    return headers;
  }

  /**
   * Issue a request against a logical operation host. Retries on 401 (token refresh) and
   * 429/5xx (backoff). Returns the raw Response so callers can inspect status/headers
   * (ETag, Location) themselves.
   */
  async request(op, {
    method = 'GET', path, headers = {}, body,
  }) {
    let refreshed = false;
    let attempt = 0;

    for (;;) {
      const url = this.resolveUrl(op, path);
      const reqHeaders = await this.buildHeaders(headers);
      if (process.env.AGENT_DEBUG) {
        console.error(`[agent:curl] ${toCurl({
          method, url, headers: reqHeaders, body,
        })}`);
      }
      const res = await this.fetchFn(url, { method, headers: reqHeaders, body });

      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.tokenProvider.refresh();
        continue;
      }

      if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
        const retryAfter = Number(res.headers?.get?.('Retry-After'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : backoffDelayMs(attempt, this.baseBackoffMs);
        attempt += 1;
        await this.sleepFn(delay);
        continue;
      }

      return res;
    }
  }

  /** Convenience: request + JSON parse, throwing on non-2xx. */
  async requestJson(op, opts) {
    const res = await this.request(op, opts);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${opts.method || 'GET'} ${opts.path} -> ${res.status} ${text}`.trim());
    }
    if (res.status === 204) return null;
    return res.json();
  }
}
