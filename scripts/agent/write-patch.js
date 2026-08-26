/**
 * Per-asset metadata write via PATCH /assets/{id}/metadata (plan §2.9), the fallback to
 * bulk import. Uses application/json-patch+json with a required If-Match ETag and the
 * [EDGE-ETAG] recovery: 428 (missing If-Match), 412 (stale ETag), 409 (conflict) ->
 * re-GET metadata for a fresh ETag and retry, bounded.
 */

import { JSON_PATCH_CONTENT_TYPE } from './json-patch.js';
import { HEADER_IF_MATCH } from './constants.js';
import { getAssetMetadata } from './metadata.js';

/**
 * Low-level PATCH. Returns the raw Response so the caller can branch on 412/409/428.
 */
export async function patchAssetMetadata(client, assetId, patchOps, etag) {
  const headers = { 'Content-Type': JSON_PATCH_CONTENT_TYPE };
  if (etag) headers[HEADER_IF_MATCH] = etag;
  return client.request('metadata', {
    method: 'PATCH',
    path: `/assets/${encodeURIComponent(assetId)}/metadata`,
    headers,
    body: JSON.stringify(patchOps),
  });
}

/**
 * PATCH with ETag-conflict recovery. On 412/409/428 it re-reads metadata to obtain a
 * fresh ETag and retries up to maxRetries. Returns { ok, status, attempts }.
 */
export async function writeAssetViaPatch({
  client, assetId, patchOps, etag, maxRetries = 3,
}) {
  let currentEtag = etag;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const res = await patchAssetMetadata(client, assetId, patchOps, currentEtag);
    if (res.ok) {
      return { ok: true, status: res.status, attempts: attempt };
    }
    if ([412, 409, 428].includes(res.status) && attempt <= maxRetries) {
      const fresh = await getAssetMetadata(client, assetId);
      currentEtag = fresh.etag;
      continue;
    }
    const text = await res.text().catch(() => '');
    return {
      ok: false, status: res.status, attempts: attempt, error: text,
    };
  }
  return {
    ok: false, status: 0, attempts: maxRetries + 1, error: 'exhausted retries',
  };
}
