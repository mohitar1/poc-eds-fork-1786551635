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
  });

  it('omits empty fields but always stamps dam:status', () => {
    const ops = buildMetadataPatch({}, { company: 'x' });
    const paths = ops.map((o) => o.path);
    expect(paths).not.toContain('/dc:title');
    expect(paths).toContain('/dam:status');
    expect(paths).toContain('/company');
  });

  it('does not include empty keyword arrays', () => {
    const ops = buildMetadataPatch({ keywords: [] }, { company: 'x' });
    expect(ops.map((o) => o.path)).not.toContain('/dc:subject');
  });

  it('exposes the RFC-6902 content type', () => {
    expect(JSON_PATCH_CONTENT_TYPE).toBe('application/json-patch+json');
  });
});
