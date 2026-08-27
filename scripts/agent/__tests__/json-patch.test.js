import { describe, it, expect } from 'vitest';
import { buildMetadataPatch, JSON_PATCH_CONTENT_TYPE } from '../json-patch.js';

describe('json-patch', () => {
  it('builds add ops for present fields plus company and dam:status', () => {
    const ops = buildMetadataPatch(
      {
        title: 'A', description: 'D', keywords: ['k1', 'k2'], productCategory: 'cards',
      },
      { company: 'santander' },
    );
    expect(ops).toContainEqual({ op: 'add', path: '/dc:title', value: 'A' });
    expect(ops).toContainEqual({ op: 'add', path: '/dc:description', value: 'D' });
    expect(ops).toContainEqual({ op: 'add', path: '/dc:subject', value: ['k1', 'k2'] });
    expect(ops).toContainEqual({ op: 'add', path: '/productCategory', value: 'cards' });
    expect(ops).toContainEqual({ op: 'add', path: '/company', value: 'santander' });
    expect(ops).toContainEqual({ op: 'add', path: '/dam:status', value: 'approved' });
    expect(ops).toContainEqual({ op: 'add', path: '/allowedCountries', value: ['global'] });
    expect(ops).toContainEqual({ op: 'add', path: '/internalStatus', value: 'approved' });
  });

  it('omits empty fields but always stamps dam:status, allowedCountries, internalStatus', () => {
    const ops = buildMetadataPatch({}, { company: 'x' });
    const paths = ops.map((o) => o.path);
    expect(paths).not.toContain('/dc:title');
    expect(paths).toContain('/dam:status');
    expect(paths).toContain('/company');
    expect(paths).toContain('/allowedCountries');
    expect(paths).toContain('/internalStatus');
  });

  it('defaults allowedCountries to ["global"] and internalStatus to "approved" when scope omits them', () => {
    const ops = buildMetadataPatch({}, { company: 'x' });
    expect(ops).toContainEqual({ op: 'add', path: '/allowedCountries', value: ['global'] });
    expect(ops).toContainEqual({ op: 'add', path: '/internalStatus', value: 'approved' });
  });

  it('normalizes a scalar scope.allowedCountries into an array', () => {
    const ops = buildMetadataPatch({}, { company: 'x', allowedCountries: 'us' });
    expect(ops).toContainEqual({ op: 'add', path: '/allowedCountries', value: ['us'] });
  });

  it('passes through an explicit scope.allowedCountries array and internalStatus', () => {
    const ops = buildMetadataPatch(
      {},
      { company: 'x', allowedCountries: ['us', 'global'], internalStatus: 'internal-only' },
    );
    expect(ops).toContainEqual({ op: 'add', path: '/allowedCountries', value: ['us', 'global'] });
    expect(ops).toContainEqual({ op: 'add', path: '/internalStatus', value: 'internal-only' });
  });

  it('does not include empty keyword arrays', () => {
    const ops = buildMetadataPatch({ keywords: [] }, { company: 'x' });
    expect(ops.map((o) => o.path)).not.toContain('/dc:subject');
  });

  it('exposes the RFC-6902 content type', () => {
    expect(JSON_PATCH_CONTENT_TYPE).toBe('application/json-patch+json');
  });
});
