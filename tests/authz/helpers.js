/**
 * AuthZ test helpers.
 *
 * Extends the integration test infrastructure with impersonation via SUDO
 * cookies and ContentAI search helpers.
 */

import { getBaseUrl } from '../shared/env.js';

/**
 * Return the raw session cookie value or throw a clear error.
 * The session must belong to a user with the `sudo` permission.
 */
export function getSessionCookie() {
  const cookie = process.env.TEST_SESSION_COOKIE;
  if (!cookie) {
    throw new Error(
      'TEST_SESSION_COOKIE is not set.\n'
      + 'For authz tests the cookie must be from a user with the "sudo" permission.\n'
      + 'Get it from DevTools → Application → Cookies → session for frescopamedia.com\n'
      + 'Then: export TEST_SESSION_COOKIE="<value>"',
    );
  }
  return cookie;
}

/**
 * Build the Cookie header string with Session + SUDO cookies for impersonation.
 */
function buildCookieHeader(user) {
  const parts = [`Session=${getSessionCookie()}`];
  if (user.email) parts.push(`SUDO_EMAIL=${user.email}`);
  if (user.country) parts.push(`SUDO_COUNTRY=${user.country}`);
  if (user.employeeType) parts.push(`SUDO_EMPLOYEE_TYPE=${user.employeeType}`);
  if (user.name) parts.push(`SUDO_NAME=${user.name}`);
  return parts.join('; ');
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
 * Make an authenticated + impersonated HTTP request.
 *
 * @param {object} user    – test user persona (email, country, employeeType)
 * @param {string} path    – relative path, e.g. "/api/user"
 * @param {object} options – { method, body, query, headers }
 * @returns {{ status: number, headers: Headers, body: any, raw: Response }}
 */
export async function makeImpersonatedRequest(user, path, options = {}) {
  const {
    method = 'GET',
    body,
    query,
    headers: extraHeaders = {},
  } = options;

  const url = buildUrl(path, query);

  const headers = {
    Cookie: buildCookieHeader(user),
    ...extraHeaders,
  };

  if (body && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });

  const contentType = res.headers.get('content-type') || '';
  let parsed;
  if (contentType.includes('application/json')) {
    parsed = await res.json();
  } else {
    parsed = await res.text();
  }

  return {
    status: res.status, headers: res.headers, body: parsed, raw: res,
  };
}

/**
 * Fetch the resolved user attributes for an impersonated user.
 *
 * @param {object} user – test user persona
 * @returns {object} – { email, roles, countries, customers, brands, permissions, ... }
 */
export async function getUserAttributes(user) {
  const res = await makeImpersonatedRequest(user, '/api/user');
  if (res.status !== 200) {
    throw new Error(
      `GET /api/user returned ${res.status} for ${user.name} (${user.email}).\n`
      + 'Is the session cookie valid and does it have sudo permission?',
    );
  }
  return res.body;
}

/**
 * Run a ContentAI search while impersonating a user.
 *
 * @param {object} user       – test user persona
 * @param {object} searchBody – ContentAI search body (query, limit, etc.)
 * @returns {{ status: number, body: object }} – search response
 */
export async function searchAsUser(user, searchBody) {
  return makeImpersonatedRequest(user, '/api/adobe/assets/contentai/search', {
    method: 'POST',
    body: searchBody,
  });
}

/** A broad empty-query search to reveal full filter impact. Max limit is 50. */
export const BROAD_SEARCH = {
  query: [{ match: { text: '' } }],
  limit: 50,
};

/** Build a keyword search. */
export function keywordSearch(text, limit = 50) {
  return {
    query: [{ match: { text } }],
    limit,
  };
}

/**
 * Get the results array from a search response.
 * ContentAI returns { hits: { results: [...] } }.
 */
export function getSearchResults(searchBody) {
  return searchBody?.hits?.results || [];
}

/**
 * Extract unique values of a metadata field from search results.
 *
 * @param {object} searchBody – parsed search response body
 * @param {string} field      – metadata field, e.g. 'custom:brand' or 'custom:country'
 * @returns {string[]} – unique values found
 */
export function extractMetadataValues(searchBody, field) {
  const results = getSearchResults(searchBody);
  const values = new Set();
  results.forEach((hit) => {
    const meta = hit.assetMetadata || {};
    const val = meta[field];
    if (Array.isArray(val)) {
      val.forEach((v) => values.add(v));
    } else if (val) {
      values.add(val);
    }
  });
  return [...values];
}

/**
 * Check if any hit has a specific metadata field value.
 */
export function hitsContainMetadataValue(searchBody, field, value) {
  const results = getSearchResults(searchBody);
  return results.some((hit) => {
    const val = hit.assetMetadata?.[field];
    if (Array.isArray(val)) return val.includes(value);
    return val === value;
  });
}

/**
 * Check if any hit has a contentType of 'customers'.
 */
export function hitsContainCustomerContent(searchBody) {
  return hitsContainMetadataValue(searchBody, 'custom:contentType', 'customers');
}
