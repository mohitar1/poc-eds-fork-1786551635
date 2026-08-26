import { describe, it, expect } from 'vitest';
import {
  normalizeKeywords, mapToVocabulary, normalizeGenerated, validateGeneratedShape,
  DEFAULT_PRODUCT_CATEGORY_VOCAB, DEFAULT_CHANNEL_VOCAB,
} from '../normalize.js';

describe('normalize', () => {
  describe('normalizeKeywords', () => {
    it('lowercases, trims, dedupes and drops empties', () => {
      expect(normalizeKeywords([' Retail ', 'retail', 'BANK', '', null, 'bank']))
        .toEqual(['retail', 'bank']);
    });
    it('returns [] for non-arrays', () => {
      expect(normalizeKeywords('nope')).toEqual([]);
      expect(normalizeKeywords(undefined)).toEqual([]);
    });
    it('caps at 12 keywords', () => {
      const many = Array.from({ length: 20 }, (_, i) => `kw${i}`);
      expect(normalizeKeywords(many)).toHaveLength(12);
    });
  });

  describe('mapToVocabulary', () => {
    it('maps case-insensitively to the canonical entry', () => {
      expect(mapToVocabulary('CARDS', DEFAULT_PRODUCT_CATEGORY_VOCAB)).toBe('cards');
    });
    it('returns null when there is no confident match', () => {
      expect(mapToVocabulary('spaceships', DEFAULT_PRODUCT_CATEGORY_VOCAB)).toBeNull();
      expect(mapToVocabulary('', DEFAULT_CHANNEL_VOCAB)).toBeNull();
      expect(mapToVocabulary(null, DEFAULT_CHANNEL_VOCAB)).toBeNull();
    });
  });

  describe('validateGeneratedShape', () => {
    it('flags missing title', () => {
      expect(validateGeneratedShape({}).ok).toBe(false);
    });
    it('accepts a minimal valid object', () => {
      expect(validateGeneratedShape({ title: 'Hi' }).ok).toBe(true);
    });
    it('rejects non-objects', () => {
      expect(validateGeneratedShape(null).ok).toBe(false);
    });
  });

  describe('normalizeGenerated', () => {
    it('clamps title/description length and drops empty fields', () => {
      const out = normalizeGenerated({
        title: 'x'.repeat(200),
        description: '',
        keywords: ['a', 'b', 'c'],
        productCategory: 'Loans',
        channel: 'unknown-channel',
        campaign: 'Spring Sale',
      });
      expect(out.title).toHaveLength(80);
      expect(out.description).toBeUndefined();
      expect(out.keywords).toEqual(['a', 'b', 'c']);
      expect(out.productCategory).toBe('loans');
      expect(out.channel).toBeUndefined(); // no vocab match => dropped
      expect(out.campaign).toBe('Spring Sale');
    });
    it('never invents a one-off bucket for category/channel', () => {
      const out = normalizeGenerated({ title: 'T', productCategory: 'nonsense', channel: 'nonsense' });
      expect(out.productCategory).toBeUndefined();
      expect(out.channel).toBeUndefined();
    });
  });
});
