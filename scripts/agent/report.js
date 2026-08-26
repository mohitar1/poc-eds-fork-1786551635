/**
 * Per-asset run report + summary (plan §2.11 / §3.6). Records the outcome of each asset
 * and yields a machine-readable summary plus a process exit code (non-zero on hard
 * failures).
 */

export const OUTCOME = {
  ENRICHED: 'enriched',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  PUBLISHED: 'published',
};

export class Report {
  constructor() {
    this.assets = [];
    this.startedAt = new Date().toISOString();
  }

  record(assetId, outcome, detail = {}) {
    this.assets.push({ assetId, outcome, ...detail });
  }

  counts() {
    return this.assets.reduce((acc, a) => {
      acc[a.outcome] = (acc[a.outcome] || 0) + 1;
      return acc;
    }, {});
  }

  hasFailures() {
    return this.assets.some((a) => a.outcome === OUTCOME.FAILED);
  }

  exitCode() {
    return this.hasFailures() ? 1 : 0;
  }

  toJSON() {
    return {
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      counts: this.counts(),
      assets: this.assets,
    };
  }

  summaryLine() {
    const c = this.counts();
    const parts = Object.entries(c).map(([k, v]) => `${v} ${k}`);
    return parts.length ? parts.join(', ') : 'no assets processed';
  }
}
