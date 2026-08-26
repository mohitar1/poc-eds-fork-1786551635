/**
 * Classic AEM Author HTTP client (Sling / Assets HTTP API).
 *
 * WHY THIS EXISTS (verified live against author-p203220-e2129061):
 * The "converged" Assets API facade (author-<env>.adobeaemcloud.com/adobe/assets/...) is
 * gated by an `x-api-key` the demo's Content-Hub-issued token does not carry — every
 * /adobe/assets/{id}/metadata call returns 403003 "Api Key is invalid" (search happens to
 * ignore the key, but metadata reads and all writes do not), and /adobe/assets/publish and
 * /adobe/assets/metadata/import are not even routed on that host (404). The DM
 * technical-account token is separately walled off ("IMS Client ID not allowlisted").
 *
 * The CLASSIC author API, by contrast, authenticates the same bearer token with NO
 * x-api-key and supports the full lifecycle we need:
 *   - enumerate: GET /api/assets/<relpath>.json?offset&limit   (HAL, 200)
 *   - read:      GET /content/dam/<path>/jcr:content/metadata.json   (200)
 *   - write:     POST /content/dam/<path>/jcr:content/metadata  (Sling POST servlet, 200)
 *   - publish:   POST /bin/replicate.json  cmd=Activate         (200)
 *
 * This client therefore targets the author host ROOT (no /adobe prefix) and sends only
 * Authorization. It keeps the same cross-cutting behavior as AuthorClient: 401 -> refresh
 * token once and retry; 429/5xx -> exponential backoff honoring Retry-After; AGENT_DEBUG
 * curl logging with the bearer redacted. `fetchFn`/`sleepFn` are injectable for tests.
 */

import { toCurl } from './author-client.js';
import { headersToObject } from './enumerate.js';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function defaultSleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function backoffDelayMs(attempt, baseMs) {
  const exp = baseMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * baseMs);
  return exp + jitter;
}

/** Attach the exact author response (status/body/headers) to an Error for the fatal dump. */
async function richError(prefix, res) {
  const text = await res.text().catch(() => '');
  const err = new Error(`${prefix} -> ${res.status} ${text}`.trim());
  err.status = res.status;
  err.responseBody = text;
  err.responseHeaders = headersToObject(res.headers);
  return err;
}

export class ClassicAuthorClient {
  constructor({
    tokenProvider,
    authorHost,
    fetchFn = fetch,
    sleepFn = defaultSleep,
    maxRetries = 4,
    baseBackoffMs = 500,
  }) {
    if (!authorHost) throw new Error('ClassicAuthorClient: authorHost is required (https://author-<env>.adobeaemcloud.com)');
    this.tokenProvider = tokenProvider;
    this.authorHost = authorHost.replace(/\/+$/, '');
    this.fetchFn = fetchFn;
    this.sleepFn = sleepFn;
    this.maxRetries = maxRetries;
    this.baseBackoffMs = baseBackoffMs;
  }

  resolveUrl(path) {
    if (/^https?:\/\//.test(path)) return path;
    return `${this.authorHost}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  async buildHeaders(extra = {}) {
    const token = await this.tokenProvider.getToken();
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  /**
   * Issue a request against the classic author host. Retries on 401 (token refresh) and
   * 429/5xx (backoff). Returns the raw Response.
   */
  async request(method, path, { headers = {}, body } = {}) {
    let refreshed = false;
    let attempt = 0;

    for (;;) {
      const url = this.resolveUrl(path);
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

  /** GET a JSON resource. Returns parsed body, or null on 404. Throws rich error otherwise. */
  async getJson(path) {
    const res = await this.request('GET', path);
    if (res.status === 404) return null;
    if (!res.ok) throw await richError(`GET ${path}`, res);
    return res.json();
  }

  /**
   * POST an application/x-www-form-urlencoded body. `params` is an array of [key, value]
   * pairs so repeated keys (Sling multi-value writes) are preserved. Returns the raw
   * Response; throws a rich error on non-2xx.
   */
  async postForm(path, params) {
    const search = new URLSearchParams();
    for (const [k, v] of params) search.append(k, v);
    const res = await this.request('POST', path, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: search.toString(),
    });
    if (!res.ok) throw await richError(`POST ${path}`, res);
    return res;
  }

  /**
   * POST a raw binary body (e.g. an image) with an explicit Content-Type. Used by the
   * classic Assets HTTP API create-asset call. Returns the raw Response; throws a rich
   * error on non-2xx.
   */
  async postBinary(path, bytes, contentType) {
    const res = await this.request('POST', path, {
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      body: bytes,
    });
    if (!res.ok) throw await richError(`POST ${path}`, res);
    return res;
  }

  /**
   * POST a JSON body (e.g. the Assets HTTP API folder-create call). Returns the raw
   * Response; throws a rich error on non-2xx.
   */
  async postJson(path, obj) {
    const res = await this.request('POST', path, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
    if (!res.ok) throw await richError(`POST ${path}`, res);
    return res;
  }
}
