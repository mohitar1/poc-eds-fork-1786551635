/**
 * Unit tests for constants/countries.js
 */

import { describe, it, expect } from 'vitest';
import { COUNTRY_CODE_TO_NAME, facetValueMatchesCountryCode } from '../countries.js';

describe('countries', () => {
  describe('facetValueMatchesCountryCode', () => {
    it('matches when the facet value equals the ISO code (case-insensitive)', () => {
      expect(facetValueMatchesCountryCode('IN', 'in')).toBe(true);
      expect(facetValueMatchesCountryCode('in', 'IN')).toBe(true);
    });

    it('matches when the facet value is the mapped country name', () => {
      expect(facetValueMatchesCountryCode('india', 'IN')).toBe(true);
      expect(facetValueMatchesCountryCode('India', 'in')).toBe(true);
    });

    it('does not match an unrelated country', () => {
      expect(facetValueMatchesCountryCode('usa', 'IN')).toBe(false);
    });

    it('does not match when the code has no known name mapping', () => {
      expect(facetValueMatchesCountryCode('some-region', 'ZZ')).toBe(false);
    });

    it('returns false for missing arguments', () => {
      expect(facetValueMatchesCountryCode('', 'IN')).toBe(false);
      expect(facetValueMatchesCountryCode('india', '')).toBe(false);
      expect(facetValueMatchesCountryCode(null, 'IN')).toBe(false);
      expect(facetValueMatchesCountryCode('india', null)).toBe(false);
    });
  });

  describe('COUNTRY_CODE_TO_NAME', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(COUNTRY_CODE_TO_NAME)).toBe(true);
    });

    it('maps known codes to lowercase names', () => {
      expect(COUNTRY_CODE_TO_NAME.in).toBe('india');
      expect(COUNTRY_CODE_TO_NAME.us).toBe('usa');
    });
  });
});
