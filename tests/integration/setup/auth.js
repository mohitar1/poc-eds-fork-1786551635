/**
 * Authentication helper for integration tests.
 *
 * Reads the session cookie from the TEST_SESSION_COOKIE env var and injects
 * it into every outgoing request.
 */

import { getBaseUrl } from './env.js';

/**
 * Return the raw session cookie value or throw a clear error.
 */
export function getSessionCookie() {
  const cookie = process.env.TEST_SESSION_COOKIE;
  if (!cookie) {
    throw new Error(
      'TEST_SESSION_COOKIE is not set.\n'
        + 'Get it from DevTools → Application → Cookies → session for frescopamedia.com\n'
        + 'Then: export TEST_SESSION_COOKIE="<value>"',
    );
  }
  return cookie;
}

/**
 * Build a full URL from a path + optional query params.
 */
function buildUrl(path, query) {
  const url = new URL(path, getBaseUrl());
  if (query) {
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return url.toString();
}

/**
 * Make an authenticated HTTP request.
 *
 * @param {string} path    – relative path, e.g. "/api/analytics/test"
 * @param {object} options – { method, body, query, headers, redirect }
 * @returns {{ status: number, headers: Headers, body: any, raw: Response }}
 */
export async function makeRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    query,
    headers: extraHeaders = {},
    redirect = 'follow', // follow redirects by default (pages redirect via EDS/Helix)
  } = options;

  const url = buildUrl(path, query);

  const headers = {
    Cookie: `Session=${getSessionCookie()}`,
    ...extraHeaders,
  };

  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect,
  });

  // Try to parse JSON; fall back to text
  const contentType = res.headers.get('content-type') || '';
  let parsed;
  if (contentType.includes('application/json')) {
    parsed = await res.json();
  } else {
    parsed = await res.text();
  }

  return {
    status: res.status,
    headers: res.headers,
    body: parsed,
    raw: res,
  };
}
