/**
 * Bulk metadata write via POST /assets/metadata/import (plan §2.9), the preferred write
 * path. Submits a CSV as multipart/form-data (part name `file`) with async Prefer, then
 * polls the import job to completion.
 */

import { extractJobIdFromLocation } from './job-utils.js';

const IMPORT_PATH = '/assets/metadata/import';

/**
 * Submit one CSV import job. Returns { sync, status, jobId, location, result }.
 * On 202 the job is async and must be polled (jobId/location returned).
 */
export async function submitMetadataImport(client, csvText, { waitSeconds = 0, fileName = 'metadata.csv' } = {}) {
  const form = new FormData();
  const blob = new Blob([csvText], { type: 'text/csv' });
  form.append('file', blob, fileName);

  const headers = {};
  if (waitSeconds > 0) headers.Prefer = `respond-async, wait=${waitSeconds}`;
  else headers.Prefer = 'respond-async';

  const res = await client.request('metadataImport', {
    method: 'POST',
    path: IMPORT_PATH,
    headers,
    body: form,
  });

  if (res.status === 202) {
    const location = res.headers?.get?.('Location') || null;
    const jobId = extractJobIdFromLocation(location);
    return {
      sync: false, status: res.status, jobId, location,
    };
  }
  if (res.ok) {
    const result = await res.json().catch(() => null);
    return {
      sync: true, status: res.status, jobId: null, result,
    };
  }
  const text = await res.text().catch(() => '');
  throw new Error(`metadata import -> ${res.status} ${text}`.trim());
}

/**
 * Poll an async import job until terminal. Returns the final status/result JSON.
 */
export async function pollMetadataImportJob(client, jobId, {
  intervalMs = 2000, maxPolls = 60, sleepFn,
} = {}) {
  const sleep = sleepFn || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  for (let i = 0; i < maxPolls; i += 1) {
    const status = await client.requestJson('jobs', {
      method: 'GET',
      path: `${IMPORT_PATH}/jobs/${encodeURIComponent(jobId)}/status`,
    });
    const state = (status?.status || status?.state || '').toUpperCase();
    if (state && !['PROCESSING', 'RUNNING', 'PENDING', 'IN_PROGRESS'].includes(state)) {
      return status;
    }
    await sleep(intervalMs);
  }
  throw new Error(`metadata import job ${jobId} did not complete within ${maxPolls} polls`);
}
