/**
 * Folder discovery for Lane A / enrich-existing (plan §2.4).
 *
 * The Author API has no folder-listing op. The obvious approach — a field-scoped
 * `startsWith` match on `repositoryMetadata.repo:path` — is BROKEN in this env's lexical
 * space (verified live against author-p203220-e2129061): it returns the asset only when
 * `text` equals the *full* path, and a real folder prefix returns zero; on
 * `repo:ancestors` the same operator match-alls the whole repo. So neither field-scoped
 * operator reliably scopes to a folder.
 *
 * The reliable approach is therefore: run a match-all search (`text:"*"`, FULLTEXT), page
 * through the response cursor, and filter client-side to hits whose `repo:path` sits under
 * the target folder. Bounded by SEARCH_SCAN_CAP so an unexpectedly huge repo can't run away.
 */

import {
  SEARCH_PAGE_LIMIT, SEARCH_SCAN_CAP,
} from './constants.js';

/** Normalize a Fetch Headers object (or plain map) into a serializable plain object. */
export function headersToObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') return Object.fromEntries(headers.entries());
  if (typeof headers.forEach === 'function') {
    const out = {};
    headers.forEach((v, k) => { out[k] = v; });
    return out;
  }
  return { ...headers };
}

/**
 * Build the POST /assets/search body for a full match-all scan page. The caller filters the
 * results by folder prefix; the server-side query intentionally does NOT try to scope by
 * path (see module header for why that is unreliable here).
 */
export function buildScanQuery(limit = SEARCH_PAGE_LIMIT, cursor = null) {
  const body = {
    query: [{ match: { text: '*', mode: 'FULLTEXT' } }],
    limit,
  };
  if (cursor) body.cursor = cursor;
  return body;
}

function extractHits(json) {
  // AEM Assets search returns { hits: { results: [...] }, cursor }.
  // Older/alternate shapes (items/assets/results at top level) are handled defensively.
  const items = json?.hits?.results
    || json?.hits
    || json?.items
    || json?.assets
    || json?.results
    || [];
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => {
    const repositoryMetadata = item.repositoryMetadata || item['repository:metadata'] || {};
    return {
      assetId: item.assetId || item.id || repositoryMetadata['repo:id'],
      repoPath: repositoryMetadata['repo:path'] || item.path || null,
      repoName: repositoryMetadata['repo:name'] || item.name || null,
    };
  }).filter((a) => a.assetId);
}

/** True when repoPath is a descendant of folderPath (a real prefix match on path segments). */
export function isUnderFolder(repoPath, folderPath) {
  if (!repoPath) return false;
  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  return repoPath.startsWith(prefix);
}

/**
 * Enumerate every asset under a folder prefix by scanning the tenant repo and filtering
 * client-side. Follows the response cursor across pages.
 *
 * @param {Object} params
 * @param {import('./author-client.js').AuthorClient} params.client
 * @param {string} params.folderPath e.g. /content/dam/santander
 * @param {number} [params.limit] page size
 * @param {number} [params.scanCap] max assets to page through before flagging exceededWindow
 * @returns {Promise<{ assets: Array, scanned: number, matched: number,
 *   exceededWindow: boolean }>}
 */
export async function enumerateFolder({
  client, folderPath, limit = SEARCH_PAGE_LIMIT, scanCap = SEARCH_SCAN_CAP,
}) {
  const assets = [];
  const seen = new Set();
  let cursor = null;
  let scanned = 0;
  let exceededWindow = false;

  for (;;) {
    const body = buildScanQuery(limit, cursor);
    const res = await client.request('search', {
      method: 'POST',
      path: '/assets/search',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`enumerate ${folderPath} -> ${res.status} ${text}`.trim());
      err.status = res.status;
      err.responseBody = text;
      err.responseHeaders = headersToObject(res.headers);
      throw err;
    }

    const json = await res.json();
    const hits = extractHits(json);
    scanned += hits.length;

    for (const hit of hits) {
      if (!isUnderFolder(hit.repoPath, folderPath)) continue;
      if (seen.has(hit.assetId)) continue;
      seen.add(hit.assetId);
      assets.push(hit);
    }

    cursor = json.cursor || json.search_metadata?.cursor || null;
    if (!cursor || hits.length === 0) break;
    if (scanned >= scanCap) {
      exceededWindow = true;
      break;
    }
  }

  return {
    assets, scanned, matched: assets.length, exceededWindow,
  };
}
