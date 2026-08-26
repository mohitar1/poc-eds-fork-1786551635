/**
 * Bring-in lane (E3 cherry, plan §2.4 Lane B). Two ways to create new assets under the
 * customer folder, both of which return the created assetIds so enumeration is skipped:
 *   - B1 direct upload:   POST /assets -> PUT bytes -> POST /assets/{id}/completeUpload
 *   - B2 import from URL:  POST /assets/import/fromUrl -> poll -> result
 * Paths under /content/dam auto-create missing folders, so the folder need not pre-exist.
 */

import { IMPORT_FILES_MAX, UPLOAD_ASSETS_MAX } from './constants.js';
import { extractJobIdFromLocation } from './job-utils.js';

// --- B1: direct upload -------------------------------------------------------

export async function initiateUpload(client, files) {
  if (files.length > UPLOAD_ASSETS_MAX) {
    throw new Error(`initiateUpload: max ${UPLOAD_ASSETS_MAX} assets per request`);
  }
  const body = {
    assets: files.map((f) => ({ fileName: f.fileName, path: f.path, fileSize: f.fileSize })),
  };
  const json = await client.requestJson('upload', {
    method: 'POST',
    path: '/assets',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return json?.data?.assets || json?.assets || [];
}

/**
 * PUT the bytes to the block-upload URIs, splitting into parts within the returned
 * part-size bounds. `putFn(uri, chunk) => Response` is injectable for tests.
 */
export async function putUploadParts(descriptor, bytes, { putFn = fetch } = {}) {
  const uris = descriptor.uploadURIs || [];
  if (uris.length === 0) throw new Error('putUploadParts: no uploadURIs');
  const total = bytes.byteLength ?? bytes.length;
  const partSize = Math.max(descriptor.minPartSize || 0, Math.ceil(total / uris.length));

  for (let i = 0; i < uris.length; i += 1) {
    const start = i * partSize;
    if (start >= total) break;
    const end = Math.min(start + partSize, total);
    const chunk = bytes.slice(start, end);
    const res = await putFn(uris[i], { method: 'PUT', body: chunk });
    if (!res.ok) {
      throw new Error(`upload part ${i} -> ${res.status}`);
    }
  }
}

export async function completeUpload(client, assetId, { uploadToken, fileName, path }) {
  return client.requestJson('upload', {
    method: 'POST',
    path: `/assets/${encodeURIComponent(assetId)}/completeUpload`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadToken, fileName, path }),
  });
}

/**
 * Orchestrate a full B1 upload for a batch of { fileName, path, fileSize, bytes }.
 * Returns [{ assetId, path, fileName }].
 */
export async function uploadAssets(client, items, { putFn = fetch } = {}) {
  const descriptors = await initiateUpload(client, items);
  const results = [];
  for (let i = 0; i < descriptors.length; i += 1) {
    const descriptor = descriptors[i];
    const item = items[i];
    await putUploadParts(descriptor, item.bytes, { putFn });
    await completeUpload(client, descriptor.assetId, {
      uploadToken: descriptor.uploadToken, fileName: item.fileName, path: item.path,
    });
    results.push({
      assetId: descriptor.assetId, path: descriptor.path || item.path, fileName: item.fileName,
    });
  }
  return results;
}

// --- B2: import from URL -----------------------------------------------------

export async function importFromUrl(client, { folder, files, assetMetadata }) {
  if (files.length > IMPORT_FILES_MAX) {
    throw new Error(`importFromUrl: max ${IMPORT_FILES_MAX} files per request`);
  }
  const body = { folder, files };
  if (assetMetadata) body.assetMetadata = assetMetadata;
  const res = await client.request('importFromUrl', {
    method: 'POST',
    path: '/assets/import/fromUrl',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 202) {
    const location = res.headers?.get?.('Location') || null;
    const jobId = extractJobIdFromLocation(location);
    return { async: true, jobId, location };
  }
  if (res.ok) {
    return { async: false, result: await res.json().catch(() => null) };
  }
  const text = await res.text().catch(() => '');
  throw new Error(`importFromUrl -> ${res.status} ${text}`.trim());
}

export async function pollImportJob(client, jobId, {
  intervalMs = 2000, maxPolls = 90, sleepFn,
} = {}) {
  const sleep = sleepFn || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  for (let i = 0; i < maxPolls; i += 1) {
    const status = await client.requestJson('importFromUrl', {
      method: 'GET',
      path: `/assets/import/jobs/${encodeURIComponent(jobId)}/status`,
    });
    const state = (status?.status || status?.state || '').toUpperCase();
    if (state && !['PROCESSING', 'RUNNING', 'PENDING', 'IN_PROGRESS'].includes(state)) {
      const result = await client.requestJson('importFromUrl', {
        method: 'GET',
        path: `/assets/import/jobs/${encodeURIComponent(jobId)}/result`,
      }).catch(() => null);
      return { status, result };
    }
    await sleep(intervalMs);
  }
  throw new Error(`import job ${jobId} did not complete within ${maxPolls} polls`);
}
