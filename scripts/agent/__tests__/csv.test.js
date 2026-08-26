import { describe, it, expect } from 'vitest';
import {
  csvEscapeCell, serializeArrayCell, buildMetadataCsv, buildMetadataCsvBatches,
} from '../csv.js';

describe('csv', () => {
  describe('csvEscapeCell', () => {
    it('leaves simple values unquoted', () => {
      expect(csvEscapeCell('hello')).toBe('hello');
    });
    it('quotes and doubles interior quotes for values with commas/quotes', () => {
      expect(csvEscapeCell('a,b')).toBe('"a,b"');
      expect(csvEscapeCell('say "hi"')).toBe('"say ""hi"""');
    });
    it('returns empty string for null/empty (no-change semantics)', () => {
      expect(csvEscapeCell(null)).toBe('');
      expect(csvEscapeCell('')).toBe('');
    });
  });

  describe('serializeArrayCell + escaping', () => {
    it('produces the doubled-quote multi-value CSV field', () => {
      const raw = serializeArrayCell(['a', 'b']);
      expect(raw).toBe('["a","b"]');
      expect(csvEscapeCell(raw)).toBe('"[""a"",""b""]"');
    });
    it('returns empty for empty arrays', () => {
      expect(serializeArrayCell([])).toBe('');
    });
  });

  describe('buildMetadataCsv', () => {
    it('emits an assetPath id column plus only the used property columns', () => {
      const { csv, columns } = buildMetadataCsv([
        {
          assetPath: '/content/dam/x/a.jpg', title: 'A', keywords: ['k1', 'k2'], company: 'x', status: 'approved',
        },
      ]);
      expect(columns[0]).toBe('assetPath');
      expect(columns).toContain('dc:title[string]');
      expect(columns).toContain('dc:subject[string[]]');
      expect(columns).toContain('company[string]');
      expect(columns).not.toContain('campaign[string]'); // unused -> omitted
      const lines = csv.split('\r\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('/content/dam/x/a.jpg');
      expect(lines[1]).toContain('"[""k1"",""k2""]"');
    });

    it('returns empty for no rows', () => {
      expect(buildMetadataCsv([]).csv).toBe('');
    });
  });

  describe('buildMetadataCsvBatches', () => {
    it('keeps a small set in a single batch', () => {
      const rows = Array.from({ length: 5 }, (_, i) => ({ assetPath: `/x/${i}.jpg`, title: `T${i}`, company: 'x' }));
      const batches = buildMetadataCsvBatches(rows);
      expect(batches).toHaveLength(1);
    });
  });
});
