import { describe, it, expect } from 'vitest';
import { extractJobIdFromLocation } from '../job-utils.js';

describe('job-utils', () => {
  it('extracts the job id that follows the jobs segment', () => {
    expect(extractJobIdFromLocation('/adobe/assets/jobs/job-1/status')).toBe('job-1');
    expect(extractJobIdFromLocation('/adobe/assets/jobs/job-2')).toBe('job-2');
    expect(extractJobIdFromLocation('https://host/adobe/assets/jobs/j3/result')).toBe('j3');
  });
  it('returns null when there is no location', () => {
    expect(extractJobIdFromLocation(null)).toBeNull();
    expect(extractJobIdFromLocation('')).toBeNull();
  });
});
