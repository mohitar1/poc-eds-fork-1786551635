import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

vi.mock('../../../scripts/locale-utils.js', () => ({
  getAppLabel: async () => (key, fallback) => fallback || key,
  localizePath: (path) => path,
  getLocaleRedirectUrl: () => null,
  hasLocalePrefix: () => true,
  getCurrentLocale: () => 'en',
}));

vi.mock('../../search-results/utils/sort-utils.js', () => ({
  loadSortPreference: () => null,
  SORT_TYPE: { TOP_RESULTS: 'topResults' },
  SORT_DIRECTION: { DESCENDING: 'desc' },
}));

vi.mock('../../search-results/clients/coa-client.js', () => ({
  COA_MAX_ASSETS: 20,
}));

const { default: decorate } = await import('../search-bar.js');
const { clearCoaResult } = await import('../../../scripts/coa-state.js');

function imageAsset(overrides = {}) {
  return {
    assetId: 'urn:aaid:aem:1', name: 'hero.jpg', format: 'image/jpeg', ...overrides,
  };
}

function dispatchSelection(selectedAssets) {
  window.dispatchEvent(new CustomEvent('assetSelectionChanged', { detail: { selectedAssets } }));
}

describe('search-bar.js — generate mode', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearCoaResult();
    delete window.location;
    window.location = { href: '', pathname: '/en/search', search: '' };
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('generate mode (disabled)', () => {
    it('starts in normal search mode', async () => {
      const block = document.createElement('div');
      await decorate(block);
      expect(block.querySelector('.generate-mode-badge').hidden).toBe(true);
      expect(block.querySelector('.query-search-btn').hidden).toBe(false);
    });

    it('stays in normal search mode when image assets are selected', async () => {
      const block = document.createElement('div');
      await decorate(block);

      dispatchSelection([imageAsset()]);

      expect(block.querySelector('.generate-mode-badge').hidden).toBe(true);
      expect(block.querySelector('.generate-mode-submit').hidden).toBe(true);
      expect(block.querySelector('.query-search-btn').hidden).toBe(false);
    });

    it('stays in normal search mode regardless of selection changes', async () => {
      const block = document.createElement('div');
      await decorate(block);

      dispatchSelection([imageAsset()]);
      dispatchSelection([]);

      expect(block.querySelector('.generate-mode-badge').hidden).toBe(true);
    });
  });
});
