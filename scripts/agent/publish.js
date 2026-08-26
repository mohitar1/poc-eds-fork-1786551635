/**
 * Publish enriched assets (plan §2.10). POST /assets/publish takes at most 10 asset URNs
 * per request; on 202 the publish is async and polled via /assets/jobs/{jobId}/status.
 */

import { PUBLISH_BATCH_MAX, PUBLISH_TARGET } from './constants.js';
import { extractJobIdFromLocation } from './job-utils.js';

/** Split an array into fixed-size chunks. */
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

async function pollPublishJob(client, jobId, { intervalMs, maxPolls, sleepFn }) {
  const sleep = sleepFn || ((ms) => new Promise((r) => { setTimeout(r, ms); }));
  for (let i = 0; i < maxPolls; i += 1) {
    const status = await client.requestJson('jobs', {
      method: 'GET',
      path: `/assets/jobs/${encodeURIComponent(jobId)}/status`,
    });
    const state = (status?.status || status?.state || '').toUpperCase();
    if (state && !['PROCESSING', 'RUNNING', 'PENDING', 'IN_PROGRESS'].includes(state)) {
      return status;
    }
    await sleep(intervalMs);
  }
  throw new Error(`publish job ${jobId} did not complete within ${maxPolls} polls`);
}

/**
 * Publish a set of asset URNs in batches of <=10.
 * @returns {Promise<{ batches: Array, published: number }>}
 */
export async function publishAssets(client, urns, {
  target = PUBLISH_TARGET.AEM_PUBLISH, intervalMs = 2000, maxPolls = 60, sleepFn,
} = {}) {
  const batches = [];
  let published = 0;
  for (const group of chunk(urns, PUBLISH_BATCH_MAX)) {
    const res = await client.request('publish', {
      method: 'POST',
      path: '/assets/publish',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assets: group, target }),
    });

    if (res.status === 202) {
      const location = res.headers?.get?.('Location') || null;
      const jobId = extractJobIdFromLocation(location);
      const final = jobId
        ? await pollPublishJob(client, jobId, { intervalMs, maxPolls, sleepFn })
        : null;
      batches.push({
        count: group.length, async: true, jobId, final,
      });
      published += group.length;
    } else if (res.ok) {
      batches.push({ count: group.length, async: false });
      published += group.length;
    } else {
      const text = await res.text().catch(() => '');
      batches.push({ count: group.length, async: false, error: `${res.status} ${text}`.trim() });
    }
  }
  return { batches, published };
}
