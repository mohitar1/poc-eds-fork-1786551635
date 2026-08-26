/**
 * Per-asset metadata read + idempotency test (plan §2.5).
 */

import { FIELD } from './constants.js';

/**
 * GET /assets/{id}/metadata, returning the parsed body plus the ETag needed for the
 * per-asset PATCH path.
 *
 * @returns {Promise<{ assetId, assetMetadata, repositoryMetadata, etag }>}
 */
export async function getAssetMetadata(client, assetId) {
  const res = await client.request('metadata', {
    method: 'GET',
    path: `/assets/${encodeURIComponent(assetId)}/metadata`,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET metadata ${assetId} -> ${res.status} ${text}`.trim());
  }
  const etag = res.headers?.get?.('ETag') || res.headers?.get?.('etag') || null;
  const json = await res.json();
  return {
    assetId,
    assetMetadata: json.assetMetadata || {},
    repositoryMetadata: json.repositoryMetadata || {},
    etag,
  };
}

/**
 * [EDGE-IDEMP] An asset counts as already enriched when it carries this fork's company
 * scope AND a non-empty title. Re-runs skip these unless --force.
 */
export function isAlreadyEnriched(assetMetadata, customerKey) {
  if (!assetMetadata) return false;
  const company = assetMetadata[FIELD.COMPANY];
  const title = assetMetadata[FIELD.TITLE];
  return company === customerKey && typeof title === 'string' && title.trim().length > 0;
}
