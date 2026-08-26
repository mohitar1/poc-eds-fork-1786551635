/**
 * Extract a job id from an async-operation Location header. The Author API returns
 * Location values such as ".../jobs/{jobId}/status" or ".../jobs/{jobId}", so we locate
 * the segment immediately after "jobs" rather than blindly taking the last path segment.
 */
export function extractJobIdFromLocation(location) {
  if (!location) return null;
  let path = location;
  try {
    path = new URL(location).pathname;
  } catch {
    // relative Location — use as-is
  }
  const segments = path.split('/').filter(Boolean);
  const jobsIdx = segments.lastIndexOf('jobs');
  if (jobsIdx !== -1 && segments[jobsIdx + 1]) {
    return segments[jobsIdx + 1];
  }
  const withoutStatus = segments.filter((s) => s !== 'status' && s !== 'result');
  return withoutStatus.pop() || null;
}
